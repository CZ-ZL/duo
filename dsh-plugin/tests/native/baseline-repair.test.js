import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Tools from '@deepseek-ai/dsh-tools'
import Agents from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as PublicTools from '../../native/tools.js'
import Observer from '../../native/observer.js'
import * as ObserverTools from '../../native/observer-tools.js'
import { setup, FixtureEvaluators, FixtureGenerator } from './test-fixtures.js'

const constraint = { metric: 'critical_misses', op: '==', value: 0 }
const comparisonSpec = {
  weights: { quality: 1 },
  epsilon: 0.01,
  minSamples: 2,
  constraints: [constraint],
}
const evidence = (id, misses, quality = 1) => ({
  candidateId: id,
  evaluatorId: 'test',
  version: '1',
  dataId: 'dev',
  tier: 'fast',
  ok: true,
  metrics: { quality, critical_misses: misses, sample_size: 2 },
})
function evaluator({
  allFail = false,
  invalid,
  badTier,
  finalInvalid = false,
  finalFail = false,
} = {}) {
  return class extends FixtureEvaluators {
    describe() {
      return super.describe().map((d) => ({ ...d, metrics: [...d.metrics, 'critical_misses'] }))
    }
    async evaluate(args) {
      const r = await super.evaluate(args)
      r.metrics.critical_misses =
        allFail || (args.candidate.id === 'baseline' && (!badTier || badTier === args.tier)) ? 1 : 0
      if (args.candidate.id === 'baseline' && invalid) invalid(r)
      if (args.tier === 'final' && finalInvalid && args.candidate.id === 'baseline') r.ok = false
      if (args.tier === 'final' && finalFail) r.metrics.critical_misses = 1
      return r
    }
  }
}
const basic = {
  preset: 'optimize-basic',
  slow: null,
  final: null,
  generations: 1,
  quotas: { exploit: 1, explore: 0, innovate: 0 },
  constraints: [constraint],
}
async function publicHost(t, overrides = basic, options = {}) {
  const h = await setup(t, overrides, { evaluators: evaluator(options) })
  const fibers = []
  for (const P of [Agents, SystemPrompt, Tools, PublicTools, Observer, ObserverTools])
    fibers.push(await h.ctx.plugin(P))
  t.after(async () => {
    for (const f of fibers.reverse()) await f.dispose()
  })
  const call = async (name, args = {}) => {
    const r = await h.ctx.tools.execute({
      name,
      arguments: args,
      callId: 'repair',
      signal: new AbortController().signal,
    })
    assert.equal(r.isError, false, JSON.stringify(r.error))
    return r
  }
  return { ...h, call }
}

test('default comparison prefers a feasible repair even with a lower weighted score', async (t) => {
  const { ctx } = await setup(t)
  const r = ctx.duoComparator.compare(
    [evidence('baseline', 1, 10), evidence('fixed', 0, 1), evidence('bad', 2, 100)],
    comparisonSpec,
    'baseline',
  )
  assert.equal(r.verdicts.baseline, 'constraint_violation')
  assert.equal(r.verdicts.fixed, 'better')
  assert.equal(r.verdicts.bad, 'constraint_violation')
  assert.deepEqual(r.ranking, ['fixed'])
  assert.equal(r.decisionBasis.fixed, 'constraint_feasibility')
  assert.deepEqual(r.constraintViolations.baseline, [{ ...constraint, actual: 1 }])
})

test('missing or invalid constraint evidence cannot masquerade as a repairable violation', async (t) => {
  const { ctx } = await setup(t)
  for (const mutate of [
    (r) => {
      delete r.metrics.critical_misses
    },
    (r) => {
      r.metrics.critical_misses = '1'
    },
    (r) => {
      r.metrics.critical_misses = NaN
    },
    (r) => {
      r.metrics.quality = Infinity
    },
    (r) => {
      r.ok = false
    },
    (r) => {
      r.metrics.sample_size = 1
    },
  ]) {
    const base = evidence('baseline', 1)
    mutate(base)
    const r = ctx.duoComparator.compare([base, evidence('fixed', 0)], comparisonSpec, 'baseline')
    assert.equal(r.verdicts.baseline, 'incomparable')
    assert.equal(r.verdicts.fixed, 'incomparable')
  }
})

