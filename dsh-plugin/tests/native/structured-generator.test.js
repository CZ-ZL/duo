import test from 'node:test'
import assert from 'node:assert/strict'
import { compileProposal, decodeProposal } from '../../native/structured-generator.js'
const parent = { id: 'baseline', version: 'base', persona: 'You are {{model}} in {{cwd}}.' }
const args = {
  champion: parent,
  generation: 1,
  quotas: { exploit: 1, explore: 1, innovate: 1 },
  feedback: {
    historyCompleteness: 'all_latest_candidates',
    history: [
      {
        candidateId: 'baseline',
        fast: { tier: 'fast', ok: true, metrics: { quality: 0.5 } },
        final: { secret: 'PRIVATE_FINAL' },
      },
    ],
  },
  dataset: {
    fast: {
      tasks: [
        { id: 'a', input: 'FIRST', expected: { key: 'a' } },
        { id: 'b', input: 'SECOND', expected: { key: 'b' } },
        { id: 'c', input: 'THIRD_FAILED_TASK', expected: { key: 'c' } },
      ],
    },
    slow: { tasks: [{ input: 'PRIVATE_SLOW' }] },
    final: { tasks: [{ input: 'PRIVATE_FINAL' }] },
  },
}
const output = () => ({
  candidates: [
    { slot: 'exploit-1', hypothesis: 'local refinement', change: { suffix: 'Be precise.' } },
    {
      slot: 'explore-1',
      hypothesis: 'different structure',
      change: { persona: '{{model}} in {{cwd}} uses a different strategy.' },
    },
    {
      slot: 'innovate-1',
      hypothesis: 'compose two approaches',
      change: { components: ['First extract claims.', 'Then cross-check each claim.'] },
    },
  ],
})
test('operator slots are assigned structurally and all Fast examples reach the proposal', () => {
  const p = compileProposal(args)
  assert.deepEqual(
    p.slots.map((s) => s.mode),
    ['exploit', 'explore', 'innovate'],
  )
  assert.equal(new Set(p.slots.map((s) => s.operatorId)).size, 3)
  assert.match(JSON.stringify(p), /THIRD_FAILED_TASK/)
  assert.doesNotMatch(JSON.stringify(p), /PRIVATE_FINAL|PRIVATE_SLOW/)
  assert.equal(p.feedback.history.length, 1)
})
test('distinct operators append, replace and compose without trusting model mode labels', () => {
  const p = compileProposal(args)
  let seq = 0
  const c = decodeProposal(JSON.stringify(output()), p, parent, () => String(++seq))
  assert.equal(c.length, 3)
  assert.deepEqual(
    c.map((c) => c.mode),
    ['exploit', 'explore', 'innovate'],
  )
  assert.equal(c[0].delta.persona, parent.persona + '\nBe precise.')
  assert.equal(c[1].delta.persona, output().candidates[1].change.persona)
  assert.equal(
    c[2].delta.persona,
    parent.persona + '\nFirst extract claims.\nThen cross-check each claim.',
  )
  assert.ok(
    c.every((c) => c.parentVersion === 'base' && c.operatorId && c.hypothesisBeforeDelta === true),
  )
})
test('hypothesis must precede change and duplicate JSON keys are refused', () => {
  const p = compileProposal(args),
    wrong = output()
  wrong.candidates[0] = { slot: 'exploit-1', change: { suffix: 'x' }, hypothesis: 'after' }
  assert.throws(() => decodeProposal(JSON.stringify(wrong), p, parent, () => ''))
  const duplicate = JSON.stringify(output()).replace(
    '"hypothesis":"local refinement"',
    '"hypothesis":"before","hypothesis":"after"',
  )
  assert.throws(() => decodeProposal(duplicate, p, parent, () => ''))
})
test('missing slots, duplicate slots, self-assigned modes and dropped placeholders are rejected', () => {
  const p = compileProposal(args)
  for (const mutate of [
    (r) => r.candidates.pop(),
    (r) => (r.candidates[1].slot = 'exploit-1'),
    (r) => (r.candidates[0].mode = 'innovate'),
    (r) => (r.candidates[1].change.persona = 'no placeholders'),
  ]) {
    const r = output()
    mutate(r)
    assert.throws(() => decodeProposal(JSON.stringify(r), p, parent, () => ''))
  }
})
test('full ranked history is retained rather than truncated, while unqualified history is refused', () => {
  const request = structuredClone(args)
  request.feedback.history = Array.from({ length: 25 }, (_, i) => ({
    candidateId: 'c' + i,
    delta: { persona: 'candidate ' + i },
    fast: { tier: 'fast', ok: true, metrics: { quality: i } },
    slow: { tier: 'slow', ok: true, metrics: { quality: i }, evidence: 'PRIVATE_SLOW' },
    final: 'PRIVATE_FINAL',
  }))
  const p = compileProposal(request)
  assert.equal(p.feedback.history.length, 25)
  assert.doesNotMatch(JSON.stringify(p), /PRIVATE_SLOW|PRIVATE_FINAL/)
  assert.throws(() => compileProposal({ ...args, feedback: { evidence: 'insufficient_data' } }))
})
test('structured input includes recorded Slow constraint feedback while projecting out raw and final evidence', () => {
  const request = structuredClone(args)
  request.feedback.slowFeedback = {
    version: '1',
    availability: 'OBSERVED',
    constraints: [{ metric: 'safe', op: '==', value: true }],
    observations: [
      {
        candidateId: 'c',
        generation: 1,
        status: 'OBSERVED',
        slowVerdict: 'constraint_violation',
        slowDecision: 'incomparable',
        slow: {
          candidateId: 'c',
          tier: 'slow',
          evaluatorId: 'measured',
          version: '2',
          dataId: 'slow-data',
          ok: true,
          metrics: { quality: 1, safe: false },
          evidence: 'PRIVATE_SLOW',
        },
        final: 'PRIVATE_FINAL',
      },
    ],
    final: 'PRIVATE_FINAL',
  }
  const p = compileProposal(request)
  assert.equal(p.feedback.slowFeedback.observations[0].slowVerdict, 'constraint_violation')
  assert.equal(p.feedback.slowFeedback.observations[0].slow.metrics.safe, false)
  assert.doesNotMatch(JSON.stringify(p), /PRIVATE_SLOW|PRIVATE_FINAL/)
})

