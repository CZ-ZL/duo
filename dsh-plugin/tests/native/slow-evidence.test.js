import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { setup, FixtureGenerator, FixtureExecutor, FixtureEvaluators } from './test-fixtures.js'
import { designDraft } from '../../native/onboarding.js'
import { buildReport } from '../../native/observer.js'

const free = { currency: 'CNY', costCny: 0 },
  budget = {
    currency: 'CNY',
    maxCostCny: 0,
    maxSessions: 100,
    maxFastEvals: 20,
    maxSlowEvals: 10,
    maxWallTimeMs: 10000,
  }
const cny = (d) => {
  const { reservationUsd, ...rest } = d
  return { ...rest, currency: 'CNY', reservationCny: 0 }
}
class Generator extends FixtureGenerator {
  describe() {
    return cny(super.describe())
  }
  async propose(a) {
    const { costUsd, ...r } = await super.propose(a)
    return { ...r, ...free }
  }
}
class Executor extends FixtureExecutor {
  describe() {
    return cny(super.describe())
  }
  async execute(a) {
    const { costUsd, ...r } = await super.execute(a)
    return { ...r, ...free }
  }
}
function source(tier, kind) {
  return {
    measurement:
      tier === 'fast'
        ? 'Explicit instruction present'
        : 'Instruction plus required template boundaries',
    targetKinds: ['dsh-persona'],
    family: 'local_assertions',
    coverage: tier === 'fast' ? ['instruction'] : ['instruction', 'template-boundary'],
    dataScope: {
      id: tier + '-assertions-v1',
      purpose: tier === 'final' ? 'final' : 'search',
      description: 'Local executable assertions',
    },
    independentOfSearch: kind === 'high_fidelity',
    realTools: false,
    deterministic: true,
    requiresModel: false,
    approximateCost: { currency: 'CNY', amount: 0 },
    latencyMs: null,
    sideEffects: 'none',
    ...(tier === 'slow'
      ? {
          increment: {
            relativeTo: { id: 'fixture-fast', version: '1', dataId: 'fast' },
            kind,
            reason: 'Check preserved template placeholders in addition to instruction.',
            ...(kind === 'high_fidelity'
              ? {
                  qualification: {
                    status: 'passed',
                    reference:
                      'slow-evidence.test.js frozen local positive/negative boundary controls',
                    version: '1',
                    metric: 'quality',
                  },
                }
              : {}),
          },
        }
      : {}),
  }
}
function providers(kind = 'expanded_evidence', extra = {}) {
  class Evaluator extends FixtureEvaluators {
    describe() {
      return super
        .describe()
        .map((d) => ({ ...cny(d), evidenceSource: source(d.tier, kind), ...extra }))
    }
    async evaluate({ candidate, artifact, tier }) {
      const instruction = artifact.includes('answer clearly'),
        boundary = artifact.includes('{{model}}') && artifact.includes('{{cwd}}')
      return {
        candidateId: candidate.id,
        evaluatorId: 'fixture-' + tier,
        version: '1',
        dataId: tier,
        tier,
        ok: true,
        metrics: {
          quality:
            tier === 'fast' ? Number(instruction) : (Number(instruction) + Number(boundary)) / 2,
          safe: true,
          sample_size: 2,
        },
        ...free,
        evidenceCoverage: tier === 'fast' ? ['instruction'] : ['instruction', 'template-boundary'],
        evidence: [{ instruction, boundary: tier === 'fast' ? null : boundary }],
      }
    }
  }
  return { generator: Generator, executor: Executor, evaluators: Evaluator }
}
const options = {
  preset: 'optimize-auto',
  final: null,
  budget,
  generations: 1,
  quotas: { exploit: 1, explore: 0, innovate: 0 },
}
test('expanded evidence lazily measures a violating Slow baseline and admits only a feasible repair', async (t) => {
  const configured = providers()
  class RepairMeasure extends configured.evaluators {
    async evaluate(args) {
      const r = await super.evaluate(args)
      // safe is a quality assertion over an isolated test artifact, not host permission.
      r.metrics.safe = !(args.tier === 'slow' && args.candidate.id === 'baseline')
      return r
    }
  }
  const { ctx } = await setup(t, options, { ...configured, evaluators: RepairMeasure })
  const p = ctx.duoController.plan(),
    r = await ctx.duoController.run({ planDigest: p.planDigest })
  assert.equal(r.status, 'completed')
  assert.equal(r.slow_mode, 'expanded_evidence')
  assert.equal(r.championId, 'dl-0001')
  assert.equal(r.selectionOutcome, 'feasible_candidate')
  assert.equal(r.baselineAssessment.slow.verdict, 'constraint_violation')
  const events = ctx.duoController.status(p.runId).events
  const request = events.findIndex(
    (e) => e.kind === 'evidence_decision' && e.decision.action === 'request_more_evidence',
  )
  assert.ok(
    request >= 0 &&
      request < events.findIndex((e) => e.kind === 'baseline_assessment' && e.tier === 'slow'),
  )
  assert.equal(r.budget.costCny, 0)
})
for (const mode of ['expanded_evidence', 'high_fidelity'])
  test(
    'plan negotiates ' + mode + ' and actual report records additional local evidence',
    async (t) => {
      const { ctx } = await setup(t, options, providers(mode)),
        p = ctx.duoController.plan()
      assert.equal(p.evidenceStrategy?.slow_mode, mode)
      const r = await ctx.duoController.run({ planDigest: p.planDigest })
      assert.equal(r.status, 'completed')
      assert.equal(r.optimization_mode, 'dual_loop')
      assert.equal(r.slow_mode, mode)
      assert.ok(
        r.additional_evidence_acquired.some(
          (e) => e.candidateId === 'dl-0001' && e.coverage.includes('template-boundary'),
        ),
      )
      const report = buildReport(ctx.duoController.status(p.runId))
      assert.equal(report.slow_mode, mode)
      assert.equal(report.optimization_mode, 'dual_loop')
      assert.equal(r.budget.costCny, 0)
      assert.equal(r.improvementProven, false)
    },
  )