test('public basic repair starts from the original, resumes without recharge and explains selection', async (t) => {
  const { ctx, call, target } = await publicHost(t)
  const original = readFileSync(target),
    p = (await call('dualloop_plan', { view: 'summary' })).value
  const paused = (await call('dualloop_run', { planDigest: p.planDigest, pauseAfter: 'baseline' }))
    .value
  assert.equal(paused.status, 'paused')
  assert.equal(p.baselinePolicy.qualityConstraintViolation, 'continue_repair')
  assert.equal(paused.baselineAssessment.fast.verdict, 'constraint_violation')
  assert.equal(paused.baselineAssessment.fast.searchAllowed, true)
  const receipts = ctx.duoBudget.open(p.runId, p.spec.budget).receipts()
  const r = (
    await call('dualloop_run', { planDigest: p.planDigest, resumeFrom: paused.checkpointDigest })
  ).value
  assert.equal(r.status, 'completed')
  assert.equal(r.proxyLeaderId, 'dl-0001')
  assert.equal(r.selectionOutcome, 'feasible_candidate')
  assert.equal(r.improvementProven, false)
  assert.equal(r.slow_mode, 'unavailable')
  assert.deepEqual(
    ctx.duoBudget.open(p.runId, p.spec.budget).receipts().slice(0, receipts.length),
    receipts,
  )
  assert.equal(r.budget.operations, 5)
  const status = (await call('dualloop_status', { runId: p.runId })).value
  assert.equal(status.events.filter((e) => e.kind === 'baseline_assessment').length, 1)
  const report = await call('dualloop_report', { runId: p.runId, view: 'summary' })
  assert.equal(report.value.baselineAssessment.fast.verdict, 'constraint_violation')
  assert.equal(JSON.parse(report.content[0].text).selectionOutcome, 'feasible_candidate')
  assert.match(report.value.text, /constraint_violation/)
  assert.deepEqual(readFileSync(target), original)
})

test('all violating candidates terminate without presenting the invalid baseline as a selected solution', async (t) => {
  const { call } = await publicHost(t, basic, { allFail: true })
  const p = (await call('dualloop_plan')).value
  const r = (await call('dualloop_run', { planDigest: p.planDigest })).value
  assert.equal(r.status, 'completed')
  assert.equal(r.generationsRun, 1)
  assert.equal(r.selectionOutcome, 'no_feasible_candidate')
  assert.equal(r.conclusion, 'insufficient_evidence')
  assert.equal(r.championId, null)
  assert.equal(r.proxyLeaderId, null)
  assert.equal(r.selectedOverlay, null)
})

test('dual search and final can validate a repair against a constraint-violating baseline', async (t) => {
  const { ctx } = await setup(
    t,
    { constraints: [constraint], generations: 1 },
    { evaluators: evaluator({ badTier: 'slow' }) },
  )
  const p = ctx.duoController.plan(),
    r = await ctx.duoController.run({ planDigest: p.planDigest })
  assert.equal(r.status, 'completed')
  assert.equal(r.baselineAssessment.slow.verdict, 'constraint_violation')
  assert.equal(r.championId, 'dl-0001')
  assert.equal(r.conclusion, 'recommend_candidate')
})

test('constraint-violating final baseline permits a feasible repair recommendation with explicit basis', async (t) => {
  const { ctx } = await setup(
    t,
    { constraints: [constraint], generations: 1 },
    { evaluators: evaluator() },
  )
  const p = ctx.duoController.plan(),
    r = await ctx.duoController.run({ planDigest: p.planDigest })
  assert.equal(r.status, 'completed')
  assert.equal(r.conclusion, 'recommend_candidate')
  assert.equal(r.independentFinal.comparison.verdicts.baseline, 'constraint_violation')
  assert.equal(r.independentFinal.comparison.decisionBasis['dl-0001'], 'constraint_feasibility')
})

test('repair never turns failed final evidence or final constraint violations into a recommendation', async (t) => {
  for (const options of [{ finalInvalid: true }, { finalFail: true }]) {
    const { ctx } = await setup(
      t,
      { constraints: [constraint], generations: 1 },
      { evaluators: evaluator(options) },
    )
    const p = ctx.duoController.plan(),
      r = await ctx.duoController.run({ planDigest: p.planDigest })
    assert.equal(r.status, 'completed')
    assert.equal(r.selectionOutcome, 'feasible_candidate')
    assert.equal(r.conclusion, 'insufficient_evidence')
    assert.equal(r.improvementProven, false)
  }
})

test('unusable baseline evidence still stops before any candidate generation', async (t) => {
  for (const invalid of [
    (r) => {
      r.ok = false
    },
    (r) => {
      delete r.metrics.critical_misses
    },
    (r) => {
      r.metrics.sample_size = 0
    },
  ]) {
    let generated = 0
    class Counted extends FixtureGenerator {
      async propose(a) {
        generated++
        return super.propose(a)
      }
    }
    const { ctx } = await setup(t, basic, {
      evaluators: evaluator({ invalid }),
      generator: Counted,
    })
    const p = ctx.duoController.plan(),
      r = await ctx.duoController.run({ planDigest: p.planDigest })
    assert.equal(r.status, 'failed')
    assert.equal(r.stopReason, 'DUO_BASELINE_INVALID')
    assert.equal(generated, 0)
    assert.equal(r.baselineAssessment.fast.searchAllowed, false)
  }
})

test('repair admission does not bypass a host permission denial', async (t) => {
  const { ctx, call } = await publicHost(t)
  const p = (await call('dualloop_plan')).value
  ctx.tools.guard(() => 'Not authorized')
  const r = await ctx.tools.execute({
    name: 'dualloop_run',
    arguments: { planDigest: p.planDigest },
    callId: 'denied',
    signal: new AbortController().signal,
  })
  assert.equal(r.isError, true)
  assert.equal(ctx.duoController.status(p.runId).run, null)
})
