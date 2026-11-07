import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SqliteJournal, ReservedBudget, owner } from '../../native/store.js'
import Tools from '@deepseek-ai/dsh-tools'
import Agents from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ControllerService } from '../../native/definitions.js'
import * as DuoTools from '../../native/tools.js'
import { buildReport } from '../../native/observer.js'

const limits = {
  currency: 'CNY',
  maxCostCny: 0.8,
  maxCumulativeCostCny: 1,
  maxSessions: 10,
  maxFastEvals: 10,
  maxSlowEvals: 10,
}
async function setup(t) {
  const ctx = new Context()
  const journal = await ctx.plugin(SqliteJournal, {
    root: mkdtempSync(join(tmpdir(), 'duo-abandon-')),
  })
  const budget = await ctx.plugin(ReservedBudget)
  t.after(async () => {
    await budget.dispose()
    await journal.dispose()
  })
  const b = ctx.duoBudget.open('old', limits),
    j = ctx.duoJournal.open('old', { create: true })
  j.claim('old-plan')
  b.reserve('known', { phase: 'generation', currency: 'CNY', maxCostCny: 0.01 })
  b.settle('known', 0.0041, 'known-receipt', { currency: 'CNY' })
  b.reserve('missing', { phase: 'generation', currency: 'CNY', maxCostCny: 0.64 })
  b.settle('missing', null, 'lost-response', { currency: 'CNY' })
  return { ctx, b, j }
}

test('explicit abandonment preserves unknown costs and admits only affordable fresh work', async (t) => {
  const { ctx, b, j } = await setup(t)
  j.complete({ status: 'failed', stopReason: 'DUO_COST_UNKNOWN' })
  const operations = b.operations(),
    receipts = b.receipts()
  assert.throws(() => ctx.duoBudget.checkAdmission('new', { ...limits, maxCostCny: 0.3 }), {
    code: 'DUO_COST_UNKNOWN',
  })
  assert.equal(typeof ctx.duoBudget.abandon, 'function')
  const result = ctx.duoBudget.abandon('old', 'old-plan')
  assert.equal(result.result.status, 'ABORTED_UNKNOWN_PROVIDER_OPERATION')
  assert.equal(result.budget.costCny, null)
  assert.equal(result.budget.unknownExposureCny, 0.64)
  assert.deepEqual(b.operations(), operations)
  assert.deepEqual(b.receipts(), receipts)
  assert.deepEqual(j.get('result-before-abandon'), {
    status: 'failed',
    stopReason: 'DUO_COST_UNKNOWN',
  })
  assert.doesNotThrow(() => ctx.duoBudget.checkAdmission('new', { ...limits, maxCostCny: 0.3 }))
  assert.throws(() => ctx.duoBudget.checkAdmission('large', { ...limits, maxCostCny: 0.65 }), {
    code: 'DUO_CUMULATIVE_BUDGET_EXCEEDED',
  })
  assert.throws(
    () =>
      ctx.duoBudget.checkAdmission('raised', {
        ...limits,
        maxCostCny: 0.65,
        maxCumulativeCostCny: 5,
      }),
    { code: 'DUO_CUMULATIVE_BUDGET_EXCEEDED' },
  )
  assert.deepEqual(ctx.duoBudget.abandon('old', 'old-plan'), result)
  const report = buildReport({
    runId: 'old',
    result: result.result,
    budget: result.budget,
    events: j.events(),
  })
  assert.equal(
    report.diagnostics.recovery.nextAction,
    'inspect_new_plan_with_retained_unknown_exposure',
  )
  let admitted = false
  ctx.duoBudget.admitRun('new', { ...limits, maxCostCny: 0.3 }, () => {
    admitted = true
    const next = ctx.duoBudget.open('new', { ...limits, maxCostCny: 0.3 })
    const journal = ctx.duoJournal.open('new', { create: true })
    journal.claim('new-plan')
    next.reserve('one', { phase: 'generation', currency: 'CNY', maxCostCny: 0.3 })
    next.settle('one', 0.01, 'new-receipt', { currency: 'CNY' })
    journal.complete({ status: 'completed' })
  })
  assert.equal(admitted, true)
  assert.equal(ctx.duoBudget.inspect('new').cumulative.unknownExposureCny, 0.64)
  assert.deepEqual(b.operations(), operations)
  assert.throws(() => j.resume('old-plan', 'anything'), { code: 'DUO_CHECKPOINT_CHANGED' })
})

test('abandonment refuses live work, pending calls and mismatched identities without mutation', async (t) => {
  const { ctx, b, j } = await setup(t),
    before = b.operations()
  assert.equal(typeof ctx.duoBudget.abandon, 'function')
  assert.throws(() => ctx.duoBudget.abandon('old', 'wrong-plan'), { code: 'DUO_PLAN_CHANGED' })
  assert.throws(() => ctx.duoBudget.abandon('old', 'old-plan'), { code: 'DUO_OWNER_ACTIVE' })
  j.complete({ status: 'failed' })
  const release = j.lease()
  assert.throws(() => ctx.duoBudget.abandon('old', 'old-plan'), { code: 'DUO_OWNER_ACTIVE' })
  release()
  const other = owner(process.ppid)
  if (other) {
    j.set('run', { ...j.get('run'), owner: other })
    assert.throws(() => ctx.duoBudget.abandon('old', 'old-plan'), { code: 'DUO_OWNER_ACTIVE' })
  }
  assert.deepEqual(b.operations(), before)
  assert.deepEqual(j.result(), { status: 'failed' })
})