test('Fast alone runs basic and explicitly says it is not dual validation', async (t) => {
  const { ctx } = await setup(t, { ...options, preset: 'optimize-basic', slow: null }, providers()),
    p = ctx.duoController.plan()
  assert.equal(p.evidenceStrategy?.status, 'READY_WITH_LIMITATIONS')
  const r = await ctx.duoController.run({ planDigest: p.planDigest })
  assert.equal(r.optimization_mode, 'single_fidelity')
  assert.equal(r.slow_mode, 'unavailable')
  assert.equal(r.proxyLeaderId, 'dl-0001')
  assert.equal(r.budget.slowAttempts, 0)
  assert.deepEqual(r.additional_evidence_acquired, [])
  assert.ok(r.limitations.some((x) => x.includes('does not constitute dual-loop validation')))
})
test('forced dual without incremental source refuses before any Journal work', async (t) => {
  const { ctx } = await setup(t, { ...options, preset: 'optimize-dual', slow: null }, providers())
  assert.throws(() => ctx.duoController.plan(), { code: 'DUO_ADDITIONAL_EVIDENCE_REQUIRED' })
})
test('expensive same evidence cannot qualify and auto downgrade is plan/result/Journal visible', async (t) => {
  const declarations = source('slow', 'expanded_evidence')
  declarations.coverage = ['instruction']
  const { ctx } = await setup(
      t,
      options,
      providers('expanded_evidence', { evidenceSource: declarations }),
    ),
    p = ctx.duoController.plan()
  assert.equal(p.evidenceStrategy?.slow_mode, 'unavailable')
  assert.equal(p.evidenceStrategy?.downgrade?.to, 'single_fidelity')
  const r = await ctx.duoController.run({ planDigest: p.planDigest })
  assert.equal(r.budget.slowAttempts, 0)
  assert.equal(r.slow_mode, 'unavailable')
  assert.equal(r.optimization_mode, 'single_fidelity')
  assert.ok(
    ctx.duoController
      .status(p.runId)
      .events.some(
        (e) => e.kind === 'evidence_strategy' && e.strategy.downgrade?.to === 'single_fidelity',
      ),
  )
})
test('public preset is persisted in draft and basic needs no additional evaluator', () => {
  const r = designDraft(
    {
      id: 'basic',
      target: { kind: 'dsh-persona', path: '/tmp/target' },
      fast: {
        evaluatorId: 'x',
        version: '1',
        dataId: 'dev',
        metric: 'quality',
        direction: 'maximize',
        weights: { quality: 1 },
      },
      budget,
    },
    '/tmp/experiment',
    {},
    'optimize-basic',
  )
  assert.equal(r.resolved?.spec.preset, 'optimize-basic')
  assert.equal(r.readyForPlan, true)
})

