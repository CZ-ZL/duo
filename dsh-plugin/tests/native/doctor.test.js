import test from 'node:test'
import assert from 'node:assert/strict'
import { setup, descriptor } from './test-fixtures.js'
import { EvaluatorsService } from '../../native/definitions.js'
import RunDoctor from '../../native/doctor.js'

// Every measurement is shape-drifted except the baseline's when baselineClean.
class DriftEvaluators extends EvaluatorsService {
  constructor(ctx, config) {
    super(ctx)
    this.baselineClean = config?.baselineClean ?? false
  }
  describe() {
    return ['fast', 'slow', 'final'].map((tier) =>
      descriptor('fixture-' + tier, {
        tier,
        dataId: tier,
        metrics: ['quality', 'safe', 'sample_size'],
      }),
    )
  }
  async evaluate({ candidate, tier }) {
    const clean = this.baselineClean && candidate.id === 'baseline'
    const rows = clean
      ? [
          { id: 't1', reason: 'EXACT' },
          { id: 't2', reason: 'WRONG_LETTER' },
        ]
      : [
          { id: 't1', reason: 'ROW_NOT_OBJECT' },
          { id: 't2', reason: 'ROW_NOT_OBJECT' },
        ]
    return {
      candidateId: candidate.id,
      evaluatorId: 'fixture-' + tier,
      version: '1',
      dataId: tier,
      tier,
      ok: true,
      metrics: { quality: clean ? 0.5 : 0, safe: true, sample_size: 2 },
      costUsd: 0,
      evidence: [{ status: 'SCORED', passed: clean ? 1 : 0, total: 2, rows }],
    }
  }
}

const doctorEvents = (ctx, runId) =>
  ctx.duoJournal
    .open(runId, { create: true })
    .events()
    .filter((e) => e.kind === 'doctor')

test('doctor halts the run at the baseline when the instrument is lying', async (t) => {
  const { ctx } = await setup(t, {}, { evaluators: DriftEvaluators })
  await ctx.plugin(RunDoctor, {})
  const p = ctx.duoController.plan()
  const result = await ctx.duoController.run({ planDigest: p.planDigest })
  assert.equal(result.stopReason, 'DUO_DOCTOR_STOP')
  assert.equal(result.doctor?.severity, 'stop', 'failed result must carry the doctor verdict')
  const events = doctorEvents(ctx, p.runId)
  assert.ok(events.length >= 1, 'a doctor event must be journaled')
  const ids = events.flatMap((e) => e.checks.map((c) => c.id))
  assert.ok(
    ids.includes('J1_INSTRUMENT_SUSPECT'),
    'baseline zeroed by format failures must be named',
  )
})

test('doctor stops search once drift dominates measured candidates', async (t) => {
  const { ctx } = await setup(t, {}, { evaluators: class extends DriftEvaluators {} })
  // baseline clean, candidates drifted: reconfigure after construction, and
  // lower the stop threshold so a partially-measured generation already trips.
  const evaluators = ctx.duoEvaluators
  evaluators.baselineClean = true
  let finalCalls = 0
  const evaluate = evaluators.evaluate.bind(evaluators)
  evaluators.evaluate = async (args) => {
    if (args.tier === 'final') finalCalls++
    return evaluate(args)
  }
  await ctx.plugin(RunDoctor, { driftStop: 0.25 })
  const p = ctx.duoController.plan()
  const result = await ctx.duoController.run({ planDigest: p.planDigest })
  assert.ok(
    ['doctor_stop', 'DUO_DOCTOR_STOP'].includes(result.stopReason),
    'search must end by doctor verdict, got ' + result.stopReason,
  )
  assert.equal(
    result.doctor?.severity,
    'stop',
    'completed-path result must surface the doctor verdict',
  )
  const ids = doctorEvents(ctx, p.runId).flatMap((e) => e.checks.map((c) => c.id))
  assert.ok(ids.includes('J2_FORMAT_DRIFT'))
  assert.equal(finalCalls, 0, 'doctor stop must prevent further provider calls')
  assert.equal(result.conclusion, 'insufficient_evidence')
  assert.deepEqual(result.final, [])
})

test('a disabled doctor never interferes', async (t) => {
  const { ctx } = await setup(t, {}, { evaluators: DriftEvaluators })
  await ctx.plugin(RunDoctor, { enabled: false })
  const p = ctx.duoController.plan()
  const result = await ctx.duoController.run({ planDigest: p.planDigest })
  assert.notEqual(result.stopReason, 'doctor_stop')
  assert.equal(doctorEvents(ctx, p.runId).length, 0)
})

test('runs without a doctor service are unchanged', async (t) => {
  const { ctx } = await setup(t, {}, { evaluators: DriftEvaluators })
  const p = ctx.duoController.plan()
  const result = await ctx.duoController.run({ planDigest: p.planDigest })
  assert.notEqual(result.stopReason, 'doctor_stop')
  assert.equal(doctorEvents(ctx, p.runId).length, 0)
})
