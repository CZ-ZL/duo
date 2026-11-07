import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  analyzeRun,
  analyzeEvents,
  extractLetters,
  strictCompliant,
  mde,
} from '../../native/run-doctor.js'

function fixtureRun(t, { protocol, tiers, evals }) {
  const dir = mkdtempSync(join(tmpdir(), 'duo-doctor-'))
  t.after(() => {})
  if (protocol) writeFileSync(join(dir, 'PROTOCOL.json'), JSON.stringify(protocol))
  if (tiers) {
    mkdirSync(join(dir, 'data'), { recursive: true })
    writeFileSync(join(dir, 'data', 'tiers.json'), JSON.stringify(tiers))
  }
  for (const e of evals) {
    const armDir = join(dir, e.arm)
    mkdirSync(armDir, { recursive: true })
    writeFileSync(
      join(armDir, `duo-${e.session}.json`),
      JSON.stringify({ artifact: e.artifact, costCny: e.costCny ?? 0.001 }),
    )
    if (e.score) writeFileSync(join(armDir, `duo-${e.session}-score.json`), JSON.stringify(e.score))
  }
  return dir
}

const TIERS = {
  tiers: {
    A_fast: [
      { id: 'a-1', gold_letter: 'B' },
      { id: 'a-2', gold_letter: 'C' },
    ],
    C2_final: [{ id: 'c-1', gold_letter: 'A' }],
  },
}

test('lenient extraction accepts nested and flat shapes, rejects prose', () => {
  assert.deepEqual(extractLetters('{"a-1":{"answer":"B"},"a-2":{"answer":"C"}}'), {
    'a-1': 'B',
    'a-2': 'C',
  })
  assert.deepEqual(extractLetters('{"a-1":"B","a-2":"C"}'), { 'a-1': 'B', 'a-2': 'C' })
  assert.equal(extractLetters('The answers are {"a-1":"B"}'), null)
  assert.equal(extractLetters('["B"]'), null)
})

test('strict compliance enforces the frozen judge shape', () => {
  assert.equal(strictCompliant('{"a-1":{"answer":"B"},"a-2":{"answer":"C"}}', ['a-1', 'a-2']), true)
  assert.equal(strictCompliant('{"a-1":"B","a-2":"C"}', ['a-1', 'a-2']), false)
  assert.equal(strictCompliant('{"a-1":{"answer":"B"}}', ['a-1', 'a-2']), false)
  assert.equal(strictCompliant('{"a-1":{"answer":" b "}}', ['a-1']), false)
})

test('mde grows as n shrinks', () => {
  assert.ok(mde(0.8, 12) > mde(0.8, 400))
  assert.ok(mde(0.8, 12) > 0.4)
})

test('healthy run reports ok and no stop checks', async (t) => {
  const dir = fixtureRun(t, {
    protocol: {
      configRange: { baseline: 100000 },
      decisionRule: { beat: 'champion beats B0 iff championPassed >= B0Passed + 6' },
      datasets: { views: { final: { tasks: 12 } } },
    },
    tiers: TIERS,
    evals: [
      {
        arm: 'actual-B1',
        session: 's1',
        artifact: {
          tier: 'fast',
          candidateId: 'baseline',
          config: { maxBodyChars: 100000 },
          text: '{"a-1":{"answer":"B"},"a-2":{"answer":"C"}}',
        },
        score: {
          status: 'SCORED',
          rows: [
            { id: 'a-1', reason: 'EXACT' },
            { id: 'a-2', reason: 'EXACT' },
          ],
        },
      },
      {
        arm: 'actual-B1',
        session: 's2',
        artifact: {
          tier: 'fast',
          candidateId: 'dl-1',
          config: { maxBodyChars: 20000 },
          text: '{"a-1":{"answer":"B"},"a-2":{"answer":"C"}}',
        },
        score: {
          status: 'SCORED',
          rows: [
            { id: 'a-1', reason: 'EXACT' },
            { id: 'a-2', reason: 'EXACT' },
          ],
        },
      },
    ],
  })
  const report = await analyzeRun(dir)
  assert.equal(report.overall, 'ok')
  assert.ok(!report.checks.some((c) => c.severity === 'stop'))
})