test('dead owner can be terminalized after its original deadline without repeating work', async (t) => {
  const { ctx, b, j } = await setup(t)
  j.set('run', { ...j.get('run'), owner: { pid: 2147483647, start: 'missing' }, started: 1 })
  assert.equal(typeof ctx.duoBudget.abandon, 'function')
  const result = ctx.duoBudget.abandon('old', 'old-plan')
  assert.equal(result.result.championId, null)
  assert.equal(result.result.improvementProven, false)
  assert.equal(result.result.resumeAllowed, false)
  assert.equal(b.operations().length, 2)
  assert.equal(j.get('run').status, 'ABORTED_UNKNOWN_PROVIDER_OPERATION')
  assert.equal(result.budget.cumulative.unknownExposureCny, 0.64)
})

test('an overrun cannot be disguised as an abandoned unknown operation', async (t) => {
  const { ctx, b, j } = await setup(t)
  const op = b.operations().find((o) => o.id === 'known')
  b.save({ ...op, overrun: true })
  j.complete({ status: 'failed' })
  assert.equal(typeof ctx.duoBudget.abandon, 'function')
  assert.throws(() => ctx.duoBudget.abandon('old', 'old-plan'), { code: 'DUO_RESERVATION_OVERRUN' })
  assert.equal(j.result().status, 'failed')
})

test('dead reserved operations become unknown without losing reservation or receipts', async (t) => {
  const { ctx, b, j } = await setup(t)
  const missing = b.operations().find((op) => op.id === 'missing')
  b.save({ ...missing, status: 'reserved', owner: { pid: 2147483647, start: 'missing' } })
  j.set('run', { ...j.get('run'), owner: { pid: 2147483647, start: 'missing' } })
  const receipts = b.receipts()
  ctx.duoBudget.abandon('old', 'old-plan')
  const after = b.operations().find((op) => op.id === 'missing')
  assert.equal(after.status, 'unknown')
  assert.equal(after.reserved, missing.reserved)
  assert.equal(after.cost, null)
  assert.deepEqual(after.receipts, missing.receipts)
  assert.deepEqual(b.receipts(), receipts)
})

test('public abandonment tool preserves host denial and uses the exact old identity', async (t) => {
  const { ctx, j } = await setup(t)
  j.complete({ status: 'failed' })
  class Controller extends ControllerService {
    plan() {
      throw Error('MUST_NOT_REPLAN_OLD_RUN')
    }
  }
  const fibers = []
  for (const P of [Agents, SystemPrompt, Tools, Controller, DuoTools])
    fibers.push(await ctx.plugin(P))
  t.after(async () => {
    for (const f of fibers.reverse()) await f.dispose()
  })
  const call = (args) =>
    ctx.tools.execute({
      name: 'dualloop_budget_abandon',
      callId: 'abandon',
      arguments: args,
      signal: new AbortController().signal,
    })
  const deny = ctx.tools.guard(() => 'Not authorized')
  assert.equal((await call({ runId: 'old', planDigest: 'old-plan' })).isError, true)
  assert.equal(j.result().status, 'failed')
  deny()
  assert.equal((await call({ runId: 'old' })).isError, true)
  const good = await call({ runId: 'old', planDigest: 'old-plan' })
  assert.equal(good.isError, false)
  assert.equal(good.value.result.status, 'ABORTED_UNKNOWN_PROVIDER_OPERATION')
  assert.equal(good.value.budget.costCny, null)
})

test('legacy USD abandonment retains dollar exposure without importing yuan amounts', async (t) => {
  const { ctx } = await setup(t)
  const usd = {
    maxCostUsd: 0.8,
    maxCumulativeCostUsd: 1,
    maxSessions: 10,
    maxFastEvals: 10,
    maxSlowEvals: 10,
  }
  const b = ctx.duoBudget.open('usd', usd),
    j = ctx.duoJournal.open('usd', { create: true })
  j.claim('usd-plan')
  b.reserve('missing', { phase: 'generation', maxCostUsd: 0.64 })
  b.settle('missing', null, 'unknown-usd')
  j.complete({ status: 'failed' })
  const result = ctx.duoBudget.abandon('usd', 'usd-plan')
  assert.equal(result.budget.costUsd, null)
  assert.equal(result.budget.unknownExposureUsd, 0.64)
  assert.deepEqual(result.budget.cumulative.excludedCurrencies, ['CNY'])
  assert.doesNotThrow(() => ctx.duoBudget.checkAdmission('usd-new', { ...usd, maxCostUsd: 0.3 }))
})
