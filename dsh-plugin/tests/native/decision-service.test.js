import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SqliteJournal, ReservedBudget } from '../../native/store.js'
import FunctionDecisions from '../../native/decisions.js'
import Tools from '@deepseek-ai/dsh-tools'
import Agents from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as DecisionTools from '../../native/decision-tools.js'

const input = {
  requestId: 'ticket-001',
  state: { ticket: 'Duplicate charge; connect me to a person' },
  questions: {
    route: {
      type: 'choice',
      instructions: 'Which queue owns this?',
      criteria: { billing: 'Charges', access: 'Sign in' },
    },
    urgency: {
      type: 'score',
      instructions: 'How urgent?',
      criteria: ['Routine', 'Today', 'Immediate'],
    },
    human: { type: 'boolean', instructions: 'Did the user ask for a person?' },
  },
}
async function host(t, { paid = true, maxCostCny = 0.1, maxCalls = 3, output, delay = 0 } = {}) {
  const ctx = new Context(),
    root = mkdtempSync(join(tmpdir(), 'duo-decisions-')),
    fibers = [],
    calls = []
  const config = {
    descriptor: {
      id: 'scripted-decisions',
      version: '1',
      configDigest: 'scripted-v1',
      currency: 'CNY',
      reservationCny: 0.02,
      permissions: { paid: true, network: false, externalSideEffects: false },
      evidenceKind: 'fixture',
      maxRequests: 1,
    },
    authorization: {
      id: 'unit-allowance',
      currency: 'CNY',
      maxCostCny,
      maxCalls,
      paid,
      network: false,
    },
    judge: async (args) => {
      calls.push(args)
      if (delay) await new Promise((r) => setTimeout(r, delay))
      return (
        output ?? {
          answers: { route: 'billing', urgency: 1, human: true },
          currency: 'CNY',
          costCny: 0.001,
          costEvidence: { kind: 'fixture', attempts: 1 },
        }
      )
    },
  }
  fibers.push(
    await ctx.plugin(SqliteJournal, { root }),
    await ctx.plugin(ReservedBudget),
    await ctx.plugin(FunctionDecisions, config),
  )
  t.after(async () => {
    for (const f of fibers.reverse()) await f.dispose()
  })
  return { ctx, root, calls, config, fibers }
}

test('standalone multi-question decision returns actionable values with one call and no optimization services', async (t) => {
  const h = await host(t)
  assert.equal(h.ctx.get('duoController'), undefined)
  assert.equal(h.ctx.get('duoTarget'), undefined)
  const r = await h.ctx.duoDecisions.decide(input)
  assert.equal(r.status, 'completed')
  assert.equal(r.answers.route.value, 'billing')
  assert.equal(r.answers.human.value, true)
  assert.equal(r.allAnswered, true)
  assert.equal(h.calls.length, 1)
  assert.equal(Object.keys(h.calls[0].questions).length, 3)
  assert.equal(r.costCny, 0.001)
  assert.equal(h.ctx.duoDecisions.describe().budget.costCny, 0.001)
  assert.equal(r.qualification, 'NOT_CALIBRATED')
})

test('same completed request reads retained evidence after reload, changed input or config cannot reset allowance', async (t) => {
  const h = await host(t)
  const original = await h.ctx.duoDecisions.decide(input)
  await h.fibers.pop().dispose()
  h.fibers.push(await h.ctx.plugin(FunctionDecisions, h.config))
  const replay = await h.ctx.duoDecisions.decide(input)
  assert.equal(replay.reused, true)
  assert.deepEqual(replay.answers, original.answers)
  assert.equal(h.calls.length, 1)
  assert.deepEqual(h.ctx.duoDecisions.status(input.requestId).result.answers, original.answers)
  await assert.rejects(h.ctx.duoDecisions.decide({ ...input, state: 'different' }), {
    code: 'DUO_DECISION_REQUEST_CHANGED',
  })
  await h.fibers.pop().dispose()
  h.fibers.push(
    await h.ctx.plugin(FunctionDecisions, {
      ...h.config,
      authorization: { ...h.config.authorization, maxCostCny: 1 },
    }),
  )
  await assert.rejects(h.ctx.duoDecisions.decide({ ...input, requestId: 'new' }), {
    code: 'DUO_DECISION_CONFIG_CHANGED',
  })
  assert.equal(h.calls.length, 1)
})

test('missing permission, exhausted allowance and pre-cancellation never dispatch', async (t) => {
  for (const options of [{ paid: false }, { maxCostCny: 0 }, { maxCalls: 0 }]) {
    const h = await host(t, options)
    await assert.rejects(h.ctx.duoDecisions.decide(input), (e) =>
      ['DUO_DECISION_AUTHORIZATION_REQUIRED', 'DUO_BUDGET_EXHAUSTED'].includes(e.code),
    )
    assert.equal(h.calls.length, 0)
  }
  const h = await host(t)
  const abort = new AbortController()
  abort.abort()
  await assert.rejects(h.ctx.duoDecisions.decide({ ...input, signal: abort.signal }), {
    code: 'ABORTED',
  })
  assert.equal(h.calls.length, 0)
})