test('v1-style instrument zeros are caught at stop severity', async (t) => {
  const shapeRows = [
    { id: 'a-1', reason: 'ROW_NOT_OBJECT' },
    { id: 'a-2', reason: 'ROW_NOT_OBJECT' },
  ]
  const dir = fixtureRun(t, {
    protocol: { configRange: { baseline: 100000 } },
    tiers: TIERS,
    evals: [
      {
        arm: 'actual-B1',
        session: 's1',
        artifact: {
          tier: 'fast',
          candidateId: 'baseline',
          config: { maxBodyChars: 100000 },
          text: '{"a-1":"B","a-2":"C"}',
        },
        score: { status: 'SCORED', rows: shapeRows },
      },
      {
        arm: 'actual-B1',
        session: 's2',
        artifact: {
          tier: 'fast',
          candidateId: 'dl-1',
          config: { maxBodyChars: 20000 },
          text: '{"a-1":"B","a-2":"C"}',
        },
        score: { status: 'SCORED', rows: shapeRows },
      },
    ],
  })
  const report = await analyzeRun(dir)
  assert.equal(report.overall, 'stop')
  const ids = report.checks.filter((c) => c.severity === 'stop').map((c) => c.id)
  assert.ok(ids.includes('C1_INSTRUMENT_SUSPECT'))
  assert.ok(ids.includes('C2_FORMAT_DRIFT'))
})

test('flat dose-response is flagged as landscape-flat', async (t) => {
  const evals = [5000, 20000, 50000, 100000, 200000, 120000].map((dose, i) => ({
    arm: 'actual-B1',
    session: 's' + i,
    artifact: {
      tier: 'fast',
      candidateId: 'dl-' + i,
      config: { maxBodyChars: dose },
      text: '{"a-1":{"answer":"B"},"a-2":{"answer":"C"}}',
    },
    score: {
      status: 'SCORED',
      rows: [
        { id: 'a-1', reason: 'EXACT' },
        { id: 'a-2', reason: 'EXACT' },
      ],
    },
  }))
  const dir = fixtureRun(t, { tiers: TIERS, evals })
  const report = await analyzeRun(dir)
  assert.ok(report.checks.some((c) => c.id === 'C3_LANDSCAPE_FLAT_SUSPECTED'))
})

test('underpowered pre-registered beat margin warns with a concrete n target', async (t) => {
  const dir = fixtureRun(t, {
    protocol: {
      decisionRule: { beat: 'champion beats B0 iff championPassed >= B0Passed + 2' },
      datasets: { views: { final: { tasks: 12 } } },
    },
    tiers: TIERS,
    evals: [
      {
        arm: 'actual-F0-B0-baseline',
        session: 's1',
        artifact: {
          tier: 'final',
          candidateId: 'baseline',
          config: { maxBodyChars: 100000 },
          text: '{"c-1":{"answer":"A"}}',
        },
        score: { status: 'SCORED', rows: [{ id: 'c-1', reason: 'EXACT' }] },
      },
    ],
  })
  const report = await analyzeRun(dir)
  const c5 = report.checks.find((c) => c.id === 'C5_DECISION_RULE_UNDERPOWERED')
  assert.ok(c5)
  assert.equal(c5.severity, 'warn')
  assert.ok(c5.action.includes('n>='))
})

test('cost outlier beyond 5x same-tier median is flagged', async (t) => {
  const mk = (i, cost) => ({
    arm: 'actual-B1',
    session: 's' + i,
    costCny: cost,
    artifact: {
      tier: 'fast',
      candidateId: 'dl-' + i,
      config: { maxBodyChars: 50000 + i },
      text: '{"a-1":{"answer":"B"},"a-2":{"answer":"C"}}',
    },
    score: {
      status: 'SCORED',
      rows: [
        { id: 'a-1', reason: 'EXACT' },
        { id: 'a-2', reason: 'EXACT' },
      ],
    },
  })
  const dir = fixtureRun(t, {
    tiers: TIERS,
    evals: [mk(1, 0.001), mk(2, 0.0012), mk(3, 0.0009), mk(4, 0.02)],
  })
  const report = await analyzeRun(dir)
  assert.ok(report.checks.some((c) => c.id === 'C6_COST_OUTLIER'))
})

