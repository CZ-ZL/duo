import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import FunctionEvaluators from '../../native/function-evaluators.js'
import { createSupportShadow } from '../../native/quick-judgment.js'
import { WeightedComparator, ConservativeFeedback } from '../../native/policies.js'
import { setup, FixtureGenerator, FixtureExecutor } from './test-fixtures.js'
import { readFileSync } from 'node:fs'

const request = {
  candidate: { id: 'candidate-1', version: 'v1', persona: 'PRIVATE_PROMPT' },
  artifact: { answer: 'The service uses port 80.', privateGold: 'PRIVATE_GOLD' },
  tier: 'fast',
}
const primaryResult = {
  ok: true,
  currency: 'CNY',
  costCny: 0,
  metrics: { quality: 1, sample_size: 1 },
  evidence: [{ kind: 'existing-test', passed: true }],
}
function configuration({ judgeResult, primaryChange, judgeThrows = false } = {}) {
  const calls = []
  const primary = {
    implementationDigest: 'primary-code-1',
    dataDigest: 'source-data-1',
    descriptors: [
      {
        id: 'existing-fast',
        version: '1',
        tier: 'fast',
        dataId: 'data-1',
        currency: 'CNY',
        reservationCny: 0,
        permissions: { paid: false, network: false, externalSideEffects: false },
        metrics: ['quality', 'sample_size'],
        evidenceKind: 'fixture',
        evidenceFamily: 'existing-test',
        fidelityRationale: 'Existing local measurement',
      },
    ],
    evaluate: async () => structuredClone({ ...primaryResult, ...primaryChange }),
  }
  const judge = {
    descriptor: {
      id: 'scripted-support',
      version: '1',
      configDigest: 'judge-code-1',
      currency: 'CNY',
      reservationCny: 0.01,
      evidenceKind: 'fixture',
      permissions: { paid: true, network: false, externalSideEffects: false },
      maxRequests: 1,
    },
    async judge(args) {
      calls.push(args)
      if (judgeThrows) throw new Error('possibly dispatched')
      return (
        judgeResult ?? {
          status: 'measured',
          currency: 'CNY',
          costCny: 0.002,
          judgments: [{ id: 'claim-1', verdict: 'contradicted' }],
          costEvidence: { kind: 'fixture', attempts: 1 },
        }
      )
    },
  }
  const config = createSupportShadow({
    primary,
    judge,
    projectionId: 'claim-projection-v1',
    project: ({ artifact }) => [
      { id: 'claim-1', source: 'The service uses port 443.', claim: artifact.answer },
    ],
  })
  return { config, calls, primary, judge }
}
async function load(t, config) {
  const ctx = new Context()
  const fiber = await ctx.plugin(FunctionEvaluators, config)
  t.after(() => fiber.dispose())
  return ctx.duoEvaluators
}

test('shadow metadata respects local and unknown judge declarations without treating expense as fidelity', () => {
  for (const declared of [false, true]) {
    const c = configuration()
    c.primary.descriptors[0].evidenceSource = {
      requiresModel: false,
      deterministic: true,
      realTools: false,
    }
    if (declared)
      Object.assign(c.judge.descriptor, {
        requiresModel: false,
        deterministic: true,
        realTools: false,
      })
    const config = createSupportShadow({ ...c, projectionId: 'metadata-v1', project: () => [] })
    const source = config.descriptors[0].evidenceSource
    assert.equal(source.requiresModel, declared ? false : null)
    assert.equal(source.deterministic, declared ? true : null)
    assert.equal(source.realTools, declared ? false : null)
    assert.equal(source.increment, undefined)
  }
})

test('shadow contradiction is retained without replacing the primary score or becoming a quality claim', async (t) => {
  const { config, calls } = configuration()
  const service = await load(t, config)
  const result = await service.evaluate(request)
  assert.deepEqual(result.metrics, primaryResult.metrics)
  assert.equal(result.ok, true)
  assert.equal(result.evidence[0].kind, 'existing-test')
  const shadow = result.evidence.find((e) => e.kind === 'quick_support_shadow')
  assert.equal(shadow?.status, 'measured')
  assert.deepEqual(shadow.judgments, [{ id: 'claim-1', verdict: 'contradicted' }])
  assert.equal(shadow.purpose, 'diagnostic_only')
  assert.equal(shadow.qualification, 'NOT_QUALIFIED')
  assert.equal(result.costCny, 0.002)
  assert.equal(calls.length, 1)
  assert.ok(!JSON.stringify(calls).includes('PRIVATE_'))
  const descriptor = service.describe()[0]
  assert.equal(descriptor.id, 'existing-fast-support-shadow')
  assert.equal(descriptor.version, '1+support-shadow.1')
  assert.equal(descriptor.reservationCny, 0.01)
  assert.equal(descriptor.permissions.paid, true)
  assert.equal(descriptor.shadow.affectsSelection, false)
})