test('no remaining Slow allowance holds with a budget reason without purchasing a baseline Slow measurement', async (t) => {
  const { ctx } = await setup(
      t,
      { ...options, budget: { ...budget, maxSlowEvals: 0 } },
      providers(),
    ),
    p = ctx.duoController.plan()
  const r = await ctx.duoController.run({ planDigest: p.planDigest })
  assert.equal(r.status, 'completed')
  assert.equal(r.budget.slowAttempts, 0)
  assert.equal(r.championId, 'baseline')
  assert.ok(r.decision_basis.some((d) => d.action === 'hold' && d.reason === 'BUDGET_CONSTRAINT'))
})
test('declared extra coverage without actual coverage receipt cannot promote', async (t) => {
  const P = providers()
  class MissingReceipt extends P.evaluators {
    async evaluate(a) {
      const r = await super.evaluate(a)
      if (a.tier === 'slow') r.evidenceCoverage = ['instruction']
      return r
    }
  }
  const { ctx } = await setup(t, options, { ...P, evaluators: MissingReceipt }),
    p = ctx.duoController.plan(),
    r = await ctx.duoController.run({ planDigest: p.planDigest })
  assert.equal(r.championId, 'baseline')
  assert.deepEqual(r.additional_evidence_acquired, [])
  assert.ok(
    r.decision_basis.some(
      (d) => d.action === 'hold' && d.reason === 'EVIDENCE_COVERAGE_UNCONFIRMED',
    ),
  )
})
test('public Gate replacement may hold a measured candidate and actual next generation receives safe strategy feedback', async (t) => {
  const { TopKGate } = await import('../../native/policies.js'),
    seen = []
  class Hold extends TopKGate {
    describe() {
      return { ...super.describe(), id: 'hold-policy' }
    }
    decide(request) {
      const d = super.decide(request)
      return d.action === 'promote' ? { ...d, action: 'hold', reason: 'OWNER_POLICY_HOLD' } : d
    }
  }
  class Recording extends Generator {
    async propose(a) {
      seen.push(structuredClone(a.feedback))
      const r = await super.propose(a)
      for (const c of r.candidates) c.delta.persona += '\n generation ' + a.generation
      return r
    }
  }
  const { ctx, fibers } = await setup(
    t,
    { ...options, generations: 2 },
    { ...providers(), generator: Recording },
  )
  await fibers[3].dispose()
  const f = await ctx.plugin(Hold)
  t.after(() => f.dispose())
  const p = ctx.duoController.plan(),
    r = await ctx.duoController.run({ planDigest: p.planDigest })
  assert.equal(r.championId, 'baseline')
  assert.ok(r.decision_basis.some((d) => d.reason === 'OWNER_POLICY_HOLD'))
  assert.ok(seen[1].evidenceDecisions.some((d) => d.action === 'hold'))
  assert.equal(JSON.stringify(seen[1].evidenceDecisions).includes('artifact'), false)
})
test('Slow provider removal changes plan and old digest cannot dispatch any additional work', async (t) => {
  let includeSlow = true,
    calls = 0
  const P = providers()
  class Dynamic extends P.evaluators {
    describe() {
      return super.describe().filter((d) => includeSlow || d.tier === 'fast')
    }
    async evaluate(a) {
      calls++
      return super.evaluate(a)
    }
  }
  const { ctx } = await setup(t, options, { ...P, evaluators: Dynamic }),
    p = ctx.duoController.plan()
  includeSlow = false
  const current = ctx.duoController.plan()
  assert.notEqual(current.planDigest, p.planDigest)
  assert.equal(current.evidenceStrategy.slow_mode, 'unavailable')
  await assert.rejects(ctx.duoController.run({ planDigest: p.planDigest }), {
    code: 'DUO_PLAN_CHANGED',
  })
  assert.equal(calls, 0)
})

