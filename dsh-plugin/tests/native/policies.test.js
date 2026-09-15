import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { WeightedComparator, TopKGate, ConservativeFeedback } from '../../native/policies.js'
import { ComparatorService } from '../../native/definitions.js'

const spec = {
  weights: { quality: 1 },
  epsilon: 0.01,
  minSamples: 2,
  constraints: [{ metric: 'safe', op: '==', value: true }],
}
const result = (id, quality, extra = {}) => ({
  candidateId: id,
  evaluatorId: 'quality',
  version: '1',
  dataId: 'dev',
  tier: 'fast',
  ok: true,
  metrics: { quality, safe: true, sample_size: 2 },
  ...extra,
})
async function service(t, Provider) {
  const ctx = new Context()
  const fiber = await ctx.plugin(Provider)
  t.after(() => fiber.dispose())
  return ctx
}

test('native comparison rejects invalid evidence and ranks the best valid candidate', async (t) => {
  const ctx = await service(t, WeightedComparator)
  const r = ctx.duoComparator.compare(
    [
      result('base', 1),
      result('best', 3),
      result('low', 2),
      result('unsafe', 20, { metrics: { quality: 20, safe: false, sample_size: 2 } }),
    ],
    spec,
    'base',
  )
  assert.deepEqual(r.ranking, ['best', 'low', 'base'])
  assert.equal(r.verdicts.unsafe, 'constraint_violation')
})
for (const [name, change] of Object.entries({
  failed: { ok: false },
  missing: { metrics: { safe: true } },
  nonfinite: { metrics: { quality: NaN, safe: true } },
  version: { version: '2' },
  dataset: { dataId: 'other' },
  tier: { tier: 'slow' },
  boolean: { metrics: { quality: true, safe: true } },
  sample: { metrics: { quality: 100, safe: true, sample_size: 1 } },
})) {
  test(`native comparison excludes ${name} evidence`, async (t) => {
    const ctx = await service(t, WeightedComparator)
    const r = ctx.duoComparator.compare(
      [result('base', 1), result('bad', 100, change)],
      spec,
      'base',
    )
    assert.equal(r.verdicts.bad, 'incomparable')
  })
}
test('invalid incumbent cannot justify promotion', async (t) => {
  const ctx = await service(t, WeightedComparator)
  const r = ctx.duoComparator.compare(
    [result('base', 1, { ok: false }), result('best', 5)],
    spec,
    'base',
  )
  assert.equal(r.verdicts.best, 'incomparable')
})
test('gate selects by comparator order within remaining budget', async (t) => {
  const ctx = await service(t, TopKGate)
  assert.deepEqual(
    ctx.duoGate.select(
      { ranking: ['best', 'low'], verdicts: { best: 'better', low: 'better' } },
      ['low', 'best'],
      { topK: 2, remaining: 1 },
    ),
    ['best'],
  )
})
test('feedback penalizes two slow failures only and bounds quota shifts', async (t) => {
  const ctx = await service(t, ConservativeFeedback)
  const events = [
    {
      candidateId: 'a',
      family: 'trap',
      mode: 'exploit',
      slow: { ok: true, metrics: { quality: 0 } },
      slowDecision: 'rejected',
    },
    {
      candidateId: 'b',
      family: 'trap',
      mode: 'exploit',
      slow: { ok: true, metrics: { quality: 0 } },
      slowDecision: 'rejected',
    },
    {
      candidateId: 'c',
      family: 'once',
      mode: 'innovate',
      slow: { ok: true, metrics: { quality: 0 } },
      slowDecision: 'rejected',
    },
  ]
  const r = ctx.duoFeedback.summarize(
    events,
    { exploit: 3, explore: 1, innovate: 1 },
    { failureThreshold: 2, maxShift: 1 },
  )
  assert.deepEqual(r.penalizedFamilies, ['trap'])
  assert.deepEqual(r.quotas, { exploit: 2, explore: 2, innovate: 1 })
})
test('Cordis consumer unloads and binds a replacement comparator provider', async (t) => {
  const ctx = new Context()
  let loads = 0,
    disposals = 0
  const consumer = ctx.plugin({
    inject: ['duoComparator'],
    apply(c) {
      loads++
      c.effect(() => () => {
        disposals++
      })
    },
  })
  const first = await ctx.plugin(WeightedComparator)
  await consumer
  assert.equal(loads, 1)
  await first.dispose()
  assert.equal(disposals, 1)
  assert.equal(ctx.get('duoComparator'), undefined)
  class Reverse extends ComparatorService {
    compare() {
      return 'replacement'
    }
  }
  const second = await ctx.plugin(Reverse)
  await consumer
  assert.equal(ctx.duoComparator.compare(), 'replacement')
  assert.equal(loads, 2)
  t.after(async () => {
    await consumer.dispose()
    await second.dispose()
  })
})
test('caller identifiers are ordinary data including JavaScript prototype names', async (t) => {
  const ctx = await service(t, WeightedComparator)
  const r = ctx.duoComparator.compare(
    [result('base', 1), result('__proto__', 3), result('constructor', 2)],
    spec,
    'base',
  )
  assert.deepEqual(r.ranking, ['__proto__', 'constructor', 'base'])
})
test('feedback uses the dominant family mode and supports any family name', async (t) => {
  const ctx = await service(t, ConservativeFeedback)
  const entries = ['exploit', 'explore', 'explore'].map((mode, i) => ({
    candidateId: String(i),
    family: 'constructor',
    mode,
    slow: { ok: true, metrics: { quality: 0 } },
    slowDecision: 'rejected',
  }))
  const r = ctx.duoFeedback.summarize(entries, { exploit: 1, explore: 2, innovate: 0 })
  assert.deepEqual(r.penalizedFamilies, ['constructor'])
  assert.deepEqual(r.quotas, { exploit: 2, explore: 1, innovate: 0 })
})
test('fast-only records cannot establish slow evidence', async (t) => {
  const ctx = await service(t, ConservativeFeedback)
  const r = ctx.duoFeedback.summarize(
    [
      { candidateId: 'a', family: 'x', mode: 'exploit', fast: result('a', 1) },
      { candidateId: 'b', family: 'y', mode: 'explore', fast: result('b', 2) },
    ],
    { exploit: 1, explore: 1, innovate: 0 },
  )
  assert.equal(r.evidence, 'insufficient_data')
})
test('feedback retains family averages, paired correlation, lineage and proxy traps', async (t) => {
  const ctx = await service(t, ConservativeFeedback)
  const entries = [1, 2, 3, 4].map((i) => ({
    candidateId: String(i),
    family: 'trap',
    mode: 'exploit',
    fast: result(String(i), i),
    slow: result(String(i), 5 - i, { tier: 'slow' }),
    slowDecision: 'rejected',
    status: i === 1 ? 'champion' : 'rejected',
    ts: i,
  }))
  const r = ctx.duoFeedback.summarize(
    entries,
    { exploit: 2, explore: 1, innovate: 0 },
    {
      failureThreshold: 2,
      maxShift: 1,
      minSamples: 4,
      fastMetrics: ['quality'],
      upperMetric: 'quality',
    },
  )
  assert.equal(r.families.trap.fastAvg, 2.5)
  assert.equal(r.families.trap.slowAvg, 2.5)
  assert.equal(r.fastSlowCorrelation.quality, -1)
  assert.deepEqual(r.championLineage, ['1'])
  assert.equal(r.failedRegions.length, 1)
})
test('default feedback retains scoped Slow facts, constraint verdicts and absent evaluations without private answers', async (t) => {
  const ctx = await service(t, ConservativeFeedback)
  const entries = [
    {
      candidateId: 'bad',
      generation: 1,
      family: 'x',
      mode: 'exploit',
      slow: result('bad', 0.8, {
        tier: 'slow',
        metrics: { quality: 0.8, safe: false, sample_size: 2 },
        evidence: ['PRIVATE_SLOW'],
      }),
      slowVerdict: 'constraint_violation',
      slowDecision: 'incomparable',
      final: { answer: 'PRIVATE_FINAL' },
    },
    { candidateId: 'not-promoted', generation: 1, family: 'x', mode: 'exploit', slow: null },
  ]
  const r = ctx.duoFeedback.summarize(
    entries,
    { exploit: 1, explore: 1, innovate: 0 },
    { constraints: spec.constraints },
  )
  assert.equal(r.slowFeedback.availability, 'OBSERVED')
  assert.deepEqual(r.slowFeedback.constraints, spec.constraints)
  const row = r.slowFeedback.observations[0]
  assert.equal(row.slowVerdict, 'constraint_violation')
  assert.equal(row.slow.metrics.safe, false)
  assert.equal(row.slow.evaluatorId, 'quality')
  assert.equal(row.slow.dataId, 'dev')
  assert.equal(row.generation, 1)
  assert.equal(r.slowFeedback.observations[1].status, 'NOT_EVALUATED')
  assert.deepEqual(r.penalizedFamilies, [])
  assert.doesNotMatch(JSON.stringify(r.slowFeedback), /PRIVATE_SLOW|PRIVATE_FINAL/)
  assert.equal(
    ctx.duoFeedback.summarize(entries.slice(1), { exploit: 1, explore: 0, innovate: 0 })
      .slowFeedback.availability,
    'NOT_EVALUATED',
  )
})