test('invalid output is not an uncertain judgment; known cost is retained and primary metrics survive', async (t) => {
  for (const judgments of [
    [{ id: 'claim-1', verdict: 'probably' }],
    [{ id: 'other', verdict: 'supported' }],
    [{ id: 'claim-1', verdict: 'supported', confidence: 0.99 }],
    [
      { id: 'claim-1', verdict: 'supported' },
      { id: 'claim-1', verdict: 'supported' },
    ],
  ]) {
    const { config, calls } = configuration({
      judgeResult: { status: 'measured', currency: 'CNY', costCny: 0.002, judgments },
    })
    const result = await (await load(t, config)).evaluate(request)
    assert.equal(result.ok, true)
    assert.deepEqual(result.metrics, primaryResult.metrics)
    assert.equal(result.evidence.at(-1)?.status, 'invalid_output')
    assert.deepEqual(result.evidence.at(-1).judgments, [])
    assert.equal(result.costCny, 0.002)
    assert.equal(calls.length, 1)
  }
})

test('unknown judgment cost stops the operation and never retries or becomes free', async (t) => {
  for (const options of [
    { judgeThrows: true },
    { judgeResult: { status: 'failed', currency: 'CNY', costCny: null } },
    { judgeResult: { status: 'measured', currency: 'USD', costUsd: 0 } },
  ]) {
    const { config, calls } = configuration(options)
    const result = await (await load(t, config)).evaluate(request)
    assert.equal(result.ok, false)
    assert.equal(result.costCny, null)
    assert.equal(result.costEvidence.shadow.kind, 'quick_support_shadow')
    assert.equal(result.costEvidence.unknownCost, true)
    assert.equal(calls.length, 1)
  }
})

test('shadow overrun stops after retaining its known fee; invalid projection never dispatches', async (t) => {
  const { config, calls } = configuration({
    judgeResult: {
      status: 'failed',
      currency: 'CNY',
      costCny: 0.02,
    },
  })
  const over = await (await load(t, config)).evaluate(request)
  assert.equal(over.ok, false)
  assert.equal(over.costCny, 0.02)
  // FunctionEvaluators normalizes callback refusals; retain the precise reason
  // alongside the receipt instead of changing that existing public contract.
  assert.equal(over.error.code, 'DUO_EVIDENCE_INVALID')
  assert.equal(over.costEvidence.stopReason, 'DUO_BUDGET_OVERRUN')
  assert.equal(calls.length, 1)
  const next = configuration()
  const invalid = createSupportShadow({ ...next, projectionId: 'invalid-v1', project: () => [] })
  const result = await (await load(t, invalid)).evaluate(request)
  assert.equal(result.ok, true)
  assert.equal(result.evidence.at(-1).status, 'invalid_input')
  assert.equal(next.calls.length, 0)
})

test('invalid primary evidence or cancellation does not spend on a shadow judgment', async (t) => {
  const { config, calls } = configuration({ primaryChange: { ok: false } })
  assert.equal((await (await load(t, config)).evaluate(request)).ok, false)
  assert.equal(calls.length, 0)
  const second = configuration()
  const cancelled = new AbortController()
  cancelled.abort()
  const result = await (
    await load(t, second.config)
  ).evaluate({ ...request, signal: cancelled.signal })
  assert.equal(result.costCny, 0)
  assert.equal(second.calls.length, 0)
})

test('default comparator and feedback ignore shadow verdicts including a deliberately opposite label', async (t) => {
  const { config } = configuration()
  const withShadow = await (await load(t, config)).evaluate(request)
  const withoutShadow = { ...withShadow, evidence: primaryResult.evidence }
  const ctx = new Context()
  const fibers = await Promise.all([
    ctx.plugin(WeightedComparator),
    ctx.plugin(ConservativeFeedback),
  ])
  t.after(async () => {
    for (const f of fibers) await f.dispose()
  })
  const objective = { weights: { quality: 1 }, epsilon: 0.01 }
  const incumbent = { ...withoutShadow, candidateId: 'baseline' }
  assert.deepEqual(
    ctx.duoComparator.compare([incumbent, withShadow], objective, 'baseline'),
    ctx.duoComparator.compare([incumbent, withoutShadow], objective, 'baseline'),
  )
  const entries = (fast) => [{ candidateId: 'candidate-1', family: 'one', mode: 'exploit', fast }]
  const quotas = { exploit: 1, explore: 0, innovate: 0 }
  assert.deepEqual(
    ctx.duoFeedback.summarize(entries(withShadow), quotas),
    ctx.duoFeedback.summarize(entries(withoutShadow), quotas),
  )
})

