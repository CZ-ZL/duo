import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import FunctionEvaluators from './function-evaluators.js'
import * as FunctionProviders from './function-evaluators.js'
const descriptors = ['fast', 'slow', 'final'].map((tier) => ({
  id: 'custom-' + tier,
  version: '1',
  tier,
  dataId: tier,
  metrics: ['quality', 'sample_size'],
  currency: 'CNY',
  reservationCny: 0,
  permissions: { paid: false, network: false, externalSideEffects: false },
  evidenceKind: 'fixture',
  evidenceFamily: tier === 'fast' ? 'literal-check' : 'structural-check',
  fidelityRationale: 'Functional composition example only; no fidelity qualification.',
}))
async function service(t, evaluate, extra = {}) {
  const ctx = new Context(),
    f = await ctx.plugin(FunctionEvaluators, {
      descriptors,
      implementationDigest: 'caller-code-v1',
      dataDigest: 'frozen-data-v1',
      evaluate,
      ...extra,
    })
  t.after(() => f.dispose())
  return ctx.duoEvaluators
}
const request = {
  candidate: { id: 'c' },
  artifact: { answer: '42' },
  tier: 'fast',
  signal: new AbortController().signal,
}
test('existing function returns facts while adapter binds native identities and evidence declarations', async (t) => {
  let calls = 0
  const evaluator = await service(t, async (args) => {
    calls++
    assert.equal(args.signal, request.signal)
    return {
      ok: true,
      metrics: { quality: args.artifact.answer === '42' ? 1 : 0, sample_size: 1 },
      currency: 'CNY',
      costCny: 0,
      evidence: [{ kind: 'local-check' }],
    }
  })
  const r = await evaluator.evaluate(request)
  assert.equal(r.candidateId, 'c')
  assert.equal(r.evaluatorId, 'custom-fast')
  assert.equal(r.tier, 'fast')
  assert.equal(r.metrics.quality, 1)
  assert.equal(calls, 1)
  assert.equal(evaluator.describe()[0].evidenceFamily, 'literal-check')
  assert.equal(evaluator.describe()[0].qualification, 'CALLER_DECLARED_NOT_VERIFIED_BY_DUO')
})
test('invalid measurements preserve a known cost instead of becoming an accepted score', async (t) => {
  const e = await service(t, async () => ({
    ok: true,
    metrics: { quality: NaN, sample_size: 1 },
    currency: 'CNY',
    costCny: 0.01,
  }))
  const r = await e.evaluate(request)
  assert.equal(r.ok, false)
  assert.equal(r.costCny, 0.01)
  assert.equal(r.error.code, 'DUO_EVIDENCE_INVALID')
})
test('exception or missing/wrong-currency fee remains unknown with no retry', async (t) => {
  for (const behavior of [
    async () => {
      throw new Error('failed after possible work')
    },
    async () => ({ ok: true, metrics: { quality: 1, sample_size: 1 } }),
    async () => ({ ok: true, metrics: { quality: 1, sample_size: 1 }, costUsd: 0 }),
  ]) {
    let n = 0
    const e = await service(t, async (...args) => {
        n++
        return behavior(...args)
      }),
      r = await e.evaluate(request)
    assert.equal(r.costCny, null)
    assert.equal(r.ok, false)
    assert.equal(n, 1)
  }
})
test('invalid tier and pre-aborted request refuse before the external function is invoked', async (t) => {
  let n = 0
  const e = await service(t, async () => {
    n++
    return {}
  })
  const a = await e.evaluate({ ...request, tier: 'private' })
  assert.equal(a.costCny, 0)
  assert.equal(a.ok, false)
  const abort = new AbortController()
  abort.abort()
  const b = await e.evaluate({ ...request, signal: abort.signal })
  assert.equal(b.costCny, 0)
  assert.equal(n, 0)
})
test('caller function cannot forge evaluator identity or omit required metric coverage', async (t) => {
  for (const change of [{ candidateId: 'other' }, { metrics: { quality: 1 } }]) {
    const e = await service(t, async () => ({
        ok: true,
        metrics: { quality: 1, sample_size: 1 },
        currency: 'CNY',
        costCny: 0,
        ...change,
      })),
      r = await e.evaluate(request)
    assert.equal(r.ok, false)
  }
})
const controls = [
  {
    id: 'correct',
    purpose: 'control',
    artifact: { answer: '42' },
    expectedMetrics: { quality: 1 },
  },
  {
    id: 'incorrect',
    purpose: 'control',
    artifact: { answer: 'not 42' },
    expectedMetrics: { quality: 0 },
  },
]
function controlled(evaluate, extra = {}) {
  assert.equal(
    typeof FunctionProviders.createControlEvaluation,
    'function',
    'Public existing-function control wrapper is missing',
  )
  return FunctionProviders.createControlEvaluation({
    evaluate,
    controls,
    discriminationMetric: 'quality',
    reservationCnyPerCase: 0.1,
    ...extra,
  })
}
test('control wrapper checks frozen labels and retains each fee without judging optimization benefit', async () => {
  let n = 0
  const c = controlled(async (args) => {
    n++
    return {
      ok: true,
      metrics: { quality: args.artifact.answer === '42' ? 1 : 0, sample_size: 1 },
      currency: 'CNY',
      costCny: 0.01,
      costEvidence: { currency: 'CNY', receiptPath: 'case-' + n },
    }
  })
  const r = await c.evaluate(request)
  assert.equal(n, 2)
  assert.equal(c.maxInvocations, 2)
  assert.equal(c.reservationCny, 0.2)
  assert.equal(r.metrics.control_match_rate, 1)
  assert.equal(r.metrics.controls_distinguish, true)
  assert.equal(r.costCny, 0.02)
  assert.equal(r.evidence[0].kind, 'evaluator_control_check')
  assert.equal(r.evidence[0].qualification, 'SUPPLIED_CONTROLS_ONLY')
  assert.equal(r.costEvidence.nestedReceipts.length, 2)
})
test('constant evaluator remains a failed discrimination check, not a revised acceptance rule', async () => {
  const c = controlled(async () => ({
      ok: true,
      metrics: { quality: 1, sample_size: 1 },
      currency: 'CNY',
      costCny: 0,
    })),
    r = await c.evaluate(request)
  assert.equal(r.ok, true)
  assert.equal(r.metrics.control_match_rate, 0.5)
  assert.equal(r.metrics.controls_distinguish, false)
  assert.equal(r.evidence[0].rows[1].matched, false)
})
test('unknown cost or reservation overrun stops remaining controls without hidden retries', async () => {
  for (const cost of [null, 0.2]) {
    let n = 0
    const c = controlled(
      async () => {
        n++
        return {
          ok: true,
          metrics: { quality: 1 },
          currency: 'CNY',
          costCny: n === 1 ? 0.01 : cost,
        }
      },
      { controls: [...controls, { ...controls[0], id: 'third' }] },
    )
    const r = await c.evaluate(request)
    assert.equal(n, 2)
    assert.equal(r.ok, false)
    assert.equal(r.costCny, cost === null ? null : 0.21)
    assert.equal(r.evidence[0].rows.length, 2)
  }
})
test('controls require different fixed expected outcomes and exclude final data before executing', () => {
  assert.equal(typeof FunctionProviders.createControlEvaluation, 'function')
  let n = 0
  const evaluate = async () => {
    n++
    return {}
  }
  assert.throws(() =>
    controlled(evaluate, { controls: [controls[0], { ...controls[0], id: 'same-label' }] }),
  )
  assert.throws(() =>
    controlled(evaluate, { controls: [controls[0], { ...controls[1], purpose: 'final' }] }),
  )
  assert.equal(n, 0)
})
test('controls are copied before callback work and cancellation prevents subsequent cases', async () => {
  const data = structuredClone(controls),
    abort = new AbortController()
  let n = 0
  const c = controlled(
    async (args) => {
      n++
      assert.equal(args.artifact.answer, '42')
      abort.abort()
      return { ok: true, metrics: { quality: 1 }, currency: 'CNY', costCny: 0 }
    },
    { controls: data },
  )
  data[0].artifact.answer = 'changed'
  data[0].expectedMetrics.quality = 0
  const r = await c.evaluate({ ...request, signal: abort.signal })
  assert.equal(n, 1)
  assert.equal(r.ok, false)
  assert.equal(r.costCny, 0)
  assert.equal(r.evidence[0].rows[0].matched, true)
  assert.equal(r.evidence[0].stopReason, 'ABORTED')
  assert.equal(r.metrics.controls_distinguish, false)
})
test('unknown-cost adapter response retains measured control progress for native settlement', async (t) => {
  const checked = controlled(async (args) => ({
    ok: true,
    metrics: { quality: args.artifact.answer === '42' ? 1 : 0 },
    currency: 'CNY',
    costCny: null,
  }))
  const d = {
    ...descriptors[0],
    metrics: ['control_match_rate', 'controls_distinguish', 'sample_size'],
  }
  const evaluator = await service(t, checked.evaluate, { descriptors: [d] })
  const r = await evaluator.evaluate(request)
  assert.equal(r.error.code, 'DUO_COST_UNKNOWN')
  assert.equal(r.costCny, null)
  assert.equal(r.costEvidence.controlProgress.rows[0].actualMetrics.quality, 1)
  assert.equal(r.costEvidence.controlProgress.stopReason, 'DUO_COST_UNKNOWN')
})