test('a stop decision stops later generations and does not dispatch final or extra evidence', async (t) => {
  const { TopKGate } = await import('../../native/policies.js')
  class Stop extends TopKGate {
    decide(r) {
      return {
        ...super.decide(r),
        action: 'stop',
        reason: 'SUFFICIENT_LOCAL_INFORMATION',
        request: null,
      }
    }
  }
  const { ctx, fibers } = await setup(
    t,
    {
      ...options,
      generations: 3,
      final: {
        evaluatorId: 'fixture-final',
        version: '1',
        dataId: 'final',
        metric: 'quality',
        direction: 'maximize',
        weights: { quality: 1 },
      },
    },
    providers(),
  )
  await fibers[3].dispose()
  const f = await ctx.plugin(Stop)
  t.after(() => f.dispose())
  const p = ctx.duoController.plan(),
    r = await ctx.duoController.run({ planDigest: p.planDigest })
  assert.equal(r.final.length, 0)
  assert.equal(r.stopReason, 'evidence_policy_stop')
  assert.equal(r.generationsRun, 1)
  assert.equal(r.budget.slowAttempts, 0)
})
test('expensive provider names and model strength alone do not classify fidelity', async () => {
  const { negotiateEvidence } = await import('../../native/evidence-strategy.js')
  const spec = {
    ...options,
    target: { kind: 'dsh-persona', path: '/tmp/x' },
    permissions: { paid: true, network: false, externalSideEffects: false },
    budget: { ...budget, maxCostCny: 100 },
    fast: {
      evaluatorId: 'f',
      version: '1',
      dataId: 'dev',
      metric: 'quality',
      direction: 'maximize',
      weights: { quality: 1 },
    },
    slow: {
      evaluatorId: 'strong-expensive',
      version: '1',
      dataId: 'same-dev-renamed',
      metric: 'quality',
      direction: 'maximize',
      weights: { quality: 1 },
    },
  }
  const ds = ['fast', 'slow'].map((tier) => ({
    id: spec[tier].evaluatorId,
    version: '1',
    dataId: spec[tier].dataId,
    tier,
    metrics: ['quality', 'sample_size'],
    currency: 'CNY',
    reservationCny: tier === 'slow' ? 90 : 1,
    model: tier === 'slow' ? 'strongest' : 'small',
    permissions: spec.permissions,
    evidenceFamily: 'same',
  }))
  const r = negotiateEvidence(spec, ds)
  assert.equal(r.slow_mode, 'unavailable')
  assert.equal(r.activeTiers.length, 1)
  assert.equal(r.sources[0].latencyMs, null)
  assert.equal(r.sources[0].requiresModel, null)
  assert.equal(r.sources[0].approximateCost, null)
})
test('frozen local correct/incorrect controls distinguish the additional boundary objective', async (t) => {
  const P = providers('high_fidelity'),
    { ctx } = await setup(t, options, P)
  const good = await ctx.duoEvaluators.evaluate({
    candidate: { id: 'good' },
    artifact: 'answer clearly {{model}} {{cwd}}',
    tier: 'slow',
  })
  const bad = await ctx.duoEvaluators.evaluate({
    candidate: { id: 'bad' },
    artifact: 'unrelated invalid text',
    tier: 'slow',
  })
  const boundaryBad = await ctx.duoEvaluators.evaluate({
    candidate: { id: 'boundary-bad' },
    artifact: 'answer clearly',
    tier: 'slow',
  })
  assert.equal(good.metrics.quality, 1)
  assert.equal(bad.metrics.quality, 0)
  assert.equal(boundaryBad.metrics.quality, 0.5)
  assert.equal(
    (
      await ctx.duoEvaluators.evaluate({
        candidate: { id: 'boundary-bad' },
        artifact: 'answer clearly',
        tier: 'fast',
      })
    ).metrics.quality,
    1,
  )
})

