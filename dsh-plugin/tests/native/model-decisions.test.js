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
import { mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createModelDecisionJudge } from '../../native/model-decisions.js'
import * as ModelDecisions from '../../native/model-decisions.js'
import * as DecisionTools from '../../native/decision-tools.js'
import { SqliteJournal, ReservedBudget } from '../../native/store.js'

async function host(t, { raw, missingUsage = false } = {}) {
  const ctx = new Context(),
    fibers = [],
    requests = [],
    root = mkdtempSync(join(tmpdir(), 'duo-decision-model-'))
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
      const output =
        raw ??
        JSON.stringify(
          Object.fromEntries(
            Object.entries(input.questions).map(([id, q]) => [
              id,
              q.type === 'boolean' ? true : q.type === 'score' ? 0 : Object.keys(q.criteria)[0],
            ]),
          ),
        )
      yield { type: 'text-delta', index: 0, text: output }
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
      name: 'decision-fixture-adapter',
      inject: ['llm'],
      apply(c) {
        c.llm.registerAdapter(['decision-fixture'], new Adapter())
      },
    }),
  )
  fibers.push(await ctx.plugin(AgentLoop, { agents: [] }))
  t.after(async () => {
    for (const f of fibers.reverse()) await f.dispose()
  })
  return {
    ctx,
    requests,
    root,
    fibers,
    config: {
      provider: 'decision-fixture',
      model: 'scripted',
      artifactRoot: join(root, 'receipts'),
      currency: 'CNY',
      reservationCny: 0.02,
      maxTokens: 256,
      maxInputBytes: 8192,
      timeoutMs: 3000,
      evidenceKind: 'fixture',
      pricing: {
        id: 'SYNTHETIC_NOT_A_PRICE_QUOTE',
        currency: 'CNY',
        inputCnyPerMillion: 1,
        cacheReadCnyPerMillion: 0.1,
        outputCnyPerMillion: 2,
      },
    },
  }
}
const input = {
  state: { report: 'The build passed, deployment awaits approval.' },
  questions: {
    route: {
      type: 'choice',
      instructions: 'What is the next step?',
      criteria: { request_approval: 'Approval pending', investigate: 'Build broken' },
    },
    build_passed: { type: 'boolean', instructions: 'Did the build pass?' },
    readiness: {
      type: 'score',
      instructions: 'Is the release ready?',
      criteria: ['Approval pending', 'Approved'],
    },
  },
}

test('one native request handles several configurable questions without dataset or candidate dependencies', async (t) => {
  const h = await host(t)
  const backend = createModelDecisionJudge(h.ctx, h.config)
  const r = await backend.judge(input)
  assert.deepEqual(r.answers, { route: 'request_approval', build_passed: true, readiness: 0 })
  assert.equal(h.requests.length, 1)
  assert.equal(r.costCny, 0.000102)
  const receipt = JSON.parse(readFileSync(r.receiptPath, 'utf8'))
  assert.equal(receipt.operation, 'decide')
  assert.equal(receipt.costEvidence.attempts, 1)
  assert.ok(!('datasetPath' in backend.descriptor))
  assert.equal(backend.descriptor.execution, 'one_batch_no_parallelism_guarantee')
  const next = await backend.judge({
    state: ['unrelated input'],
    questions: {
      suitable: { type: 'boolean', instructions: 'Does it satisfy the supplied condition?' },
    },
  })
  assert.deepEqual(next.answers, { suitable: true })
  assert.equal(h.requests.length, 2)
})

test('malformed model output and missing usage retain receipts without retries or fake decisions', async (t) => {
  for (const options of [
    { raw: 'not-json' },
    { raw: '{"bad":"invented"}' },
    { missingUsage: true },
  ]) {
    const h = await host(t, options)
    const r = await createModelDecisionJudge(h.ctx, h.config).judge(input)
    assert.ok(r.error)
    assert.equal(h.requests.length, 1)
    assert.equal(r.costCny, options.missingUsage ? null : 0.000102)
    assert.ok(r.receiptPath)
    assert.deepEqual(r.answers, {})
  }
})

test('bad questions and pre-cancellation never create a model request', async (t) => {
  const h = await host(t)
  const backend = createModelDecisionJudge(h.ctx, h.config)
  await assert.rejects(backend.judge({ state: 'x', questions: {} }), {
    code: 'DUO_DECISION_INPUT_INVALID',
  })
  const abort = new AbortController()
  abort.abort()
  const r = await backend.judge({ ...input, signal: abort.signal })
  assert.equal(r.costCny, 0)
  assert.equal(r.error.code, 'ABORTED')
  assert.equal(h.requests.length, 0)
})

test('public model composition makes one request through the decision tool and persists its complete cost', async (t) => {
  const h = await host(t)
  h.fibers.push(await h.ctx.plugin(SqliteJournal, { root: join(h.root, 'journal') }))
  h.fibers.push(await h.ctx.plugin(ReservedBudget))
  h.fibers.push(
    await h.ctx.plugin(ModelDecisions, {
      model: h.config,
      authorization: {
        id: 'scripted',
        currency: 'CNY',
        maxCostCny: 0.1,
        maxCalls: 1,
        paid: true,
        network: false,
      },
    }),
  )
  h.fibers.push(await h.ctx.plugin(DecisionTools))
  const r = await h.ctx.tools.execute({
    name: 'dualloop_decide',
    arguments: { requestId: 'batch-1', ...input },
    callId: 'caller',
    signal: new AbortController().signal,
  })
  assert.equal(r.isError, false, JSON.stringify(r))
  assert.equal(r.value.status, 'completed')
  assert.equal(r.value.answers.route.value, 'request_approval')
  assert.equal(h.requests.length, 1)
  assert.equal(h.ctx.duoDecisions.describe().budget.costCny, 0.000102)
  assert.equal(h.ctx.get('duoController'), undefined)
})