test('invalid answers retain raw output and known cost; unknown usage blocks new calls instead of retrying', async (t) => {
  const invalid = await host(t, {
    output: { answers: { route: 'invented' }, currency: 'CNY', costCny: 0.001 },
  })
  const bad = await invalid.ctx.duoDecisions.decide(input)
  assert.equal(bad.status, 'invalid_output')
  assert.deepEqual(bad.answers, {})
  assert.equal(bad.costCny, 0.001)
  assert.equal(
    invalid.ctx.duoDecisions.status(input.requestId).result.rawOutput.answers.route,
    'invented',
  )
  const unknown = await host(t, { output: { answers: {}, currency: 'CNY', costCny: null } })
  const result = await unknown.ctx.duoDecisions.decide(input)
  assert.equal(result.status, 'failed')
  assert.equal(result.costCny, null)
  assert.equal(unknown.ctx.duoDecisions.describe().budget.blockedReason, 'DUO_COST_UNKNOWN')
  await assert.rejects(unknown.ctx.duoDecisions.decide({ ...input, requestId: 'new' }), {
    code: 'DUO_COST_UNKNOWN',
  })
  assert.equal(unknown.calls.length, 1)
})

test('concurrent duplicate request IDs do not dispatch twice', async (t) => {
  const h = await host(t, { delay: 15 })
  const first = h.ctx.duoDecisions.decide(input)
  await assert.rejects(h.ctx.duoDecisions.decide(input), { code: 'DUO_OPERATION_EXISTS' })
  await first
  assert.equal(h.calls.length, 1)
})

test('actual public tools discover, decide and read results without loading an optimization controller', async (t) => {
  const h = await host(t)
  for (const p of [Agents, SystemPrompt, Tools, DecisionTools]) h.fibers.push(await h.ctx.plugin(p))
  const call = (name, args = {}) =>
    h.ctx.tools.execute({
      name,
      arguments: args,
      callId: 'caller',
      signal: new AbortController().signal,
    })
  assert.deepEqual((await call('dualloop_decision_describe')).value.questionTypes, [
    'choice',
    'score',
    'boolean',
  ])
  const result = await call('dualloop_decide', input)
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.equal(result.value.answers.route.value, 'billing')
  assert.ok(!result.content[0].text.includes('rawOutput'))
  assert.equal(
    (await call('dualloop_decision_status', { requestId: input.requestId })).value.result.status,
    'completed',
  )
  assert.equal(h.calls.length, 1)
  const invalid = await call('dualloop_decide', { ...input, requestId: 'bad', questions: {} })
  assert.equal(invalid.isError, true)
  const diagnostic = JSON.parse(invalid.content[0].text).error
  assert.equal(diagnostic.component, 'duoDecisions')
  assert.match(diagnostic.nextAction, /dualloop_decision_describe/)
  assert.equal(diagnostic.costState, 'NO_WORK_DISPATCHED_BY_THIS_CALL')
  assert.equal(h.calls.length, 1)
  await h.fibers.pop().dispose()
  assert.ok(!h.ctx.tools.schemas().some((s) => s.name === 'dualloop_decide'))
})

test('request cap and known reservation overrun remain blocked after a settled call', async (t) => {
  const limited = await host(t, { maxCalls: 1 })
  await limited.ctx.duoDecisions.decide(input)
  await assert.rejects(limited.ctx.duoDecisions.decide({ ...input, requestId: 'second' }), {
    code: 'DUO_BUDGET_EXHAUSTED',
  })
  assert.equal(limited.calls.length, 1)
  const over = await host(t, {
    output: {
      answers: { route: 'billing', urgency: 1, human: true },
      currency: 'CNY',
      costCny: 0.03,
    },
  })
  const result = await over.ctx.duoDecisions.decide(input)
  assert.equal(result.status, 'failed')
  assert.equal(result.costCny, 0.03)
  assert.deepEqual(result.answers, {})
  await assert.rejects(over.ctx.duoDecisions.decide({ ...input, requestId: 'second' }), {
    code: 'DUO_RESERVATION_OVERRUN',
  })
  assert.equal(over.calls.length, 1)
})

test('cancellation during work preserves the known late fee and does not expose actionable answers', async (t) => {
  const h = await host(t, { delay: 15 })
  const abort = new AbortController()
  const work = h.ctx.duoDecisions.decide({ ...input, signal: abort.signal })
  abort.abort()
  const result = await work
  assert.equal(result.status, 'cancelled')
  assert.equal(result.costCny, 0.001)
  assert.deepEqual(result.answers, {})
  assert.equal(h.calls.length, 1)
})