test('public preparation permits transparent auto fallback but refuses forced dual with the same missing source', async (t) => {
  const { default: Agents } = await import('@deepseek-ai/dsh-agent'),
    { default: SystemPrompt } = await import('@deepseek-ai/dsh-system-prompt'),
    { default: Tools } = await import('@deepseek-ai/dsh-tools'),
    Onboarding = await import('../../native/onboarding.js')
  const P = providers()
  class FastOnly extends P.evaluators {
    describe() {
      return super.describe().filter((d) => d.tier === 'fast')
    }
  }
  const { ctx, contract, experiment } = await setup(t, options, { ...P, evaluators: FastOnly })
  const fibers = []
  for (const plugin of [Agents, SystemPrompt, Tools, Onboarding])
    fibers.push(await ctx.plugin(plugin))
  t.after(async () => {
    for (const f of fibers.reverse()) await f.dispose()
  })
  const call = (preset) =>
    ctx.tools.execute({
      name: 'dualloop_design',
      arguments: { draft: { ...contract, preset }, experimentPath: experiment },
      callId: 'design',
      signal: new AbortController().signal,
    })
  const description = await ctx.tools.execute({
    name: 'dualloop_describe',
    arguments: {},
    callId: 'describe',
    signal: new AbortController().signal,
  })
  assert.equal(description.value.evidenceStrategy?.slow_mode, 'unavailable')
  assert.equal(description.value.evidenceStrategy?.status, 'READY_WITH_LIMITATIONS')
  const auto = await call('optimize-auto')
  assert.equal(auto.isError, false)
  assert.equal(
    auto.value.readyForPlan,
    true,
    JSON.stringify({
      status: auto.value.status,
      issues: auto.value.issues,
      evidenceStrategy: auto.value.evidenceStrategy,
      matches: auto.value.evaluators.matches,
    }),
  )
  assert.equal(auto.value.evidenceStrategy.status, 'READY_WITH_LIMITATIONS')
  assert.equal(auto.value.evidenceStrategy.slow_mode, 'unavailable')
  const dual = await call('optimize-dual')
  assert.equal(dual.isError, false)
  assert.equal(dual.value.readyForPlan, false)
  assert.equal(dual.value.evidenceStrategy.recommended_mode, 'preparation_required')
})
test('actual Cordis evaluator disposal and replacement invalidates an old dual plan', async (t) => {
  const P = providers(),
    { ctx, fibers } = await setup(t, options, P),
    old = ctx.duoController.plan()
  await fibers[9].dispose()
  assert.equal(ctx.get('duoController'), undefined)
  class FastOnly extends P.evaluators {
    describe() {
      return super.describe().filter((d) => d.tier === 'fast')
    }
  }
  const replacement = await ctx.plugin(FastOnly)
  t.after(() => replacement.dispose())
  const fresh = ctx.duoController.plan()
  assert.equal(fresh.evidenceStrategy.slow_mode, 'unavailable')
  await assert.rejects(ctx.duoController.run({ planDigest: old.planDigest }), {
    code: 'DUO_PLAN_CHANGED',
  })
})

