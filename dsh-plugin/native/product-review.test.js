import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { setup, FixtureGenerator, FixtureExecutor, FixtureEvaluators } from './test-fixtures.js'
import { TopKGate } from './policies.js'
const budget = {
  currency: 'CNY',
  maxCostCny: 0,
  maxSessions: 100,
  maxFastEvals: 20,
  maxSlowEvals: 20,
  maxWallTimeMs: 60000,
}
const free = { currency: 'CNY', costCny: 0 }
function cny(d) {
  const { reservationUsd, ...r } = d
  return { ...r, currency: 'CNY', reservationCny: 0 }
}
class Generator extends FixtureGenerator {
  describe() {
    return cny(super.describe())
  }
  async propose(a) {
    const r = await super.propose(a)
    for (const c of r.candidates) c.delta.persona += '\n' + c.id
    return { candidates: r.candidates, ...free }
  }
}
class Executor extends FixtureExecutor {
  describe() {
    return cny(super.describe())
  }
  async execute(a) {
    const r = await super.execute(a)
    return { artifact: r.artifact, ...free }
  }
}
class Evaluator extends FixtureEvaluators {
  describe() {
    return super.describe().map((d) => ({
      ...cny(d),
      evidenceSource: {
        measurement: 'Local review probe',
        targetKinds: ['dsh-persona'],
        family: 'assertions',
        coverage: d.tier === 'fast' ? ['core'] : ['core', 'boundary-a', 'boundary-b'],
        dataScope: { id: d.tier, purpose: d.tier === 'final' ? 'final' : 'search' },
        independentOfSearch: false,
        deterministic: true,
        realTools: false,
        requiresModel: false,
        sideEffects: 'none',
        ...(d.tier === 'slow'
          ? {
              increment: {
                relativeTo: { id: 'fixture-fast', version: '1', dataId: 'fast' },
                kind: 'expanded_evidence',
                reason: 'Additional boundary cases',
              },
            }
          : {}),
      },
    }))
  }
  async evaluate({ candidate, tier }) {
    return {
      candidateId: candidate.id,
      evaluatorId: 'fixture-' + tier,
      version: '1',
      dataId: tier,
      tier,
      ok: true,
      metrics: {
        quality: candidate.id === 'baseline' ? 0.2 : candidate.id === 'dl-0001' ? 0.95 : 0.8,
        safe: true,
        sample_size: 2,
      },
      evidenceCoverage: tier === 'fast' ? ['core'] : ['core', 'boundary-a', 'boundary-b'],
      ...free,
    }
  }
}
const options = {
  preset: 'optimize-dual',
  final: null,
  budget,
  generations: 1,
  quotas: { exploit: 2, explore: 0, innovate: 0 },
  topK: 2,
}
test('complete runner-up remains selectable when highest-scoring evidence is incomplete', async (t) => {
  class Partial extends Evaluator {
    async evaluate(a) {
      const r = await super.evaluate(a)
      if (a.tier === 'slow' && a.candidate.id === 'dl-0001')
        r.evidenceCoverage = ['core', 'boundary-a']
      return r
    }
  }
  const { ctx } = await setup(t, options, {
    generator: Generator,
    executor: Executor,
    evaluators: Partial,
  })
  const p = ctx.duoController.plan(),
    r = await ctx.duoController.run({ planDigest: p.planDigest })
  const d = r.decision_basis.filter((x) => x.request === null)

  assert.equal(r.status, 'completed')
  assert.equal(r.championId, 'dl-0002')
  assert.ok(
    d.some(
      (x) =>
        x.candidateId === 'dl-0002' &&
        x.action === 'promote' &&
        x.basis.observed.at(-1).verdict === 'better' &&
        x.basis.observed.at(-1).coverageConfirmed === true,
    ),
  )
})
test('multiple policy-eligible candidates produce one rank-selected champion and consistent Journal', async (t) => {
  class AllAdmissible extends TopKGate {
    decide(q) {
      const d = super.decide(q)
      return !q.next ? { ...d, action: 'promote', reason: 'ACCEPT_ADMISSIBLE_CANDIDATE' } : d
    }
  }
  class ReversedScore extends Evaluator {
    async evaluate(a) {
      const r = await super.evaluate(a)
      if (a.candidate.id !== 'baseline')
        r.metrics.quality = a.candidate.id === 'dl-0001' ? 0.7 : 0.9
      return r
    }
  }
  const { ctx, fibers } = await setup(t, options, {
    generator: Generator,
    executor: Executor,
    evaluators: ReversedScore,
  })
  await fibers[3].dispose()
  const f = await ctx.plugin(AllAdmissible)
  t.after(() => f.dispose())
  const p = ctx.duoController.plan(),
    r = await ctx.duoController.run({ planDigest: p.planDigest })
  const rows = [
    ...new Map(
      ctx.duoController
        .status(p.runId)
        .events.filter((e) => e.kind === 'candidate')
        .map((e) => [e.candidateId, e]),
    ).values(),
  ].map((e) => ({
    id: e.candidateId,
    status: e.status,
    decision: e.slowDecision,
    score: e.slowScore,
  }))

  assert.equal(r.status, 'completed')
  assert.equal(r.championId, 'dl-0002')
  assert.equal(rows.filter((x) => x.decision === 'accepted').length, 1)
  const { buildReport } = await import('./observer.js')
  const report = buildReport(ctx.duoController.status(p.runId))
  assert.equal(report.candidates.find((c) => c.selected).id, 'dl-0002')
  assert.equal(report.health.slowAcceptedCandidates, 1)
  const held = r.decision_basis.find(
    (d) => d.candidateId === 'dl-0001' && d.reason === 'ANOTHER_CANDIDATE_SELECTED',
  )
  assert.equal(held.policyProposal.action, 'promote')
  assert.equal(held.selectedCandidateId, 'dl-0002')
  const { strategyFeedback } = await import('./evidence-strategy.js')
  const feedback = strategyFeedback(ctx.duoController.status(p.runId).events)
  assert.equal(feedback.filter((d) => d.action === 'promote').length, 1)
})
test('cumulative admission reserves paused run allowance until its original checkpoint completes', async (t) => {
  class FakeCost extends Executor {
    describe() {
      return {
        ...super.describe(),
        reservationCny: 0.3,
        permissions: { paid: true, network: false, externalSideEffects: false },
      }
    }
    async execute(a) {
      const r = await super.execute(a)
      return { ...r, costCny: 0.3, costEvidence: { kind: 'LOCAL_SIMULATED_RECEIPT_NO_API' } }
    }
  }
  const { ctx, experiment, contract } = await setup(
    t,
    {
      ...options,
      preset: 'optimize-basic',
      slow: null,
      quotas: { exploit: 1, explore: 0, innovate: 0 },
      permissions: { paid: true, network: false, externalSideEffects: false },
      budget: { ...budget, maxCostCny: 0.7, maxCumulativeCostCny: 1 },
    },
    { generator: Generator, executor: FakeCost, evaluators: Evaluator },
  )
  const p1 = ctx.duoController.plan(),
    paused = await ctx.duoController.run({ planDigest: p1.planDigest, pauseAfter: 'baseline' })
  assert.equal(paused.status, 'paused')
  writeFileSync(experiment, JSON.stringify({ ...contract, id: 'second-run' }))
  assert.throws(() => ctx.duoController.plan(), { code: 'DUO_CUMULATIVE_BUDGET_EXCEEDED' })
  // A smaller, evaluate-only run fits alongside the paused run's full allowance.
  writeFileSync(
    experiment,
    JSON.stringify({
      ...contract,
      id: 'bounded-second-run',
      operation: 'evaluate',
      preset: 'evaluate',
      generations: 0,
      quotas: { exploit: 0, explore: 0, innovate: 0 },
      budget: { ...contract.budget, maxCostCny: 0.3 },
    }),
  )
  const p2 = ctx.duoController.plan(),
    r2 = await ctx.duoController.run({ planDigest: p2.planDigest })
  assert.equal(r2.status, 'completed')
  writeFileSync(experiment, JSON.stringify(contract))
  const r1 = await ctx.duoController.run({
    planDigest: p1.planDigest,
    resumeFrom: paused.checkpointDigest,
  })
  const cumulative = ctx.duoBudget.inspect(p1.runId).cumulative
  assert.equal(r1.status, 'completed')
  assert.equal(cumulative.knownCostCny, 0.9)
  assert.equal(cumulative.maxCumulativeCostCny, 1)
  assert.equal((await ctx.duoController.run({ planDigest: p1.planDigest })).reusedArtifacts, true)
})