test('repaired runs: original drift is read from firstScoreHistogram, not the repaired text', async (t) => {
  const dir = fixtureRun(t, {
    tiers: TIERS,
    evals: [
      {
        arm: 'actual-F0-B0-baseline',
        session: 's1',
        artifact: {
          tier: 'final',
          candidateId: 'baseline',
          config: { maxBodyChars: 100000 },
          repaired: true,
          text: '{"a-1":{"answer":"B"},"a-2":{"answer":"C"}}',
          repairText: '{"a-1":{"answer":"B"},"a-2":{"answer":"C"}}',
          firstScoreHistogram: {
            status: 'SCORED',
            passed: 0,
            total: 2,
            reasons: { ROW_NOT_OBJECT: 2 },
          },
        },
        score: {
          status: 'SCORED',
          rows: [
            { id: 'a-1', reason: 'EXACT' },
            { id: 'a-2', reason: 'EXACT' },
          ],
        },
      },
    ],
  })
  const report = await analyzeRun(dir)
  const c2 = report.checks.find((c) => c.id === 'C2_FORMAT_DRIFT')
  assert.ok(c2, 'C2 must fire on original-text drift even when artifact.text is post-repair')
  assert.equal(report.shapeRate, 1)
})

test('journal-driven analysis names tied candidates as arbitrary selection', () => {
  const candidate = (id) => ({
    kind: 'candidate',
    candidateId: id,
    candidate: { id, config: { maxBodyChars: 50000 } },
    fast: { metrics: { quality: 0.5 }, evidence: [] },
  })
  const report = analyzeEvents(
    [
      { kind: 'plan', plan: { baseline: { id: 'baseline' } } },
      {
        kind: 'candidate',
        candidateId: 'baseline',
        candidate: { id: 'baseline' },
        fast: { metrics: { quality: 0.5 }, evidence: [] },
      },
      candidate('dl-0001'),
      candidate('dl-0002'),
      candidate('dl-0003'),
    ],
    {},
  )
  assert.ok(report.checks.some((c) => c.id === 'J5_TIED_CANDIDATES'))
  assert.equal(report.overall, 'ok', 'info-only findings leave the binding verdict ok')
})

test('monotonic dose response is not reported as flat', () => {
  for (const qualities of [
    [0.5, 0.52, 0.54, 0.56, 0.58],
    [0.5, 0.5, 0.54, 0.54, 0.58],
  ]) {
    const events = qualities.map((quality, i) => ({
      kind: 'candidate',
      candidateId: 'c' + i,
      candidate: { config: { maxBodyChars: 5000 + i * 40000 } },
      fast: { metrics: { quality }, evidence: [] },
    }))
    assert.ok(!analyzeEvents(events).checks.some((c) => c.id === 'J3_LANDSCAPE_FLAT_SUSPECTED'))
  }
})

test('constant responses are flat only when the dose actually varies', () => {
  const events = Array.from({ length: 6 }, (_, i) => ({
    kind: 'candidate',
    candidateId: 'c' + i,
    candidate: { config: { maxBodyChars: 5000 + i * 30000 } },
    fast: { metrics: { quality: 0.5 }, evidence: [] },
  }))
  const flat = analyzeEvents(events).checks.find((c) => c.id === 'J3_LANDSCAPE_FLAT_SUSPECTED')
  assert.ok(flat)
  assert.equal(flat.evidence.rho, null, 'correlation of a constant response is undefined')
  for (const e of events) e.candidate.config.maxBodyChars = 50000
  assert.ok(!analyzeEvents(events).checks.some((c) => c.id === 'J3_LANDSCAPE_FLAT_SUSPECTED'))
})

test('diagnostic shadow and unfamiliar evidence cannot create primary parse failures', () => {
  for (const status of ['measured', 'invalid_output']) {
    const report = analyzeEvents([
      { kind: 'plan', plan: { baseline: { id: 'baseline' } } },
      {
        kind: 'candidate',
        candidateId: 'baseline',
        fast: {
          metrics: { task_accuracy: 1 },
          evidence: [
            { kind: 'runbook-task-checks', rows: [{ answerCorrect: true, citationCorrect: true }] },
            {
              kind: 'quick_support_shadow',
              status,
              affectsSelection: false,
              purpose: 'diagnostic_only',
            },
            { kind: 'other-observation', status: 'completed' },
          ],
        },
      },
    ])
    assert.equal(report.overall, 'ok')
    assert.ok(
      !report.checks.some((c) => ['J1_INSTRUMENT_SUSPECT', 'J2_FORMAT_DRIFT'].includes(c.id)),
    )
  }
})
