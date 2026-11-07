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
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { digest } from '../../native/store.js'
import { createModelSupportJudge } from '../../native/support-judge.js'
import * as ShadowEvaluator from '@dual-loop/dsh-plugin/examples/grounded-qa-shadow-evaluator'

async function supportHost(t, { response, missingUsage = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'duo-support-'))
  const dataset = {
    version: 1,
    fast: {
      id: 'support-dev-v1',
      tasks: [
        {
          id: 'task-1',
          input: 'QUESTION: Which port?\nSOURCE: runbook.md (lines 1-1)\nThe port is 443.',
          expected: { answer: '443', citations: ['runbook.md'], private: 'PRIVATE_GOLD' },
        },
      ],
    },
    final: { id: 'PRIVATE_FINAL', tasks: [{ id: 'final-1', input: 'PRIVATE_FINAL_QUESTION' }] },
  }
  const datasetPath = join(root, 'data.json')
  writeFileSync(datasetPath, JSON.stringify(dataset))
  const config = {
    provider: 'support-fixture',
    model: 'scripted',
    datasetPath,
    artifactRoot: join(root, 'receipts'),
    currency: 'CNY',
    reservationCny: 0.02,
    maxTokens: 128,
    maxInputBytes: 8192,
    timeoutMs: 3000,
    evidenceKind: 'fixture',
    pricing: {
      id: 'SYNTHETIC_NOT_REAL',
      currency: 'CNY',
      inputCnyPerMillion: 1,
      cacheReadCnyPerMillion: 0.1,
      outputCnyPerMillion: 2,
    },
  }
  const ctx = new Context(),
    fibers = [],
    requests = []
  for (const p of [AgentRegistry, Sessions, Projections, LlmRuntime, Tools])
    fibers.push(await ctx.plugin(p))
  fibers.push(
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false }),
  )
  class Adapter extends LlmAdapter {
    async *stream(options) {
      requests.push(options)
      const input = JSON.parse(
        options.messages.filter((m) => m.role === 'user').at(-1).content[0].text,
      )
      const output = response ?? Object.fromEntries(input.cases.map((c) => [c.id, 'supported']))
      yield {
        type: 'text-delta',
        index: 0,
        text: typeof output === 'string' ? output : JSON.stringify(output),
      }
      if (!missingUsage)
        yield {
          type: 'usage',
          usage: { inputTokens: 80, cacheReadTokens: 20, outputTokens: 10, totalTokens: 110 },
        }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  fibers.push(
    await ctx.plugin({
      name: 'support-scripted-model',
      inject: ['llm'],
      apply(c) {
        c.llm.registerAdapter(['support-fixture'], new Adapter())
      },
    }),
  )
  fibers.push(await ctx.plugin(AgentLoop, { agents: [] }))
  t.after(async () => {
    for (const f of fibers.reverse()) await f.dispose()
  })
  return { ctx, config, root, dataset, requests, dataDigest: digest(dataset) }
}
const cases = [{ id: 'claim-1', source: 'The service uses port 443.', claim: 'The port is 443.' }]
test('model backend uses one bounded native session with no gold/final/prompt leakage and retains usage', async (t) => {
  const h = await supportHost(t)
  const backend = createModelSupportJudge(h.ctx, h.config)
  const result = await backend.judge({ cases, identity: { sourceArtifactDigest: 'source-1' } })
  assert.equal(result.status, 'measured')
  assert.deepEqual(result.judgments, [{ id: 'claim-1', verdict: 'supported' }])
  assert.equal(h.requests.length, 1)
  assert.ok(!JSON.stringify(h.requests).includes('PRIVATE_'))
  assert.equal(result.currency, 'CNY')
  assert.equal(result.costCny, 0.000102)
  const receipt = JSON.parse(readFileSync(result.receiptPath, 'utf8'))
  assert.equal(receipt.costEvidence.attempts, 1)
  assert.equal(receipt.operation, 'support_judgment')
  assert.equal(backend.descriptor.maxRequests, 1)
  assert.equal(backend.descriptor.qualification, 'NOT_QUALIFIED')
})
test('model failure controls retain invalid output and missing usage separately without retries', async (t) => {
  for (const options of [
    { response: 'invalid JSON' },
    { response: { 'wrong-id': 'supported' } },
    { missingUsage: true },
  ]) {
    const h = await supportHost(t, options)
    const result = await createModelSupportJudge(h.ctx, h.config).judge({ cases })
    assert.equal(h.requests.length, 1)
    assert.equal(result.status, options.missingUsage ? 'failed' : 'invalid_output')
    assert.equal(result.costCny, options.missingUsage ? null : 0.000102)
    assert.ok(result.receiptPath)
  }
})
test('invalid projected input and pre-cancellation make no model request', async (t) => {
  const h = await supportHost(t)
  const backend = createModelSupportJudge(h.ctx, h.config)
  assert.equal((await backend.judge({ cases: [] })).status, 'invalid_input')
  const abort = new AbortController()
  abort.abort()
  assert.equal((await backend.judge({ cases, signal: abort.signal })).status, 'cancelled')
  assert.equal(h.requests.length, 0)
})

test('public sample composition evaluates actual answers and retains an opposite shadow label without changing the score', async (t) => {
  const h = await supportHost(t, { response: { 'task-1': 'contradicted' } })
  const fiber = await h.ctx.plugin(ShadowEvaluator, h.config)
  t.after(() => fiber.dispose())
  const descriptor = h.ctx.duoEvaluators.describe()[0]
  const result = await h.ctx.duoEvaluators.evaluate({
    candidate: { id: 'sample', version: 'v1', persona: 'PRIVATE_PROMPT' },
    tier: 'fast',
    artifact: {
      status: 'completed',
      candidateId: 'sample',
      candidateVersion: 'v1',
      tier: 'fast',
      dataId: h.dataset.fast.id,
      datasetDigest: h.dataDigest,
      text: JSON.stringify({ 'task-1': { answer: '443', citations: ['runbook.md'] } }),
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.metrics.task_accuracy, 1)
  assert.equal(result.evidence[0].correct, 1)
  assert.equal(result.evidence.at(-1).judgments[0].verdict, 'contradicted')
  assert.equal(result.costCny, 0.000102)
  assert.equal(h.requests.length, 1)
  assert.ok(!JSON.stringify(h.requests).includes('PRIVATE_'))
  assert.equal(descriptor.id, 'starter-runbook-fast-support-shadow')
  assert.equal(descriptor.version, '2+support-shadow.1')
  assert.equal(descriptor.evidenceSource.independentOfSearch, false)
  assert.deepEqual(descriptor.evidenceSource.coverage, ['task-1'])
  assert.equal(descriptor.evidenceSource.increment, undefined)
})
