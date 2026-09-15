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
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ModelExecutor from '../../native/model-executor.js'
import { modelSettings, pricingForInterval } from '../../native/model-call.js'
import ModelGenerator from '../../native/model-generator.js'
import StructuredGenerator from '../../native/structured-generator.js'
import { slowSearchFeedback } from '../../native/policies.js'
import { digest } from '../../native/store.js'
import DocsEvaluators, { judgeDocsAnswer } from '../../native/docs-evaluators.js'

const usage = { inputTokens: 80, cacheReadTokens: 20, outputTokens: 10, totalTokens: 110 }
const candidate = {
  id: 'c1',
  version: 'test-version',
  persona: 'Candidate persona UNIQUE. {{model}} {{cwd}}',
}
const historyFeedback = {
  historyCompleteness: 'all_latest_candidates',
  history: [{ candidateId: 'c1', fast: { tier: 'fast', ok: true, metrics: { quality: 0.5 } } }],
  evidence: 'insufficient_data',
}
test('code tasks reach the actual Agent without citation instructions or private tests', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'duo-code-data-')),
    datasetPath = join(root, 'data.json')
  const data = {
    version: 1,
    responseMode: 'python-code-v1',
    responseInstructions: 'Implement each function from its public specification.',
    ...Object.fromEntries(
      ['fast', 'slow', 'final'].map((tier) => [
        tier,
        {
          id: tier,
          tasks: [
            {
              id: tier + '-1',
              input: tier.toUpperCase() + '_INPUT',
              expected: 'SECRET_KEY_' + tier,
            },
          ],
        },
      ]),
    ),
  }
  writeFileSync(datasetPath, JSON.stringify(data))
  const { ctx, requests } = await host(t, normal, { datasetPath })
  await ctx.duoExecutor.execute({ candidate, applied: candidate, tier: 'fast' })
  const request = JSON.stringify(requests[0])
  assert.match(request, /Python source code/)
  assert.doesNotMatch(request, /citations|sourcePaths|SECRET_KEY|FINAL_INPUT|SLOW_INPUT/)
  assert.match(request, /Candidate persona UNIQUE/)
})
test('unknown code response modes fail before creating an Agent', async (t) => {
  const { config } = await host(t, normal)
  const data = JSON.parse(readFileSync(config.datasetPath, 'utf8'))
  data.responseMode = 'typo-code'
  writeFileSync(config.datasetPath, JSON.stringify(data))
  assert.throws(() => new ModelExecutor(new Context(), config), { code: 'DUO_DATA_INVALID' })
})
test('ModelExecutor runs only the optional review split through the existing owned Agent', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'duo-review-data-')),
    datasetPath = join(root, 'data.json')
  const data = {
    version: 1,
    ...Object.fromEntries(
      ['fast', 'review', 'slow', 'final'].map((tier) => [
        tier,
        {
          id: tier + '-v1',
          tasks: [
            {
              id: tier + '-task',
              input: tier.toUpperCase() + '_ONLY_INPUT',
              expected: 'PRIVATE_' + tier.toUpperCase(),
            },
          ],
        },
      ]),
    ),
  }
  writeFileSync(datasetPath, JSON.stringify(data))
  const { ctx, requests } = await host(
    t,
    async function* () {
      yield { type: 'text-delta', index: 0, text: '{"review-task":"ok"}' }
      yield { type: 'usage', usage }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
    { datasetPath },
  )
  const out = await ctx.duoExecutor.execute({ candidate, applied: candidate, tier: 'review' })
  assert.equal(out.artifact.status, 'completed')
  assert.equal(out.artifact.tier, 'review')
  assert.equal(out.artifact.dataId, 'review-v1')
  assert.equal(requests.length, 1)
  assert.match(JSON.stringify(requests[0]), /REVIEW_ONLY_INPUT/)
  assert.doesNotMatch(
    JSON.stringify(requests[0]),
    /FAST_ONLY_INPUT|SLOW_ONLY_INPUT|FINAL_ONLY_INPUT|PRIVATE_/,
  )
  assert.equal(ctx.agents.list().length, 0)
  assert.equal(out.costEvidence.attempts, 1)
  const duplicated = structuredClone(data)
  duplicated.review.tasks[0].id = duplicated.final.tasks[0].id
  writeFileSync(datasetPath, JSON.stringify(duplicated))
  assert.throws(() => modelSettings({ ...ctx.duoExecutor.state.config, datasetPath }), {
    code: 'DUO_DATA_INVALID',
  })
})
async function host(t, behavior, overrides = {}) {
  const ctx = new Context(),
    fibers = [],
    requests = [],
    root = mkdtempSync(join(tmpdir(), 'duo-executor-'))
  const dataset = {
    version: 1,
    fast: {
      id: 'fast-v1',
      tasks: [{ id: 'f1', input: 'FAST_INPUT', expected: 'SECRET_KEY_FAST' }],
    },
    slow: {
      id: 'slow-v1',
      tasks: [{ id: 's1', input: 'SLOW_INPUT', expected: 'SECRET_KEY_SLOW' }],
    },
    final: {
      id: 'final-v1',
      tasks: [{ id: 'z1', input: 'FINAL_HELD_OUT', expected: 'SECRET_KEY_FINAL' }],
    },
  }
  const datasetPath = join(root, 'data.json')
  writeFileSync(datasetPath, JSON.stringify(dataset))
  const config = {
    provider: 'test',
    model: 'offline',
    datasetPath,
    artifactRoot: join(root, 'artifacts'),
    maxTokens: 64,
    timeoutMs: 3000,
    reservationUsd: 0.01,
    evidenceKind: 'fixture',
    pricing: {
      id: 'synthetic-test-only',
      inputUsdPerMillion: 1,
      cacheReadUsdPerMillion: 0.1,
      outputUsdPerMillion: 2,
    },
    ...overrides,
  }
  for (const P of [AgentRegistry, Sessions, Projections, LlmRuntime, Tools])
    fibers.push(await ctx.plugin(P))
  fibers.push(
    await ctx.plugin(SystemPrompt, {
      includeHarnessIdentity: false,
      includeRuntimeContext: false,
      persona: 'HOST_PERSONA',
    }),
  )
  class Adapter extends LlmAdapter {
    async *stream(options) {
      requests.push(options)
      yield* behavior(options)
    }
  }
  const adapter = {
    name: 'executor-test-adapter',
    inject: ['llm'],
    apply(c) {
      c.llm.registerAdapter(['test'], new Adapter())
    },
  }
  fibers.push(await ctx.plugin(adapter))
  fibers.push(await ctx.plugin(AgentLoop, { agents: [] }))
  fibers.push(await ctx.plugin(ModelExecutor, config))
  t.after(async () => {
    for (const f of fibers.reverse()) await f.dispose()
  })
  return { ctx, requests, root, config }
}
async function* normal() {
  yield { type: 'text-delta', index: 0, text: '{"f1":"answer"}' }
  yield { type: 'usage', usage }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

test('Executor uses the real DSH Agent loop, scoped persona and tier; no answer key reaches the model', async (t) => {
  const { ctx, requests } = await host(t, normal)
  const out = await ctx.duoExecutor.execute({ candidate, applied: candidate, tier: 'fast' })
  assert.equal(requests.length, 1)
  assert.match(requests[0].system, /Candidate persona UNIQUE/)
  assert.doesNotMatch(requests[0].system, /HOST_PERSONA|\{\{model\}\}/)
  assert.match(JSON.stringify(requests[0].messages), /FAST_INPUT/)
  assert.doesNotMatch(JSON.stringify(requests[0]), /SECRET_KEY|FINAL_HELD_OUT|SLOW_INPUT/)
  assert.equal(requests[0].tools?.length ?? 0, 0)
  assert.equal(requests[0].maxTokens, 64)
  assert.equal(out.artifact.status, 'completed')
  assert.equal(out.artifact.tier, 'fast')
  assert.equal(out.artifact.candidateId, 'c1')
  assert.equal(out.costUsd, 0.000102)
  assert.equal(out.costEvidence.kind, 'fixture')
  assert.deepEqual(out.costEvidence.usage, usage)
  const receipt = JSON.parse(readFileSync(out.artifact.receiptPath, 'utf8'))
  assert.ok(receipt.sessionEvents.some((e) => e.type === 'turn/end'))
  assert.equal(receipt.hostPid, process.pid)
  assert.equal(ctx.agents.list().length, 0)
  const second = await ctx.duoExecutor.execute({
    candidate: { ...candidate, id: 'c2', persona: 'SECOND_ONLY' },
    applied: { ...candidate, id: 'c2', persona: 'SECOND_ONLY' },
    tier: 'slow',
  })
  assert.notEqual(second.artifact.sessionId, out.artifact.sessionId)
  assert.doesNotMatch(requests[1].system, /Candidate persona UNIQUE/)
  assert.match(JSON.stringify(requests[1].messages), /SLOW_INPUT/)
})
test('Executor refuses to fabricate exact costs when usage is missing or internally inconsistent', async (t) => {
  for (const reported of [null, { ...usage, totalTokens: 999 }]) {
    const { ctx } = await host(t, async function* () {
      yield { type: 'text-delta', index: 0, text: 'ok' }
      if (reported) yield { type: 'usage', usage: reported }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    const out = await ctx.duoExecutor.execute({ candidate, applied: candidate, tier: 'fast' })
    assert.equal(out.costUsd, null)
    assert.equal(out.costEvidence.complete, false)
  }
})
test('Executor cancellation drains the owned Agent and retains received usage', async (t) => {
  const abort = new AbortController()
  const { ctx, requests } = await host(t, async function* (options) {
    yield { type: 'usage', usage }
    abort.abort()
    yield { type: 'finish', reason: { kind: 'aborted' } }
  })
  const out = await ctx.duoExecutor.execute({
    candidate,
    applied: candidate,
    tier: 'fast',
    signal: abort.signal,
  })
  assert.equal(requests.length, 1)
  assert.equal(out.artifact.status, 'cancelled')
  assert.equal(out.costUsd, 0.000102)
  assert.equal(ctx.agents.list().length, 0)
})
test('Executor rejects unconfigured tiers before any model attempt', async (t) => {
  const { ctx, requests } = await host(t, normal)
  await assert.rejects(ctx.duoExecutor.execute({ candidate, applied: candidate, tier: 'secret' }), {
    code: 'DUO_DATA_INVALID',
  })
  assert.equal(requests.length, 0)
})
test('published Agent cancellation reaches a still-running adapter request', async (t) => {
  const abort = new AbortController()
  let sawAbort = false
  const { ctx } = await host(t, async function* (options) {
    yield { type: 'usage', usage }
    await new Promise((resolve) => {
      const fallback = setTimeout(resolve, 100)
      options.signal.addEventListener(
        'abort',
        () => {
          sawAbort = true
          clearTimeout(fallback)
          resolve()
        },
        { once: true },
      )
      abort.abort()
    })
    yield { type: 'finish', reason: { kind: 'aborted' } }
  })
  const out = await ctx.duoExecutor.execute({
    candidate,
    applied: candidate,
    tier: 'fast',
    signal: abort.signal,
  })
  assert.equal(sawAbort, true)
  assert.equal(out.costUsd, 0.000102)
  assert.equal(ctx.agents.list().length, 0)
  assert.equal(out.artifact.terminal.reason.kind, 'parent')
})
test('a host request override cannot silently change the frozen route or token cap', async (t) => {
  const { ctx, requests } = await host(t, normal)
  ctx.on('agent/request', async (event, next) => ({ ...(await next()), maxTokens: 999999 }))
  const out = await ctx.duoExecutor.execute({ candidate, applied: candidate, tier: 'fast' })
  assert.equal(requests.length, 0)
  assert.equal(out.artifact.status, 'failed')
  assert.equal(out.costUsd, 0)
  assert.equal(out.error.code, 'DUO_MODEL_ROUTE_CHANGED')
  assert.equal(out.error.component, 'duoExecutor')
  assert.equal(out.error.retryable, false)
  assert.match(out.error.message, /differs from the inspected model route/)
  assert.ok(out.error.nextAction)
})
test('a receipt write failure retains the settled cost as a structured failure instead of a raw fs error', async (t) => {
  const { ctx, config, root, requests } = await host(t, normal)
  const blocked = join(root, 'blocked-artifacts')
  writeFileSync(blocked, 'occupied')
  const scoped = ctx.isolate('duoExecutor'),
    p = await scoped.plugin(ModelExecutor, { ...config, artifactRoot: blocked })
  t.after(() => p.dispose())
  const out = await scoped.duoExecutor.execute({ candidate, applied: candidate, tier: 'fast' })
  assert.equal(requests.length, 1)
  assert.equal(out.costUsd, 0.000102)
  assert.equal(out.artifact.status, 'failed')
  assert.equal(out.artifact.receiptPath, null)
  assert.equal(out.costEvidence.receiptPath, null)
  assert.deepEqual(out.costEvidence.usage, usage)
  assert.equal(out.error.code, 'DUO_RECEIPT_WRITE_FAILED')
  assert.equal(out.error.component, 'duoExecutor')
  assert.equal(out.error.retryable, false)
  assert.ok(out.error.nextAction)
})
test('model preflight rejects missing prices or a reservation below the bounded request envelope', async (t) => {
  const { config } = await host(t, normal)
  assert.throws(() => modelSettings({ ...config, pricing: null }), {
    code: 'DUO_MODEL_CONFIG_INVALID',
  })
  assert.throws(() => modelSettings({ ...config, reservationUsd: 0.000001 }), {
    code: 'DUO_MODEL_CONFIG_INVALID',
  })
})
test('oversized assembled request is refused before adapter dispatch', async (t) => {
  const { ctx, requests } = await host(t, normal)
  const large = { ...candidate, persona: 'A'.repeat(10000) }
  const out = await ctx.duoExecutor.execute({ candidate: large, applied: large, tier: 'fast' })
  assert.equal(requests.length, 0)
  assert.equal(out.costUsd, 0)
  assert.equal(out.artifact.status, 'failed')
})
test('Executor uses the authoritative assembled DSH message for block-end-only adapters', async (t) => {
  const { ctx } = await host(t, async function* () {
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'assembled answer' } }
    yield { type: 'usage', usage }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  const out = await ctx.duoExecutor.execute({ candidate, applied: candidate, tier: 'fast' })
  assert.equal(out.artifact.text, 'assembled answer')
})
test('native generator uses one Agent call, controller IDs and parent bindings, without slow/final data', async (t) => {
  const { ctx, config, requests } = await host(t, async function* () {
    yield {
      type: 'text-delta',
      index: 0,
      text: JSON.stringify({
        candidates: [
          {
            mode: 'exploit',
            family: 'grounding',
            hypothesis: 'Explicit grounded answers may help',
            persona: 'Improved {{model}} {{cwd}}',
          },
        ],
      }),
    }
    yield { type: 'usage', usage }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  const f = await ctx.plugin(ModelGenerator, config)
  t.after(() => f.dispose())
  const out = await ctx.duoGenerator.propose({
    champion: candidate,
    quotas: { exploit: 1, explore: 0, innovate: 0 },
    generation: 1,
    feedback: { evidence: 'insufficient_data' },
    nextId: () => 'owned-id',
  })
  assert.equal(requests.length, 1)
  assert.equal(out.candidates[0].id, 'owned-id')
  assert.equal(out.candidates[0].parentId, candidate.id)
  assert.equal(out.candidates[0].parentVersion, candidate.version)
  assert.equal(out.costUsd, 0.000102)
  assert.doesNotMatch(
    JSON.stringify(requests),
    /FINAL_HELD_OUT|SECRET_KEY_FINAL|SLOW_INPUT|SECRET_KEY_SLOW/,
  )
})
test('malformed generated JSON retains the completed usage cost instead of a free retry', async (t) => {
  const { ctx, config, requests } = await host(t, normal),
    f = await ctx.plugin(ModelGenerator, config)
  t.after(() => f.dispose())
  const out = await ctx.duoGenerator.propose({
    champion: candidate,
    quotas: { exploit: 1, explore: 0, innovate: 0 },
    generation: 1,
    feedback: {},
    nextId: () => 'unused',
  })
  assert.equal(out.candidates, null)
  assert.equal(out.costUsd, 0.000102)
  assert.equal(requests.length, 1)
})
test('missing persona is diagnosed precisely without retry, fabricated overlay or lost usage', async (t) => {
  const text = JSON.stringify({
    candidates: [{ mode: 'exploit', family: 'ledger', hypothesis: 'Check evidence.' }],
  })
  const { ctx, config, requests } = await host(t, async function* () {
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'usage', usage }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  const f = await ctx.plugin(ModelGenerator, config)
  t.after(() => f.dispose())
  const out = await ctx.duoGenerator.propose({
    champion: candidate,
    quotas: { exploit: 1, explore: 0, innovate: 0 },
    generation: 1,
    feedback: {},
    nextId: () => {
      throw new Error('Invalid output cannot acquire an ID')
    },
  })
  assert.equal(out.candidates, null)
  assert.equal(requests.length, 1)
  assert.equal(out.costUsd, 0.000102)
  assert.equal(out.artifact.text, text)
  assert.equal(out.error.code, 'DUO_CANDIDATES_INVALID')
  assert.equal(out.error.retryable, false)
  assert.deepEqual(out.error.validation, {
    reason: 'shape',
    candidateIndex: 0,
    missingFields: ['persona'],
    extraFields: [],
    invalidFields: [],
  })
  assert.match(out.error.message, /candidate 0.*missing.*persona/)
})
test('structured generator uses one actual DSH Agent request, full Fast inputs and assigned operators', async (t) => {
  const response = {
    candidates: [
      { slot: 'exploit-1', hypothesis: 'refine', change: { suffix: 'Be precise.' } },
      {
        slot: 'explore-1',
        hypothesis: 'replace',
        change: { persona: 'New {{model}} {{cwd}} strategy.' },
      },
      {
        slot: 'innovate-1',
        hypothesis: 'compose',
        change: { components: ['Check sources.', 'Check claims.'] },
      },
    ],
  }
  const { ctx, config, requests } = await host(t, async function* () {
    yield { type: 'text-delta', index: 0, text: JSON.stringify(response) }
    yield { type: 'usage', usage }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  const dataset = JSON.parse(readFileSync(config.datasetPath, 'utf8'))
  dataset.fast.tasks.push(
    { id: 'f2', input: 'FAST_SECOND', expected: {} },
    { id: 'f3', input: 'FAST_THIRD_PREVIOUSLY_OMITTED', expected: {} },
  )
  writeFileSync(config.datasetPath, JSON.stringify(dataset))
  const { reservationUsd, ...base } = config
  const cny = {
    ...base,
    currency: 'CNY',
    reservationCny: 0.15,
    maxInputBytes: 16384,
    pricing: {
      id: 'fixture-cny',
      currency: 'CNY',
      inputCnyPerMillion: 1,
      cacheReadCnyPerMillion: 0.1,
      outputCnyPerMillion: 2,
    },
  }
  const f = await ctx.plugin(StructuredGenerator, cny)
  t.after(() => f.dispose())
  let seq = 0
  const out = await ctx.duoGenerator.propose({
    champion: candidate,
    feedback: historyFeedback,
    quotas: { exploit: 1, explore: 1, innovate: 1 },
    generation: 1,
    nextId: () => String(++seq),
  })
  assert.equal(requests.length, 1)
  assert.equal(out.costCny, 0.000102)
  assert.equal(out.candidates.length, 3)
  assert.match(JSON.stringify(requests), /FAST_THIRD_PREVIOUSLY_OMITTED/)
  assert.doesNotMatch(
    JSON.stringify(requests),
    /FINAL_HELD_OUT|SECRET_KEY_FINAL|SLOW_INPUT|SECRET_KEY_SLOW/,
  )
  assert.equal(out.costEvidence.kind, 'fixture')
  assert.equal(ctx.agents.list().length, 0)
  assert.equal(out.artifact.operatorSlots.length, 3)
  assert.ok(out.artifact.historyDigest)
})
test('structured generator malformed output retains usage, never retries; missing history refuses before a model call', async (t) => {
  const { ctx, config, requests } = await host(t, normal),
    f = await ctx.plugin(StructuredGenerator, {
      ...config,
      maxInputBytes: 16384,
      reservationUsd: 0.05,
    })
  t.after(() => f.dispose())
  const args = {
    champion: candidate,
    feedback: historyFeedback,
    quotas: { exploit: 1, explore: 0, innovate: 0 },
    generation: 1,
    nextId: () => '',
  }
  const out = await ctx.duoGenerator.propose(args)
  assert.equal(out.candidates, null)
  assert.equal(out.costUsd, 0.000102)
  assert.equal(requests.length, 1)
  const refused = await ctx.duoGenerator.propose({ ...args, feedback: {} })
  assert.equal(refused.error.code, 'DUO_HISTORY_REQUIRED')
  assert.equal(refused.costUsd, 0)
  assert.equal(requests.length, 1)
})
test('both native generators put allowed Slow facts into actual DSH adapter requests with traceable input identities', async (t) => {
  for (const P of [ModelGenerator, StructuredGenerator]) {
    const response =
      P === ModelGenerator
        ? {
            candidates: [
              {
                mode: 'exploit',
                family: 'safety',
                hypothesis: 'Preserve the constraint',
                persona: 'Safer {{model}} {{cwd}}',
              },
            ],
          }
        : {
            candidates: [
              {
                slot: 'exploit-1',
                hypothesis: 'Preserve the constraint',
                change: { suffix: 'Check safety.' },
              },
            ],
          }
    const { ctx, config, requests } = await host(t, async function* () {
      yield { type: 'text-delta', index: 0, text: JSON.stringify(response) }
      yield { type: 'usage', usage }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    const { reservationUsd, ...base } = config,
      cny = {
        ...base,
        currency: 'CNY',
        reservationCny: 0.15,
        maxInputBytes: 16384,
        pricing: {
          id: 'fixture-cny',
          currency: 'CNY',
          inputCnyPerMillion: 1,
          cacheReadCnyPerMillion: 0.1,
          outputCnyPerMillion: 2,
        },
      }
    const f = await ctx.plugin(P, cny)
    t.after(() => f.dispose())
    const feedback = {
      ...historyFeedback,
      slowFeedback: slowSearchFeedback(
        [
          {
            candidateId: 'failed',
            generation: 1,
            slowVerdict: 'constraint_violation',
            slowDecision: 'incomparable',
            slow: {
              candidateId: 'failed',
              evaluatorId: 'constraint-measurement',
              version: '2',
              dataId: 'slow-search-v2',
              tier: 'slow',
              ok: true,
              metrics: { safe: false, quality: 0.3 },
              evidence: 'PRIVATE_SLOW',
            },
          },
        ],
        [{ metric: 'safe', op: '==', value: true }],
      ),
    }
    const out = await ctx.duoGenerator.propose({
      champion: candidate,
      feedback,
      quotas: { exploit: 1, explore: 0, innovate: 0 },
      generation: 2,
      nextId: () => 'owned',
    })
    assert.equal(requests.length, 1)
    assert.equal(out.candidates.length, 1)
    assert.equal(out.artifact.feedbackDigest, digest(feedback))
    assert.match(JSON.stringify(requests[0].messages), /constraint_violation/)
    assert.match(JSON.stringify(requests[0].messages), /constraint-measurement/)
    assert.doesNotMatch(
      JSON.stringify(requests[0]),
      /PRIVATE_SLOW|SECRET_KEY_SLOW|FINAL_HELD_OUT|SECRET_KEY_FINAL/,
    )
    const receipt = JSON.parse(readFileSync(out.artifact.receiptPath, 'utf8'))
    assert.equal(receipt.feedbackDigest, digest(feedback))
  }
})
test('both generators consume bounded warm history in actual offline DSH requests and bind the sanitized context receipt', async (t) => {
  for (const P of [ModelGenerator, StructuredGenerator]) {
    const response =
      P === ModelGenerator
        ? {
            candidates: [
              {
                mode: 'exploit',
                family: 'warm',
                hypothesis: 'test historical idea',
                persona: 'Warm {{model}} {{cwd}}',
              },
            ],
          }
        : {
            candidates: [
              {
                slot: 'exploit-1',
                hypothesis: 'test historical idea',
                change: { suffix: 'Check historical idea.' },
              },
            ],
          }
    const { ctx, config, requests } = await host(t, async function* () {
      yield { type: 'text-delta', index: 0, text: JSON.stringify(response) }
      yield { type: 'usage', usage }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    const f = await ctx.plugin(P, { ...config, maxInputBytes: 32768, reservationUsd: 0.05 })
    t.after(() => f.dispose())
    const { projectWarmContext } = await import('../../native/warm-start.js')
    const warmStart = {
      kind: 'native_journal_search_history',
      version: '1',
      currentBaseline: { id: candidate.id, version: candidate.version },
      records: [
        {
          source: {
            runId: 'prior-authorized-run',
            candidateId: 'old-candidate',
            candidateVersion: 'old-version',
            parentId: 'baseline',
            parentVersion: 'old-base',
            generation: 1,
            evaluators: [],
          },
          use: 'ideas_only',
          reasons: ['provider_declarations_changed'],
          role: 'failure',
          evidenceKinds: ['fixture'],
          hypothesis: 'HISTORICAL_IDEA_RETEST',
          delta: { kind: 'cordis-overlay', target: 'system-prompt', persona: 'HISTORICAL_OVERLAY' },
          final: 'PRIVATE_WARM_FINAL',
          observations: { final: 'PRIVATE_WARM_FINAL' },
        },
      ],
      final: 'PRIVATE_WARM_FINAL',
      permissions: { paid: true },
    }
    const feedback = { ...historyFeedback, warmStart },
      out = await ctx.duoGenerator.propose({
        champion: candidate,
        feedback,
        quotas: { exploit: 1, explore: 0, innovate: 0 },
        generation: 1,
        nextId: () => 'warm-child',
      })
    assert.equal(requests.length, 1)
    assert.equal(out.candidates.length, 1)
    assert.match(JSON.stringify(requests[0].messages), /HISTORICAL_IDEA_RETEST/)
    assert.match(JSON.stringify(requests[0].messages), /prior-authorized-run/)
    assert.doesNotMatch(
      JSON.stringify(requests[0].messages),
      /PRIVATE_WARM_FINAL|SECRET_KEY_FINAL|FINAL_HELD_OUT/,
    )
    const expected = digest(
      projectWarmContext(warmStart, (await import('../../native/target.js')).projectPersonaDelta),
    )
    assert.equal(out.artifact.warmStartDigest, expected)
    const receipt = JSON.parse(readFileSync(out.artifact.receiptPath, 'utf8'))
    assert.equal(receipt.warmStartDigest, expected)
    assert.equal(receipt.costEvidence.kind, 'fixture')
  }
})
test('real evaluator judges model answers and citations; failed/mismatched evidence is never admitted', async (t) => {
  const { ctx, config, root } = await host(t, normal)
  const dataset = JSON.parse(readFileSync(config.datasetPath, 'utf8'))
  for (const tier of ['fast', 'slow', 'final'])
    dataset[tier].tasks[0].expected = {
      type: 'single_fact',
      answerKeys: ['3080'],
      goldFiles: ['guide.md'],
      allowedFiles: ['guide.md'],
      question: 'Port?',
    }
  writeFileSync(config.datasetPath, JSON.stringify(dataset))
  const f = await ctx.plugin(DocsEvaluators, {
    datasetPath: config.datasetPath,
    artifactRoot: join(root, 'judgments'),
    evidenceKind: 'model',
  })
  t.after(() => f.dispose())
  const d = ctx.duoEvaluators.describe().find((d) => d.tier === 'fast')
  const artifact = {
    candidateId: candidate.id,
    candidateVersion: candidate.version,
    tier: 'fast',
    dataId: 'fast-v1',
    datasetDigest: d.datasetDigest,
    status: 'completed',
    text: JSON.stringify({ f1: { answer: 'Use 127.0.0.1:3080', citations: ['docs/guide.md'] } }),
    receiptPath: 'test-receipt',
    sessionId: 'test',
  }
  const result = await ctx.duoEvaluators.evaluate({ candidate, artifact, tier: 'fast' })
  assert.equal(result.ok, true)
  assert.equal(result.metrics.quality, 1)
  assert.equal(result.costUsd, 0)
  const wrong = await ctx.duoEvaluators.evaluate({
    candidate,
    artifact: { ...artifact, text: JSON.stringify({ f1: { answer: '3080', citations: [] } }) },
    tier: 'fast',
  })
  assert.equal(wrong.metrics.quality, 0)
  for (const altered of [
    { candidateId: 'other' },
    { tier: 'final' },
    { dataId: 'other' },
    { datasetDigest: 'other' },
    { status: 'failed' },
    { text: 'invalid json' },
  ]) {
    const invalid = await ctx.duoEvaluators.evaluate({
      candidate,
      artifact: { ...artifact, ...altered },
      tier: 'fast',
    })
    assert.equal(invalid.ok, false)
  }
})
test('a docs judgment write failure fails closed with a structured error and no fabricated evidence path', async (t) => {
  const { ctx, config, root } = await host(t, normal)
  const dataset = JSON.parse(readFileSync(config.datasetPath, 'utf8'))
  for (const tier of ['fast', 'slow', 'final'])
    dataset[tier].tasks[0].expected = {
      type: 'single_fact',
      answerKeys: ['3080'],
      goldFiles: ['guide.md'],
      allowedFiles: ['guide.md'],
      question: 'Port?',
    }
  writeFileSync(config.datasetPath, JSON.stringify(dataset))
  const blocked = join(root, 'blocked-judgments')
  writeFileSync(blocked, 'occupied')
  const f = await ctx.plugin(DocsEvaluators, {
    datasetPath: config.datasetPath,
    artifactRoot: blocked,
    evidenceKind: 'model',
  })
  t.after(() => f.dispose())
  const d = ctx.duoEvaluators.describe().find((d) => d.tier === 'fast')
  const artifact = {
    candidateId: candidate.id,
    candidateVersion: candidate.version,
    tier: 'fast',
    dataId: 'fast-v1',
    datasetDigest: d.datasetDigest,
    status: 'completed',
    text: JSON.stringify({ f1: { answer: 'Use 127.0.0.1:3080', citations: ['docs/guide.md'] } }),
    receiptPath: 'test-receipt',
    sessionId: 'test',
  }
  const out = await ctx.duoEvaluators.evaluate({ candidate, artifact, tier: 'fast' })
  assert.equal(out.ok, false)
  assert.equal(out.metrics.sample_size, 0)
  assert.equal(out.costUsd, 0)
  assert.equal(out.error.code, 'DUO_RECEIPT_WRITE_FAILED')
  assert.equal(out.error.component, 'duoEvaluators')
  assert.equal(out.error.retryable, false)
  assert.ok(out.error.nextAction)
  assert.equal(out.evidence[0].judgmentPath, null)
})
test('DeepSeek weekday UTC pricing chooses off-peak or peak, refusing ambiguous boundary crossings', () => {
  const p = {
    id: 'tariff',
    inputUsdPerMillion: 0.44,
    cacheReadUsdPerMillion: 0.014,
    outputUsdPerMillion: 1.32,
    schedule: 'deepseek-weekday-utc-v1',
  }
  assert.equal(
    pricingForInterval(p, '2026-09-08T02:00:00Z', '2026-09-08T02:01:00Z').outputUsdPerMillion,
    1.32,
  )
  assert.equal(
    pricingForInterval(p, '2026-09-08T05:00:00Z', '2026-09-08T05:01:00Z').outputUsdPerMillion,
    0.66,
  )
  assert.equal(
    pricingForInterval(p, '2026-09-12T02:00:00Z', '2026-09-12T02:01:00Z').outputUsdPerMillion,
    0.66,
  )
  assert.equal(pricingForInterval(p, '2026-09-08T03:59:55Z', '2026-09-08T04:00:05Z'), null)
})
test('copying a question with gold words cannot earn document-answer credit', () => {
  const expected = {
    type: 'single_fact',
    question: 'Use the terms sole and fail.',
    answerKeys: ['sole', 'fail'],
    goldFiles: ['source.md'],
    allowedFiles: ['source.md'],
  }
  assert.equal(
    judgeDocsAnswer(expected, { answer: expected.question, citations: ['source.md'] }).passed,
    false,
  )
  assert.equal(
    judgeDocsAnswer(expected, {
      answer:
        expected.question +
        ' One complete section becomes the sole prompt; multiple complete sections fail.',
      citations: ['source.md'],
    }).passed,
    true,
  )
})
test('CNY model calls use official yuan rates and keep currency on the session receipt', async (t) => {
  const { ctx } = await host(t, normal, {
    currency: 'CNY',
    reservationUsd: undefined,
    reservationCny: 0.15,
    pricing: {
      id: 'cny-fixture',
      currency: 'CNY',
      inputCnyPerMillion: 3,
      cacheReadCnyPerMillion: 0.1,
      outputCnyPerMillion: 9,
    },
  })
  const out = await ctx.duoExecutor.execute({ candidate, applied: candidate, tier: 'fast' })
  assert.equal(out.costCny, 0.000332)
  assert.equal(out.costUsd, undefined)
  assert.equal(out.currency, 'CNY')
  const receipt = JSON.parse(readFileSync(out.artifact.receiptPath, 'utf8'))
  assert.equal(receipt.currency, 'CNY')
  assert.equal(receipt.costCny, out.costCny)
  assert.equal(receipt.costEvidence.currency, 'CNY')
})
test('CNY pricing applies the same official peak schedule and rejects a mixed price table', async (t) => {
  const { config } = await host(t, normal)
  const pricing = {
    id: 'cny',
    currency: 'CNY',
    inputCnyPerMillion: 3,
    cacheReadCnyPerMillion: 0.1,
    outputCnyPerMillion: 9,
    schedule: 'deepseek-weekday-utc-v1',
  }
  const discounted = pricingForInterval(pricing, '2026-09-08T16:01:00Z', '2026-09-08T16:01:30Z')
  assert.equal(discounted.inputCnyPerMillion, 1.5)
  assert.equal(discounted.outputCnyPerMillion, 4.5)
  assert.throws(() => modelSettings({ ...config, pricing }), { code: 'DUO_CURRENCY_MISMATCH' })
  assert.throws(
    () =>
      modelSettings({
        ...config,
        currency: 'CNY',
        reservationUsd: undefined,
        reservationCny: 0.15,
        pricing: { ...pricing, inputUsdPerMillion: 1 },
      }),
    { code: 'DUO_CURRENCY_MISMATCH' },
  )
})
test('DeepSeek native stop finish plus completed turn is successful; truncation is not', async (t) => {
  for (const kind of ['stop', 'max-tokens', 'tool-calls', 'error']) {
    const { ctx } = await host(t, async function* () {
      yield { type: 'text-delta', index: 0, text: '{"f1":"answer"}' }
      yield { type: 'usage', usage }
      yield { type: 'finish', reason: { kind } }
    })
    const out = await ctx.duoExecutor.execute({ candidate, applied: candidate, tier: 'fast' })
    assert.equal(out.artifact.status, kind === 'stop' ? 'completed' : 'failed')
    assert.equal(out.costUsd, 0.000102)
  }
})
test('Executor enumerates citation paths from public source markers without sending private judge fields', async (t) => {
  const { ctx, config, requests } = await host(t, normal)
  const data = JSON.parse(readFileSync(config.datasetPath, 'utf8'))
  data.fast.tasks[0].input =
    'QUESTION: Example?\nSOURCE: subsystems/example.md (lines 1-3, snapshot pinned)\nPublic excerpt.'
  data.fast.tasks[0].expected = { goldFiles: ['PRIVATE_GOLD.md'], answerKeys: ['PRIVATE_ANSWER'] }
  const file = config.datasetPath + '.citations.json'
  writeFileSync(file, JSON.stringify(data))
  // Use the already initialized host lifecycle through a fresh provider scope.
  const scoped = ctx.isolate('duoExecutor'),
    p = await scoped.plugin(ModelExecutor, { ...config, datasetPath: file })
  t.after(() => p.dispose())
  await scoped.duoExecutor.execute({ candidate, applied: candidate, tier: 'fast' })
  const prompt = JSON.parse(
    requests
      .at(-1)
      .messages.filter((m) => m.role === 'user')
      .at(-1).content[0].text,
  )
  assert.deepEqual(prompt.tasks[0].sourcePaths, ['subsystems/example.md'])
  assert.match(prompt.instruction, /line numbers/)
  assert.doesNotMatch(JSON.stringify(prompt), /PRIVATE_GOLD|PRIVATE_ANSWER/)
})
