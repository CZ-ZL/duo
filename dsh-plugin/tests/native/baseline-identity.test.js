import test from 'node:test'
import assert from 'node:assert/strict'
import { setup, FixtureGenerator, FixtureExecutor, FixtureEvaluators } from './test-fixtures.js'
import { buildReport } from '../../native/observer.js'
import { evidenceOutcome } from '../../native/evidence-strategy.js'

const free = { currency: 'CNY', costCny: 0 }
const cny = ({ reservationUsd, ...descriptor }) => ({
  ...descriptor,
  currency: 'CNY',
  reservationCny: 0,
})
class Generator extends FixtureGenerator {
  describe() {
    return cny(super.describe())
  }
  async propose(args) {
    const { candidates } = await super.propose(args)
    return { candidates, ...free }
  }
}
class Executor extends FixtureExecutor {
  describe() {
    return cny(super.describe())
  }
  async execute(args) {
    const { artifact } = await super.execute(args)
    return { artifact, ...free }
  }
}
class Evaluator extends FixtureEvaluators {
  describe() {
    return super.describe().map(cny)
  }
  async evaluate(args) {
    const { costUsd, ...result } = await super.evaluate(args)
    return { ...result, ...free }
  }
}
const budget = {
  currency: 'CNY',
  maxCostCny: 0,
  maxSessions: 30,
  maxFastEvals: 15,
  maxSlowEvals: 15,
  maxWallTimeMs: 60000,
}
async function run(t, id, options = {}, evaluators = Evaluator) {
  const { ctx } = await setup(
    t,
    { generations: 0, quotas: { exploit: 1, explore: 0, innovate: 0 }, budget, ...options },
    { generator: Generator, executor: Executor, evaluators },
  )
  // Exercise the public Target snapshot boundary without changing content or policy.
  const snapshot = ctx.duoTarget.snapshot.bind(ctx.duoTarget)
  ctx.duoTarget.snapshot = (path) => ({ ...snapshot(path), id })
  const plan = ctx.duoController.plan()
  const result = await ctx.duoController.run({ planDigest: plan.planDigest })
  const report = buildReport(ctx.duoController.status(plan.runId))
  return { ctx, plan, result, report }
}

for (const id of ['baseline', 'original']) {
  test(`unchanged ${id} is measured once at final without candidate statistics`, async (t) => {
    const { result, report } = await run(t, id)
    assert.equal(result.status, 'completed')
    assert.equal(result.conclusion, 'retain_baseline')
    assert.deepEqual(
      result.final.map((r) => r.candidateId),
      [id],
    )
    assert.equal(result.selectedOverlay, null)
    assert.equal(result.budget.operations, 6)
    assert.equal(result.budget.costCny, 0)
    assert.equal(report.health.slowEvaluatedCandidates, 0)
  })
}

test('a generated candidate is independently compared with the custom baseline identity', async (t) => {
  const { result, report } = await run(t, 'original', { generations: 1 })
  assert.equal(result.status, 'completed')
  assert.equal(result.championId, 'dl-0001')
  assert.equal(result.conclusion, 'recommend_candidate')
  assert.deepEqual(
    result.final.map((r) => r.candidateId),
    ['original', 'dl-0001'],
  )
  assert.equal(result.independentFinal.comparison.verdicts['dl-0001'], 'better')
  assert.equal(report.health.slowEvaluatedCandidates, 1)
  assert.equal(report.health.slowAcceptedCandidates, 1)
})

test('a tied candidate retains the custom baseline with one final measurement', async (t) => {
  class Tie extends Evaluator {
    async evaluate(args) {
      const result = await super.evaluate(args)
      result.metrics.quality = 0
      return result
    }
  }
  const { result, report } = await run(t, 'original', { generations: 1 }, Tie)
  assert.equal(result.status, 'completed')
  assert.equal(result.championId, 'original')
  assert.equal(result.conclusion, 'retain_baseline')
  assert.deepEqual(
    result.final.map((r) => r.candidateId),
    ['original'],
  )
  assert.equal(report.health.slowEvaluatedCandidates, 0)
  assert.equal(
    report.candidates.find((c) => c.id === 'dl-0001').final.state,
    'NOT_SELECTED_FOR_FINAL',
  )
})

test('evaluate-only final measures a custom baseline once with no search', async (t) => {
  const { result } = await run(t, 'original', {
    operation: 'evaluate',
    quotas: { exploit: 0, explore: 0, innovate: 0 },
  })
  assert.equal(result.status, 'completed')
  assert.equal(result.generationsRun, 0)
  assert.deepEqual(
    result.final.map((r) => r.candidateId),
    ['original'],
  )
  assert.equal(result.budget.operations, 6)
})

test('a custom baseline with no final receipt is not reported as deselected', async (t) => {
  const { ctx, plan } = await run(t, 'original')
  const status = ctx.duoController.status(plan.runId)
  status.result = { status: 'failed', final: [], championId: null }
  status.events = status.events.filter((e) => e.kind !== 'final')
  const baseline = buildReport(status).candidates.find((c) => c.id === 'original')
  assert.equal(baseline.final.state, 'NOT_EVALUATED')
})

test('additional baseline evidence does not claim candidate dual-loop validation', () => {
  const strategy = {
    optimization_mode: 'dual_loop',
    slow_mode: 'expanded_evidence',
    additional_options: [{ available: true, tier: 'slow', addedCoverage: ['boundary'] }],
    limitations: [],
    evidence_gaps: [],
    downgrade: null,
  }
  const events = [
    { kind: 'plan', plan: { baseline: { id: 'original' } } },
    {
      kind: 'evidence_acquired',
      receipt: {
        candidateId: 'original',
        tier: 'slow',
        status: 'OBSERVED',
        coverage: ['boundary'],
      },
    },
  ]
  assert.equal(evidenceOutcome(strategy, events).dual_loop_validation, 'NOT_OBSERVED')
  events.push({ ...events[1], receipt: { ...events[1].receipt, candidateId: 'dl-0001' } })
  assert.equal(
    evidenceOutcome(strategy, events).dual_loop_validation,
    'ADDITIONAL_CANDIDATE_EVIDENCE_ACQUIRED',
  )
})