test('code proposals retain ranked failed deltas and measured failure details through compilation', () => {
  const request = structuredClone(args)
  request.dataset = {
    responseMode: 'python-code-v1',
    fast: { tasks: [{ id: 'a', input: 'Public Fast task' }] },
    slow: { tasks: [{ id: 's', input: 'Public Slow task' }] },
    final: { tasks: [{ id: 'z', input: 'FINAL_SECRET' }] },
  }
  request.feedback.history = [
    {
      candidateId: 'bad',
      generation: 1,
      hypothesis: 'A failed proposal',
      delta: { persona: 'Bad candidate' },
      fast: { tier: 'fast', ok: true, metrics: { task_pass_rate: 0 } },
    },
  ]
  request.feedback.developmentMeasurements = [
    {
      candidateId: 'bad',
      generation: 1,
      rowAvailability: 'PROVIDED',
      rows: [
        {
          taskId: 'a',
          taskPassed: false,
          passed: 0,
          planned: 1,
          receiptPath: 'PRIVATE_PATH',
          tests: [
            {
              name: 'contract',
              status: 'failed',
              error: 'WRONG_PUBLIC_RETURN',
              source: 'PRIVATE_TEST_SOURCE',
            },
          ],
        },
        { taskId: 'z', error: 'FINAL_SECRET' },
      ],
    },
  ]
  const before = structuredClone(request),
    proposal = compileProposal(request)
  assert.equal(proposal.feedback.history[0].delta.persona, 'Bad candidate')
  assert.ok(
    Array.isArray(proposal.feedback.developmentMeasurements),
    'Measured development failures must reach the model input',
  )
  assert.equal(
    proposal.feedback.developmentMeasurements[0].rows[0].tests[0].error,
    'WRONG_PUBLIC_RETURN',
  )
  assert.deepEqual(
    proposal.feedback.developmentTasks.map((t) => t.id),
    ['a', 's'],
  )
  assert.equal(proposal.feedback.developmentMeasurements[0].rows.length, 1)
  assert.ok(proposal.proposalExamples.length > 0)
  assert.match(proposal.instruction, /Python/)
  assert.doesNotMatch(JSON.stringify(proposal), /FINAL_SECRET|PRIVATE_PATH|PRIVATE_TEST_SOURCE/)
  assert.deepEqual(request, before)
})