const cnyDescriptor = ({ reservationUsd, ...d }) => ({ ...d, currency: 'CNY', reservationCny: 0 })
class LocalGenerator extends FixtureGenerator {
  describe() {
    return cnyDescriptor(super.describe())
  }
  async propose(args) {
    const { costUsd, ...r } = await super.propose(args)
    return { ...r, currency: 'CNY', costCny: 0 }
  }
}
class LocalExecutor extends FixtureExecutor {
  describe() {
    return cnyDescriptor(super.describe())
  }
  async execute(args) {
    const { costUsd, ...r } = await super.execute(args)
    return { ...r, currency: 'CNY', costCny: 0 }
  }
}
async function controller(
  t,
  { shadow = true, paid = true, maxCostCny = 0.1, unknownCost = false } = {},
) {
  const c = configuration(
    unknownCost ? { judgeResult: { status: 'failed', currency: 'CNY', costCny: null } } : {},
  )
  c.primary.evaluate = async ({ artifact }) => ({
    ...primaryResult,
    metrics: { quality: Number(artifact.includes('answer clearly')), sample_size: 1 },
  })
  const config = shadow
    ? createSupportShadow({
        ...c,
        projectionId: 'controller-support-v1',
        project: ({ artifact }) => [
          { id: 'claim-1', source: 'An explicit instruction is present.', claim: artifact },
        ],
      })
    : c.primary
  class Evaluator extends FunctionEvaluators {
    constructor(ctx) {
      super(ctx, config)
    }
  }
  const d = config.descriptors[0]
  return {
    ...(await setup(
      t,
      {
        preset: 'optimize-basic',
        slow: null,
        final: null,
        constraints: [],
        minSamples: 1,
        generations: 1,
        quotas: { exploit: 1, explore: 0, innovate: 0 },
        fast: {
          evaluatorId: d.id,
          version: d.version,
          dataId: d.dataId,
          weights: { quality: 1 },
          metric: 'quality',
          direction: 'maximize',
        },
        permissions: { paid, network: false, externalSideEffects: false },
        budget: {
          currency: 'CNY',
          maxCostCny,
          maxSessions: 5,
          maxFastEvals: 2,
          maxSlowEvals: 0,
          maxWallTimeMs: 10000,
        },
      },
      { generator: LocalGenerator, executor: LocalExecutor, evaluators: Evaluator },
    )),
    calls: c.calls,
  }
}

test('native run journals shadow evidence, settles fees and keeps primary selection; report replay dispatches nothing', async (t) => {
  const outcomes = []
  for (const shadow of [false, true]) {
    const h = await controller(t, { shadow })
    const original = readFileSync(h.target, 'utf8')
    const p = h.ctx.duoController.plan()
    const result = await h.ctx.duoController.run({ planDigest: p.planDigest })
    assert.equal(result.status, 'completed')
    assert.equal(result.optimization_mode, 'single_fidelity')
    assert.equal(result.slow_mode, 'unavailable')
    assert.equal(result.championId, null) // basic mode reports a proxy leader, not a validated champion
    outcomes.push(result.proxyLeaderId)
    assert.equal(result.budget.costCny, shadow ? 0.004 : 0)
    assert.equal(h.calls.length, shadow ? 2 : 0)
    assert.equal(readFileSync(h.target, 'utf8'), original)
    const events = h.ctx.duoController.status(p.runId).events
    assert.equal(JSON.stringify(events).includes('quick_support_shadow'), shadow)
    await h.ctx.duoController.run({ planDigest: p.planDigest })
    h.ctx.duoController.status(p.runId)
    assert.equal(h.calls.length, shadow ? 2 : 0)
  }
  assert.deepEqual(outcomes, ['dl-0001', 'dl-0001'])
})

test('authorization, reservation and unknown-cost stops use the existing native safety boundaries', async (t) => {
  const unauthorized = await controller(t, { paid: false, maxCostCny: 0 })
  // Existing capability negotiation refuses the unavailable authorized evaluator
  // before provider binding; this is its current preparation error code.
  assert.throws(() => unauthorized.ctx.duoController.plan(), {
    code: 'DUO_ADDITIONAL_EVIDENCE_REQUIRED',
  })
  assert.equal(unauthorized.calls.length, 0)
  const poor = await controller(t, { maxCostCny: 0 })
  const plan = poor.ctx.duoController.plan()
  const stopped = await poor.ctx.duoController.run({ planDigest: plan.planDigest })
  assert.notEqual(stopped.status, 'completed')
  assert.equal(poor.calls.length, 0)
  const unknown = await controller(t, { unknownCost: true })
  const p = unknown.ctx.duoController.plan()
  const result = await unknown.ctx.duoController.run({ planDigest: p.planDigest })
  assert.equal(result.budget.blockedReason, 'DUO_COST_UNKNOWN')
  assert.equal(unknown.calls.length, 1)
  const receipts = unknown.ctx.duoBudget.open(p.runId, p.spec.budget).receipts()
  assert.ok(JSON.stringify(receipts).includes('quick_support_shadow'))
})
