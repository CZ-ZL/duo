import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Sessions from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { digest } from './store.js'
import SemanticEvaluators from './semantic-evaluators.js'
import ModelGenerator from './model-generator.js'
import ModelExecutor from './model-executor.js'

const usage = { inputTokens: 80, cacheReadTokens: 20, outputTokens: 10, totalTokens: 110 }
async function host(
  t,
  { grades, missingUsage = false, malformed = false, review = false, roleModels = false } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'duo-semantic-')),
    ctx = new Context(),
    fibers = [],
    requests = []
  const dataset = {
    version: 1,
    ...Object.fromEntries(
      ['fast', ...(review ? ['review'] : []), 'slow', 'final'].map((tier, n) => [
        tier,
        {
          id: tier + '-semantic-v2',
          tasks: [
            {
              id: tier + '-1',
              input: `QUESTION: ${tier} unique fact?\nSOURCE: ${tier}.md (lines 1-2, snapshot test)\nThe allowed values are alpha and beta.`,
              expected: {
                goldFiles: [tier + '.md'],
                allowedFiles: [tier + '.md'],
                answerKeys: ['PRIVATE_' + tier],
                question: 'Question ' + n,
              },
            },
          ],
        },
      ]),
    ),
  }
  const datasetPath = join(root, 'dataset.json')
  writeFileSync(datasetPath, JSON.stringify(dataset))
  const config = {
    provider: 'test',
    model: 'offline',
    datasetPath,
    artifactRoot: join(root, 'sessions'),
    judgmentRoot: join(root, 'judgments'),
    policyPath: resolve('examples/native/semantic-policy-v2.json'),
    maxTokens: 1024,
    maxInputBytes: 10000,
    timeoutMs: 3000,
    currency: 'CNY',
    reservationCny: 0.15,
    evidenceKind: 'fixture',
    pricing: {
      id: 'synthetic',
      currency: 'CNY',
      inputCnyPerMillion: 3,
      cacheReadCnyPerMillion: 0.1,
      outputCnyPerMillion: 9,
    },
  }
  for (const P of [AgentRegistry, Sessions, Projections, LlmRuntime, Tools])
    fibers.push(await ctx.plugin(P))
  fibers.push(
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false }),
  )
  class Adapter extends LlmAdapter {
    async *stream(options) {
      requests.push(options)
      const prompt = JSON.parse(
        options.messages.filter((m) => m.role === 'user').at(-1).content[0].text,
      )
      const output =
        options.model === 'generator-role'
          ? {
              candidates: [
                {
                  mode: 'exploit',
                  family: 'evidence',
                  hypothesis: 'Check whether explicit evidence helps.',
                  persona: 'Use the supplied evidence carefully.',
                },
              ],
            }
          : options.model === 'executor-role'
            ? Object.fromEntries(
                prompt.tasks.map((task) => [
                  task.id,
                  { answer: 'alpha and beta', citations: [task.id.split('-')[0] + '.md'] },
                ]),
              )
            : (grades ??
              Object.fromEntries(
                prompt.tasks.map((task) => [
                  task.id,
                  {
                    supported: true,
                    complete: true,
                    contradiction: false,
                    reason: 'Fixture: matches the supplied fact.',
                  },
                ]),
              ))
      yield {
        type: 'text-delta',
        index: 0,
        text: malformed ? 'invalid JSON' : JSON.stringify(output),
      }
      if (!missingUsage) yield { type: 'usage', usage }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  fibers.push(
    await ctx.plugin({
      name: 'semantic-fixture',
      inject: ['llm'],
      apply(c) {
        c.llm.registerAdapter(['test'], new Adapter())
      },
    }),
  )
  fibers.push(await ctx.plugin(AgentLoop, { agents: [] }))
  fibers.push(
    await ctx.plugin(SemanticEvaluators, {
      ...config,
      model: roleModels ? 'judge-role' : config.model,
    }),
  )
  if (roleModels) {
    fibers.push(await ctx.plugin(ModelGenerator, { ...config, model: 'generator-role' }))
    fibers.push(await ctx.plugin(ModelExecutor, { ...config, model: 'executor-role' }))
  }
  t.after(async () => {
    for (const f of fibers.reverse()) await f.dispose()
  })
  const candidate = {
    id: 'candidate-private',
    version: 'version-private',
    persona: 'PRIVATE_PERSONA',
  }
  const artifact = {
    candidateId: candidate.id,
    candidateVersion: candidate.version,
    status: 'completed',
    tier: 'fast',
    dataId: dataset.fast.id,
    datasetDigest: digest(dataset),
    receiptPath: join(root, 'execution.json'),
    text: JSON.stringify({
      'fast-1': { answer: 'The values are alpha and beta.', citations: ['fast.md'] },
    }),
  }
  return { ctx, root, config, dataset, candidate, artifact, requests }
}
test('the existing generator, executor and semantic judge route distinct models through one host and separate receipts', async (t) => {
  const h = await host(t, { roleModels: true }),
    original = h.ctx.duoGenerator.describe()
  const generated = await h.ctx.duoGenerator.propose({
    champion: h.candidate,
    feedback: { evidence: 'insufficient_data' },
    quotas: { exploit: 1, explore: 0, innovate: 0 },
    generation: 1,
    nextId: () => 'proposed',
  })
  assert.equal(generated.candidates?.length, 1)
  const executed = await h.ctx.duoExecutor.execute({
    candidate: h.candidate,
    applied: h.candidate,
    tier: 'fast',
  })
  const measured = await h.ctx.duoEvaluators.evaluate({
    candidate: h.candidate,
    artifact: executed.artifact,
    tier: 'fast',
  })
  assert.equal(measured.ok, true)
  assert.equal(measured.metrics.quality, 1)
  assert.deepEqual(
    h.requests.map((r) => r.model),
    ['generator-role', 'executor-role', 'judge-role'],
  )
  assert.deepEqual(
    [generated, executed, measured].map((r) => r.costEvidence.attempts),
    [1, 1, 1],
  )
  assert.deepEqual(
    [generated, executed, measured].map((r) => r.costEvidence.model),
    ['generator-role', 'executor-role', 'judge-role'],
  )
  assert.equal(
    new Set([generated, executed, measured].map((r) => r.costEvidence.receiptPath)).size,
    3,
  )
  assert.equal(h.ctx.agents.list().length, 0)
  const scoped = h.ctx.isolate('duoGenerator'),
    f = await scoped.plugin(ModelGenerator, { ...h.config, model: 'replacement-role' })
  t.after(() => f.dispose())
  assert.notEqual(digest(scoped.duoGenerator.describe()), digest(original))
  assert.deepEqual(h.ctx.duoGenerator.describe(), original)
})
test('the optional review semantic judge uses only its bound split and source checks', async (t) => {
  const h = await host(t, { review: true }),
    descriptor = h.ctx.duoEvaluators.describe().find((d) => d.tier === 'review')
  assert.equal(descriptor?.dataId, 'review-semantic-v2')
  const out = await h.ctx.duoEvaluators.evaluate({
    candidate: h.candidate,
    artifact: {
      ...h.artifact,
      tier: 'review',
      dataId: h.dataset.review.id,
      text: JSON.stringify({ 'review-1': { answer: 'alpha and beta', citations: ['review.md'] } }),
    },
    tier: 'review',
  })
  assert.equal(out.ok, true)
  assert.equal(out.metrics.quality, 1)
  assert.equal(h.requests.length, 1)
  assert.doesNotMatch(JSON.stringify(h.requests[0]), /fast-1|slow-1|final-1|PRIVATE_/)
  const invalid = structuredClone(h.dataset)
  invalid.review.tasks[0].expected.allowedFiles = ['unprovided.md']
  const file = join(h.root, 'invalid-review.json')
  writeFileSync(file, JSON.stringify(invalid))
  const scoped = h.ctx.isolate('duoEvaluators')
  await assert.rejects(
    async () => await scoped.plugin(SemanticEvaluators, { ...h.config, datasetPath: file }),
    { code: 'DUO_DATA_INVALID' },
  )
})
test('semantic provider measures a candidate through the actual DSH Agent lifecycle with tier isolation', async (t) => {
  const h = await host(t),
    out = await h.ctx.duoEvaluators.evaluate({
      candidate: h.candidate,
      artifact: h.artifact,
      tier: 'fast',
    })
  assert.equal(out.ok, true)
  assert.equal(out.metrics.quality, 1)
  assert.equal(out.costCny, 0.000332)
  assert.equal(h.requests.length, 1)
  const wire = JSON.stringify(h.requests[0])
  assert.doesNotMatch(wire, /PRIVATE_|slow-1|final-1|candidate-private|version-private/)
  assert.equal(h.requests[0].tools?.length ?? 0, 0)
  assert.equal(h.ctx.agents.list().length, 0)
  assert.equal(out.version, '2')
  assert.equal(out.evaluatorId, 'native-docs-semantic-fast')
  const receipt = JSON.parse(readFileSync(out.evidence[0].judgmentPath, 'utf8'))
  assert.equal(receipt.rows[0].supported, true)
  assert.equal(receipt.rows[0].semanticStatus, 'evaluated')
  assert.equal(receipt.sourceArtifactDigest, digest(h.artifact))
  assert.equal(out.costEvidence.usage.totalTokens, 110)
})
test('a semantic contradiction cannot pass from matching words or correct citations', async (t) => {
  const h = await host(t, {
    grades: {
      'fast-1': {
        supported: false,
        complete: false,
        contradiction: true,
        reason: 'The answer negates the supplied values.',
      },
    },
  })
  const out = await h.ctx.duoEvaluators.evaluate({
    candidate: h.candidate,
    artifact: {
      ...h.artifact,
      text: JSON.stringify({
        'fast-1': { answer: 'Not alpha or beta. Only root.', citations: ['fast.md'] },
      }),
    },
    tier: 'fast',
  })
  assert.equal(out.ok, true)
  assert.equal(out.metrics.quality, 0)
  assert.equal(out.metrics.contradiction_rate, 1)
  assert.equal(out.metrics.grounded, true)
  assert.equal(out.costCny, 0.000332)
})
test('identity or task-set mismatch refuses before a paid judge request', async (t) => {
  const h = await host(t)
  for (const changed of [
    { candidateId: 'foreign' },
    { candidateVersion: 'foreign' },
    { tier: 'slow' },
    { dataId: 'foreign' },
    { datasetDigest: 'foreign' },
    { status: 'failed' },
    { text: '{}' },
  ]) {
    const out = await h.ctx.duoEvaluators.evaluate({
      candidate: h.candidate,
      artifact: { ...h.artifact, ...changed },
      tier: 'fast',
    })
    assert.equal(out.ok, false)
    assert.equal(out.costCny, 0)
    assert.equal(out.error.code, 'DUO_EVIDENCE_INVALID')
  }
  assert.equal(h.requests.length, 0)
})
test('malformed judge result retains actual cost, and missing usage never becomes zero', async (t) => {
  for (const scenario of [{ malformed: true }, { missingUsage: true }]) {
    const h = await host(t, scenario),
      out = await h.ctx.duoEvaluators.evaluate({
        candidate: h.candidate,
        artifact: h.artifact,
        tier: 'fast',
      })
    assert.equal(out.ok, false)
    assert.equal(out.metrics.sample_size, 0)
    assert.equal(h.requests.length, 1)
    assert.equal(out.costCny, scenario.missingUsage ? null : 0.000332)
    assert.equal(out.error.component, 'duoEvaluators')
    assert.equal(out.error.retryable, false)
  }
})
test('model approval cannot override deterministic citation failure or malformed answer shape', async (t) => {
  const h = await host(t)
  const out = await h.ctx.duoEvaluators.evaluate({
    candidate: h.candidate,
    artifact: {
      ...h.artifact,
      text: JSON.stringify({ 'fast-1': { answer: 'alpha and beta', citations: [] } }),
    },
    tier: 'fast',
  })
  assert.equal(out.ok, true)
  assert.equal(out.metrics.quality, 0)
  const before = h.requests.length,
    invalid = await h.ctx.duoEvaluators.evaluate({
      candidate: h.candidate,
      artifact: {
        ...h.artifact,
        text: JSON.stringify({ 'fast-1': { answer: 3, citations: ['fast.md'] } }),
      },
      tier: 'fast',
    })
  assert.equal(invalid.ok, true)
  assert.equal(invalid.metrics.quality, 0)
  assert.equal(invalid.costCny, 0)
  assert.equal(h.requests.length, before)
})
test('a judgment write failure retains the settled judge cost and fails closed with a structured error', async (t) => {
  const h = await host(t)
  const blocked = join(h.root, 'blocked-judgments')
  writeFileSync(blocked, 'occupied')
  const scoped = h.ctx.isolate('duoEvaluators'),
    f = await scoped.plugin(SemanticEvaluators, { ...h.config, judgmentRoot: blocked })
  t.after(() => f.dispose())
  const out = await scoped.duoEvaluators.evaluate({
    candidate: h.candidate,
    artifact: h.artifact,
    tier: 'fast',
  })
  assert.equal(h.requests.length, 1)
  assert.equal(out.ok, false)
  assert.equal(out.metrics.sample_size, 0)
  assert.equal(out.costCny, 0.000332)
  assert.equal(out.error.code, 'DUO_RECEIPT_WRITE_FAILED')
  assert.equal(out.error.component, 'duoEvaluators')
  assert.equal(out.error.retryable, false)
  assert.equal(out.evidence[0].judgmentPath, null)
  assert.ok(out.evidence[0].judgeSessionReceipt)
})
test('inconsistent or incomplete semantic measurements fail closed with known cost', async (t) => {
  for (const grades of [
    {},
    {
      'fast-1': {
        supported: true,
        complete: true,
        contradiction: true,
        reason: 'Contradictory measurement',
      },
    },
    {
      'fast-1': { supported: 'yes', complete: true, contradiction: false, reason: 'Not a boolean' },
    },
  ]) {
    const h = await host(t, { grades }),
      out = await h.ctx.duoEvaluators.evaluate({
        candidate: h.candidate,
        artifact: h.artifact,
        tier: 'fast',
      })
    assert.equal(out.ok, false)
    assert.equal(out.error.code, 'DUO_JUDGE_INVALID')
    assert.equal(out.costCny, 0.000332)
  }
})
test('abort before admission is free and no private final examples enter a slow judgment', async (t) => {
  const h = await host(t),
    abort = new AbortController()
  abort.abort()
  const cancelled = await h.ctx.duoEvaluators.evaluate({
    candidate: h.candidate,
    artifact: h.artifact,
    tier: 'fast',
    signal: abort.signal,
  })
  assert.equal(cancelled.costCny, 0)
  assert.equal(cancelled.error.code, 'ABORTED')
  assert.equal(h.requests.length, 0)
  const out = await h.ctx.duoEvaluators.evaluate({
    candidate: h.candidate,
    artifact: {
      ...h.artifact,
      tier: 'slow',
      dataId: h.dataset.slow.id,
      text: JSON.stringify({ 'slow-1': { answer: 'alpha and beta', citations: ['slow.md'] } }),
    },
    tier: 'slow',
  })
  assert.equal(out.ok, true)
  assert.equal(out.metrics.quality, 1)
  assert.doesNotMatch(JSON.stringify(h.requests[0]), /final-1|PRIVATE_|fast-1/)
})
test('a changed frozen policy changes provider identity while the loaded instance stays fixed', async (t) => {
  const h = await host(t),
    before = h.ctx.duoEvaluators.describe(),
    file = join(h.root, 'changed-policy.json')
  const policy = JSON.parse(readFileSync(h.config.policyPath, 'utf8'))
  policy.rules.push('A new independently documented rule.')
  writeFileSync(file, JSON.stringify(policy))
  const scoped = h.ctx.isolate('duoEvaluators'),
    f = await scoped.plugin(SemanticEvaluators, { ...h.config, policyPath: file })
  t.after(() => f.dispose())
  assert.notEqual(scoped.duoEvaluators.describe()[0].policyDigest, before[0].policyDigest)
  assert.deepEqual(h.ctx.duoEvaluators.describe(), before)
})