test('explicit Slow ablation also applies to warm-start observations at the model boundary', () => {
  const request = structuredClone(args)
  const measured = (tier) => ({
    candidateId: 'old',
    evaluatorId: 'e-' + tier,
    version: '1',
    dataId: 'd-' + tier,
    tier,
    ok: true,
    metrics: { quality: tier === 'fast' ? 0.4 : 0.987654 },
  })
  request.feedback.warmStart = {
    kind: 'native_journal_search_history',
    version: '1',
    currentBaseline: { id: 'baseline', version: 'base' },
    records: [
      {
        source: {
          runId: 'old-run',
          candidateId: 'old',
          candidateVersion: 'old-version',
          parentId: 'baseline',
          parentVersion: 'base',
          generation: 1,
          evaluators: ['fast', 'slow'].map((tier) => ({
            tier,
            evaluatorId: 'e-' + tier,
            version: '1',
            dataId: 'd-' + tier,
          })),
        },
        use: 'comparable_declared',
        role: 'failure',
        reasons: [],
        evidenceKinds: ['model'],
        hypothesis: 'Retained idea',
        delta: { kind: 'cordis-overlay', target: 'system-prompt', persona: 'Retained persona' },
        observations: { fast: measured('fast'), slow: measured('slow') },
        verdicts: { fast: 'better', slow: 'not_better', slowDecision: 'rejected' },
      },
    ],
  }
  const full = compileProposal(request),
    removed = compileProposal({ ...request, explicitSlowFeedback: false })
  assert.equal(full.feedback.warmStart.records[0].observations.slow.metrics.quality, 0.987654)
  assert.equal(removed.feedback.warmStart.records[0].observations.slow, undefined)
  assert.deepEqual(
    removed.feedback.warmStart.records[0].observations.fast,
    full.feedback.warmStart.records[0].observations.fast,
  )
  assert.equal(removed.feedback.warmStart.records[0].verdicts.slowDecision, undefined)
  assert.equal(removed.feedback.warmStart.records[0].role, 'direction')
  assert.doesNotMatch(JSON.stringify(removed), /0\.987654/)
})

test('search-safe strategy decisions reach structured generation, with final/raw fields excluded and ablation preserved', () => {
  const request = structuredClone(args)
  request.feedback.evidenceDecisions = [
    {
      candidateId: 'c',
      generation: 1,
      action: 'hold',
      reason: 'EVIDENCE_COVERAGE_UNCONFIRMED',
      requestedTier: 'slow',
      requestedEvidenceType: 'expanded_evidence',
      judgments: [
        {
          tier: 'fast',
          verdict: 'better',
          source: { id: 'fast', version: '1', dataId: 'dev', raw: 'PRIVATE_RAW' },
        },
        { tier: 'final', verdict: 'better', source: { id: 'PRIVATE_FINAL' } },
      ],
      artifact: 'PRIVATE_ARTIFACT',
    },
  ]
  const full = compileProposal(request)
  assert.equal(full.feedback.evidenceDecisions?.[0].action, 'hold')
  assert.doesNotMatch(
    JSON.stringify(full.feedback.evidenceDecisions),
    /PRIVATE_RAW|PRIVATE_FINAL|PRIVATE_ARTIFACT/,
  )
  assert.equal(
    compileProposal({ ...request, explicitSlowFeedback: false }).feedback.evidenceDecisions,
    undefined,
  )
})
