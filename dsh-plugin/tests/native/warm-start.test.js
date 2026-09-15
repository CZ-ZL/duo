import test from 'node:test'
import assert from 'node:assert/strict'
import { digest } from '../../native/store.js'
import {
  selectWarmStart as select,
  normalizeWarmStart,
  executionEnvironment,
  projectWarmContext as project,
} from '../../native/warm-start.js'
import { personaHistory, projectPersonaDelta } from '../../native/target.js'
const selectWarmStart = (journal, current, config, selector) =>
  select(journal, current, config, selector, personaHistory)
const projectWarmContext = (value) => project(value, projectPersonaDelta)

// Declared-model classifications below are synthetic unit data, not live proof.
const obj = (tier) => ({
  evaluatorId: tier,
  version: '1',
  dataId: tier,
  metric: 'quality',
  direction: 'maximize',
  weights: { quality: 1 },
})
function plan() {
  return {
    apiVersion: 2,
    runtime: 'dsh-native',
    environment: executionEnvironment(),
    spec: {
      target: { kind: 'dsh-persona', path: '/authorized/persona' },
      fast: obj('fast'),
      slow: obj('slow'),
      final: obj('final'),
      constraints: [],
      epsilon: 0.01,
      minSamples: 1,
    },
    baseline: {
      id: 'baseline',
      path: '/authorized/persona',
      persona: 'base',
      version: digest('base'),
    },
    providers: {
      generator: { id: 'g', version: '1', evidenceKind: 'model', configDigest: 'g' },
      executor: { id: 'x', version: '1', evidenceKind: 'model', configDigest: 'x' },
      evaluators: ['fast', 'slow', 'final'].map((tier) => ({
        id: tier,
        version: '1',
        tier,
        dataId: tier,
        evidenceKind: 'model',
        configDigest: tier,
      })),
      policies: { duoTarget: { id: 'persona', version: '1' } },
    },
  }
}
function history(p = plan()) {
  const b = p.baseline,
    candidate = (id, text) => ({
      id,
      parentId: 'baseline',
      parentVersion: b.version,
      version: digest(text),
      persona: text,
      mode: 'explore',
      family: 'different_hypothesis',
      hypothesis: 'test ' + id,
      delta: { kind: 'cordis-overlay', target: 'system-prompt', persona: text },
    })
  const evidence = (id, tier, quality) => ({
    candidateId: id,
    evaluatorId: tier,
    version: '1',
    dataId: tier,
    tier,
    ok: true,
    metrics: { quality, sample_size: 1 },
    evidence: ['RAW_SEARCH_SECRET'],
  })
  return [
    { kind: 'plan', plan: p },
    {
      kind: 'candidate',
      candidateId: 'baseline',
      candidate: b,
      fast: evidence('baseline', 'fast', 0.5),
      slow: evidence('baseline', 'slow', 0.5),
    },
    ...['good', 'failed', 'other'].map((id, i) => ({
      kind: 'candidate',
      candidateId: id,
      candidate: candidate(id, 'base ' + id),
      generation: 1,
      status: 'slow_evaluated',
      fast: evidence(id, 'fast', 0.8),
      slow: evidence(id, 'slow', i === 0 ? 0.8 : 0.2),
      fastVerdict: 'better',
      slowVerdict: i === 0 ? 'better' : 'not_better',
      slowDecision: i === 0 ? 'accepted' : 'rejected',
    })),
    { kind: 'final', results: [{ metrics: { quality: 99 }, evidence: ['FINAL_SECRET'] }] },
    {
      kind: 'candidate',
      candidateId: 'leaked',
      candidate: candidate('leaked', 'FINAL_LEAKED_DELTA'),
      fast: evidence('leaked', 'fast', 100),
    },
  ]
}
const journal = (sources, terminal = true) => ({
  open(id, options) {
    assert.equal(options.create, false)
    if (!sources[id]) return null
    return {
      get(key) {
        assert.equal(key, 'run')
        return { status: terminal ? 'completed' : 'running' }
      },
      events(limits) {
        assert.ok(limits.maxEvents && limits.maxBytes)
        return structuredClone(sources[id])
      },
    }
  },
})
test('warm-start references are bounded, unique and canonical; empty history is a normal cold start', () => {
  assert.deepEqual(normalizeWarmStart({ runIds: ['b', 'a', 'b'] }), {
    runIds: ['a', 'b'],
    maxRecords: 6,
    maxContextBytes: 8192,
    fixturePolicy: 'exclude',
  })
  for (const x of [
    { runIds: ['../outside'] },
    { runIds: Array.from({ length: 9 }, (_, i) => 'r' + i) },
    { runIds: [], maxRecords: 0 },
    { runIds: [], maxContextBytes: 100 },
    { runIds: [], fixturePolicy: 'trust' },
    { runIds: [], extra: true },
  ])
    assert.throws(() => normalizeWarmStart(x), { code: 'DUO_CONTRACT_INVALID' })
  const r = selectWarmStart(journal({}), plan(), normalizeWarmStart({ runIds: [] }))
  assert.equal(r.mode, 'cold_start')
  assert.deepEqual(r.context.records, [])
  assert.equal(r.contextDigest, digest(r.context))
})
test('a changed native implementation keeps historical ideas without reusing old scores', () => {
  const source = plan(),
    current = plan()
  source.recovery = { implementationDigest: 'earlier-build' }
  current.recovery = { implementationDigest: 'current-build' }
  const r = selectWarmStart(
    journal({ source: history(source) }),
    current,
    normalizeWarmStart({ runIds: ['source'] }),
  )
  assert.ok(r.context.records.length > 0)
  assert.ok(r.context.records.every((x) => x.use === 'ideas_only' && x.observations === undefined))
  assert.ok(r.sources[0].reasons.includes('native_implementation_changed'))
})
test('replaceable history order receives screened records but cannot rewrite them or evade limits', () => {
  const p = plan(),
    events = history(p),
    cfg = normalizeWarmStart({ runIds: ['source'], maxRecords: 1 })
  let received
  const r = selectWarmStart(journal({ source: events }), p, cfg, {
    describe() {
      return { id: 'failures-first-test', version: '1', deterministic: true }
    },
    orderHistory(records) {
      received = structuredClone(records)
      const i = records.findIndex((r) => r.role === 'failure')
      records[i].hypothesis = 'FORGED_FINAL_TEXT'
      return [i]
    },
  })
  assert.ok(received.every((r) => !JSON.stringify(r).includes('FINAL_SECRET')))
  assert.equal(r.context.records.length, 1)
  assert.equal(r.context.records[0].role, 'failure')
  assert.ok(!JSON.stringify(r.context).includes('FORGED_FINAL_TEXT'))
  assert.equal(r.selector.id, 'failures-first-test')
  assert.ok(r.sources[0].omitted.some((r) => r.reason === 'selector_excluded'))
  for (const order of [[999], [-1], [0, 0], ['0'], null])
    assert.throws(
      () =>
        selectWarmStart(journal({ source: events }), p, cfg, {
          describe() {
            return { id: 'invalid', version: '1', deterministic: true }
          },
          orderHistory() {
            return order
          },
        }),
      { code: 'DUO_HISTORY_SELECTION_INVALID' },
    )
})
test('warm-start projects comparable declared search evidence, representative failures and versions, never final or raw outputs', () => {
  const p = plan(),
    events = history(p),
    r = selectWarmStart(
      journal({ source: events }),
      p,
      normalizeWarmStart({ runIds: ['source'], maxRecords: 3 }),
    )
  assert.equal(r.mode, 'warm_start')
  assert.equal(r.context.records.length, 3)
  assert.deepEqual(
    r.context.records.map((x) => x.role),
    ['baseline', 'good', 'failure'],
  )
  assert.ok(r.context.records.every((x) => x.use === 'comparable_declared'))
  assert.equal(r.context.records[1].source.parentVersion, p.baseline.version)
  assert.equal(r.context.records[1].observations.slow.metrics.quality, 0.8)
  assert.ok(!JSON.stringify(r.context).includes('SECRET'))
  assert.ok(!JSON.stringify(r.context).includes('FINAL_LEAKED_DELTA'))
  assert.equal(r.finalDataReview.independence, 'NOT_ESTABLISHED')
  assert.equal(r.finalDataReview.reusedDeclaredDataId, true)
  const changed = structuredClone(events)
  changed.at(-2).results[0].metrics.quality = -99
  assert.equal(
    selectWarmStart(
      journal({ source: changed }),
      p,
      normalizeWarmStart({ runIds: ['source'], maxRecords: 3 }),
    ).contextDigest,
    r.contextDigest,
  )
})
test('changed objectives, baseline, provider versions and unknown environment retain ideas without measured-score reuse', () => {
  for (const change of [
    (p) => (p.spec.fast.version = '2'),
    (p) => {
      p.baseline.persona = 'changed'
      p.baseline.version = digest('changed')
    },
    (p) => (p.providers.executor.version = '2'),
    (p) => delete p.environment,
  ]) {
    const current = plan(),
      source = plan()
    change(source)
    const r = selectWarmStart(
      journal({ source: history(source) }),
      current,
      normalizeWarmStart({ runIds: ['source'] }),
    )
    assert.ok(r.context.records.length > 0)
    assert.ok(
      r.context.records.every((x) => x.use === 'ideas_only' && x.observations === undefined),
    )
    assert.ok(r.sources[0].reasons.length)
  }
})
test('incompatible targets, malformed lineage, active or missing histories are excluded without blocking other sources', () => {
  const wrong = plan()
  wrong.spec.target.path = '/another/persona'
  wrong.baseline.path = '/another/persona'
  const broken = history()
  broken[2].candidate.parentVersion = 'forged'
  let r = selectWarmStart(
    journal({ wrong: history(wrong), broken }),
    plan(),
    normalizeWarmStart({ runIds: ['missing', 'wrong', 'broken'] }),
  )
  assert.equal(r.sources.find((s) => s.runId === 'missing').status, 'excluded')
  assert.equal(r.sources.find((s) => s.runId === 'wrong').status, 'excluded')
  assert.ok(!r.context.records.some((x) => x.source.candidateId === 'good'))
  r = selectWarmStart(
    journal({ active: history() }, false),
    plan(),
    normalizeWarmStart({ runIds: ['active'] }),
  )
  assert.equal(r.mode, 'cold_start')
  assert.ok(r.sources[0].reasons.includes('source_not_terminal'))
})
test('fixtures require explicit ideas-only opt-in and never enter historical score ranking', () => {
  const source = plan()
  source.providers.executor.evidenceKind = 'fixture'
  const j = journal({ source: history(source) }),
    cfg = { runIds: ['source'] }
  assert.equal(selectWarmStart(j, plan(), normalizeWarmStart(cfg)).mode, 'cold_start')
  const r = selectWarmStart(j, plan(), normalizeWarmStart({ ...cfg, fixturePolicy: 'ideas_only' }))
  assert.ok(r.context.records.length > 0)
  assert.ok(r.context.records.every((x) => x.use === 'ideas_only' && !x.observations))
  assert.ok(r.context.records.every((x) => x.reasons.includes('fixture_or_control')))
})
test('context byte caps, duplicate references and source failures are explicit and do not import costs or authority', () => {
  const p = plan(),
    events = history(p)
  events[2].candidate.hypothesis = 'oversized '.repeat(4000)
  const r = selectWarmStart(
    journal({ source: events }),
    p,
    normalizeWarmStart({ runIds: ['source', 'source'], maxContextBytes: 2048 }),
  )
  assert.equal(r.sources.length, 1)
  assert.ok(Buffer.byteLength(JSON.stringify(r.context)) <= 2048)
  assert.ok(r.sources[0].omitted.some((x) => x.reason === 'context_byte_limit'))
  assert.equal(r.context.budget, undefined)
  assert.equal(r.context.permissions, undefined)
  const failure = selectWarmStart(
    {
      open() {
        throw Object.assign(new Error('/private/secret'), { code: 'DUO_HISTORY_LIMIT' })
      },
    },
    p,
    normalizeWarmStart({ runIds: ['huge'] }),
  )
  assert.equal(failure.sources[0].reasons[0], 'DUO_HISTORY_LIMIT')
  assert.ok(!JSON.stringify(failure).includes('/private/secret'))
})
test('unknown provider configuration and invalid measurement identity never become comparable evidence', () => {
  const p = plan(),
    source = plan()
  delete source.providers.executor.configDigest
  // Both declarations missing a config hash still do not prove compatibility.
  delete p.providers.executor.configDigest
  let r = selectWarmStart(
    journal({ source: history(source) }),
    p,
    normalizeWarmStart({ runIds: ['source'] }),
  )
  assert.ok(r.context.records.every((x) => x.use === 'ideas_only'))
  assert.ok(r.sources[0].reasons.includes('provider_configuration_unknown'))
  const rows = history()
  rows[2].slow.tier = 'final'
  r = selectWarmStart(journal({ source: rows }), plan(), normalizeWarmStart({ runIds: ['source'] }))
  const invalid = r.context.records.find((x) => x.source.candidateId === 'good')
  assert.equal(invalid.use, 'ideas_only')
  assert.equal(invalid.observations, undefined)
})
test('a forged baseline row is excluded and final-phase terminal failure does not erase earlier search observations', () => {
  const p = plan(),
    rows = history(p)
  rows[1].candidate = { ...p.baseline, version: 'forged' }
  let r = selectWarmStart(journal({ source: rows }), p, normalizeWarmStart({ runIds: ['source'] }))
  assert.ok(!r.context.records.some((x) => x.source.candidateId === 'baseline'))
  const j = journal({ source: history(p) }),
    open = j.open.bind(j)
  j.open = (...args) => {
    const h = open(...args)
    h.get = () => ({ status: 'failed' })
    return h
  }
  r = selectWarmStart(j, p, normalizeWarmStart({ runIds: ['source'] }))
  assert.ok(r.context.records.some((x) => x.source.candidateId === 'good'))
})
test('model projection preserves the selected digest and refuses nested metadata masquerading as search text', () => {
  const p = plan(),
    context = selectWarmStart(
      journal({ source: history(p) }),
      p,
      normalizeWarmStart({ runIds: ['source'] }),
    ).context
  assert.equal(digest(projectWarmContext(context)), digest(context))
  for (const corrupt of [
    (r) => (r.reasons = [{ final: 'PRIVATE_FINAL' }]),
    (r) => (r.evidenceKinds = [{ final: 'PRIVATE_FINAL' }]),
    (r) => (r.source.runId = { final: 'PRIVATE_FINAL' }),
    (r) => (r.source.evaluators[0].version = { final: 'PRIVATE_FINAL' }),
    (r) => (r.verdicts.slow = { final: 'PRIVATE_FINAL' }),
  ]) {
    const bad = structuredClone(context)
    corrupt(bad.records[0])
    assert.throws(() => projectWarmContext(bad), { code: 'DUO_HISTORY_INVALID' })
  }
})
test('different evidence modes cannot reuse historical scores even when measurement identities are unchanged', () => {
  const source = plan(),
    current = plan()
  source.evidenceStrategy = {
    optimization_mode: 'dual_loop',
    slow_mode: 'expanded_evidence',
    activeTiers: ['fast', 'slow'],
  }
  current.evidenceStrategy = {
    optimization_mode: 'single_fidelity',
    slow_mode: 'unavailable',
    activeTiers: ['fast', 'slow'],
  }
  const r = selectWarmStart(
    journal({ source: history(source) }),
    current,
    normalizeWarmStart({ runIds: ['source'] }),
  )
  assert.ok(r.sources[0].reasons.includes('evidence_mode_changed_or_unknown'))
  assert.ok(r.context.records.every((x) => x.use === 'ideas_only' && !x.observations))
})