test('an existing multi-stage schedule cannot purchase the same additional coverage twice', async () => {
  const { negotiateEvidence } = await import('../../native/evidence-strategy.js')
  const tiers = ['fast', 'slow', 'repeated'],
    spec = {
      ...options,
      target: { kind: 'dsh-persona', path: '/tmp/x' },
      permissions: { paid: false, network: false, externalSideEffects: false },
      searchStages: tiers.map((tier, i) => ({
        tier,
        evaluatorId: 'fixture-' + tier,
        version: '1',
        dataId: tier,
        metric: 'quality',
        direction: 'maximize',
        weights: { quality: 1 },
        purpose: 'screen',
        informationGain: 'Explicit frozen coverage',
        maxEvaluations: 10,
        topK: i === 2 ? 0 : 1,
      })),
    }
  const descriptors = tiers.map((tier) => ({
    id: 'fixture-' + tier,
    version: '1',
    dataId: tier,
    tier,
    metrics: ['quality', 'sample_size'],
    currency: 'CNY',
    reservationCny: 0,
    permissions: spec.permissions,
    evidenceSource: source(tier === 'repeated' ? 'slow' : tier, 'expanded_evidence'),
  }))
  const r = negotiateEvidence(spec, descriptors)
  assert.deepEqual(r.activeTiers, ['fast', 'slow'])
  assert.ok(r.additional_options[1].reasons.includes('COVERAGE_ALREADY_AVAILABLE'))
})

test('basic deliberately skips an available extra source without calling it unavailable capability', async (t) => {
  const { ctx } = await setup(t, { ...options, preset: 'optimize-basic' }, providers()),
    p = ctx.duoController.plan()
  assert.equal(p.evidenceStrategy.additional_slow_evidence, 'available')
  assert.equal(p.evidenceStrategy.slow_mode, 'unavailable')
  assert.deepEqual(p.evidenceStrategy.activeTiers, ['fast'])
  const r = await ctx.duoController.run({ planDigest: p.planDigest })
  assert.equal(r.budget.slowAttempts, 0)
  assert.ok(r.limitations.some((s) => s.includes('not selected by optimize-basic')))
})

test('basic preparation accepts a legacy evaluator with unknown optional source metadata', async (t) => {
  const { default: Agents } = await import('@deepseek-ai/dsh-agent'),
    { default: SystemPrompt } = await import('@deepseek-ai/dsh-system-prompt'),
    { default: Tools } = await import('@deepseek-ai/dsh-tools'),
    Onboarding = await import('../../native/onboarding.js')
  const P = providers()
  class Legacy extends P.evaluators {
    describe() {
      return super.describe().map(({ evidenceSource, ...d }) => d)
    }
  }
  const { ctx, contract, experiment } = await setup(
    t,
    { ...options, preset: 'optimize-basic' },
    { ...P, evaluators: Legacy },
  )
  const fibers = []
  for (const plugin of [Agents, SystemPrompt, Tools, Onboarding])
    fibers.push(await ctx.plugin(plugin))
  t.after(async () => {
    for (const f of fibers.reverse()) await f.dispose()
  })
  const r = await ctx.tools.execute({
    name: 'dualloop_design',
    arguments: { draft: contract, experimentPath: experiment },
    callId: 'legacy',
    signal: new AbortController().signal,
  })
  assert.equal(r.isError, false)
  assert.equal(r.value.readyForPlan, true)
  assert.equal(r.value.evidenceStrategy.fast_evidence, 'available')
  assert.equal(ctx.duoController.plan().evidenceStrategy.slow_mode, 'unavailable')
})
