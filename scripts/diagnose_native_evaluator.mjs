#!/usr/bin/env node
// Offline replay only: imports the unchanged v1 judge, never starts a model agent.
import assert from 'node:assert/strict'
import {readFileSync, readdirSync, writeFileSync} from 'node:fs'
import {resolve, join} from 'node:path'
import {createHash} from 'node:crypto'
import {judgeDocsAnswer} from '../dsh-plugin/native/docs-evaluators.js'
import {digest} from '../dsh-plugin/native/store.js'

const [comparisonArg, controlsArg, outputArg] = process.argv.slice(2)
if (!outputArg) throw new Error('Usage: diagnose_native_evaluator.mjs COMPARISON_DIR FROZEN_CONTROLS OUTPUT_JSON')
const comparison = resolve(comparisonArg), controlsPath = resolve(controlsArg)
const hashes = {}, sha = text => createHash('sha256').update(text).digest('hex')
function read(path) {
  const bytes = readFileSync(path); hashes[path] = sha(bytes)
  return JSON.parse(bytes)
}
function diagnostics(expected, response) {
  const text = typeof response?.answer === 'string' ? response.answer.replaceAll(expected.question, '') : ''
  return {
    ...judgeDocsAnswer(expected, response),
    missingAnswerKeys: (expected.answerKeys ?? []).filter(k => !text.toLowerCase().includes(k.toLowerCase())),
    matchedAcceptanceCues: (expected.acceptanceCues ?? []).filter(c => new RegExp(c, 'i').test(text)),
  }
}
const controls = read(controlsPath)
const frozen = read(join(resolve(controlsPath, '..'), 'controls.freeze-receipt.json'))
assert.equal(sha(readFileSync(controlsPath)), frozen.sha256, 'Control inputs changed after freezing')
const controlResults = controls.cases.map(c => {
  const judgment = diagnostics(c.expected, c.response)
  assert.equal(judgment.passed, c.expectedLegacyPassed, c.id + ': unexpected legacy behavior')
  return {...c, judgment, agreesWithSemanticExpectation: judgment.passed === c.semanticExpectation}
})
const arms = []
for (const arm of readdirSync(comparison).filter(x => /^repeat-\d+-(baseline|single_loop|dual_loop)$/.test(x)).sort()) {
  const dir = join(comparison, arm), data = read(join(dir, 'inputs/dataset.json'))
  const candidates = read(join(dir, 'candidates.json')), journal = read(join(dir, 'journal.json'))
  const baseline = readFileSync(join(dir, 'inputs/persona.txt'), 'utf8')
  hashes[join(dir, 'inputs/persona.txt')] = sha(baseline)
  const byId = new Map([{id: 'baseline', persona: baseline, version: sha(baseline)}, ...candidates].map(c => [c.id, c]))
  const evaluations = []
  for (const filename of readdirSync(join(dir, 'judgments')).filter(x => x.endsWith('.json')).sort()) {
    const path = join(dir, 'judgments', filename), judgment = read(path)
    const session = read(judgment.evidence[0].sessionReceipt), candidate = byId.get(judgment.candidateId)
    assert.ok(candidate, 'Unknown candidate')
    assert.equal(session.status, 'completed')
    assert.equal(session.candidateId, candidate.id)
    assert.equal(session.candidateVersion, candidate.version)
    assert.equal(sha(candidate.persona), candidate.version)
    assert.equal(session.tier, judgment.tier)
    assert.equal(session.dataId, data[judgment.tier].id)
    assert.equal(session.datasetDigest, digest(data))
    assert.equal(judgment.evidence[0].datasetDigest, session.datasetDigest)
    if (candidate.id !== 'baseline') {
      assert.equal(candidate.delta.persona, candidate.persona)
      assert.equal(candidate.delta.kind, 'cordis-overlay')
      assert.equal(candidate.delta.target, 'system-prompt')
      assert.equal(candidate.parentId, 'baseline')
      assert.equal(candidate.parentVersion, sha(baseline))
      const proposed = journal.events.find(e => e.kind === 'candidate' && e.status === 'proposed' && e.candidateId === candidate.id)
      assert.deepEqual(proposed.candidate, candidate)
      if (judgment.tier === 'fast') {
        const compared = journal.events.find(e => e.kind === 'comparison' && e.tier === 'fast' && candidate.id in e.comparison.scores)
        assert.equal(compared.comparison.scores[candidate.id], judgment.metrics.quality)
        assert.equal(compared.comparison.verdicts[candidate.id], 'not_better')
      }
    }
    const headers = session.sessionEvents.filter(e => e.type === 'request/header')
    assert.equal(headers.length, 1, 'Expected one actual request header')
    const header = headers[0].data.header
    const expanded = candidate.persona.replaceAll('{{model}}', header.config.model).replaceAll('{{cwd}}', dir).trim()
    assert.equal(header.system.trim(), expanded, 'Actual system prompt differs from selected overlay')
    const answers = JSON.parse(session.text)
    const rows = data[judgment.tier].tasks.map(task => {
      const result = diagnostics(task.expected, answers[task.id])
      const old = judgment.rows.find(row => row.taskId === task.id)
      assert.ok(old)
      for (const [key, value] of Object.entries(old)) if (key !== 'taskId') assert.deepEqual(result[key], value)
      return {taskId: task.id, answer: answers[task.id], ...result}
    })
    assert.equal(rows.filter(r => r.passed).length / rows.length, judgment.metrics.quality)
    evaluations.push({candidateId: candidate.id, candidateVersion: candidate.version, tier: judgment.tier,
      quality: judgment.metrics.quality, grounded: judgment.metrics.grounded, rows,
      overlayMatchesActualHeader: true, actualSystemSha256: sha(header.system), judgmentPath: path,
      sessionReceipt: session.receiptPath, attempts: session.costEvidence.attempts})
  }
  const states = [...byId.values()].map(c => ({candidateId: c.id, ...Object.fromEntries(['fast', 'slow', 'final'].map(tier => {
    const found = evaluations.filter(e => e.candidateId === c.id && e.tier === tier)
    return [tier, found.length ? {status: 'EVALUATED', scores: found.map(e => e.quality)} :
      {status: tier === 'slow' && arm.endsWith('single_loop') ? 'NOT_CONFIGURED' : 'NOT_EVALUATED'}]
  }))}))
  const generationInputs = readdirSync(join(dir, 'sessions')).filter(x => x.endsWith('.json')).flatMap(file => {
    const path = join(dir, 'sessions', file), session = read(path)
    if (session.operation !== 'generate') return []
    const event = session.sessionEvents.find(e => e.type === 'user/message')
    const prompt = JSON.parse(event.data.content.filter(c => c.type === 'text').map(c => c.text).join(''))
    return [{generation: session.generation, receiptPath: path, feedback: prompt.feedback,
      trainingQuestions: prompt.trainingExamples.map(e => e.criteria.question), prompt}]
  })
  const deltaExplanations = candidates.map(candidate => {
    const candidateFast = evaluations.find(e => e.candidateId === candidate.id && e.tier === 'fast')
    const baselineFast = evaluations.find(e => e.candidateId === 'baseline' && e.tier === 'fast')
    const comparison = journal.events.find(e => e.kind === 'comparison' && e.tier === 'fast' && candidate.id in e.comparison.scores)
    const next = generationInputs.find(g => g.generation === comparison.generation + 1)
    const pairedTasks = candidateFast.rows.map(c => {
      const b = baselineFast.rows.find(r => r.taskId === c.taskId)
      return {taskId: c.taskId, baselineResponse: b.answer, candidateResponse: c.answer,
        answerTextChanged: b.answer.answer !== c.answer.answer, citationsChanged: JSON.stringify(b.answer.citations) !== JSON.stringify(c.answer.citations),
        baselinePassed: b.passed, candidatePassed: c.passed, passFailChanged: b.passed !== c.passed,
        candidateMatchedCues: c.matchedAcceptanceCues, candidateMissingFiles: c.missingFiles, candidateForbidden: c.forbidden}
    })
    return {candidateId: candidate.id, parentId: candidate.parentId, parentVersion: candidate.parentVersion,
      hypothesis: candidate.hypothesis, parentPersona: baseline, delta: candidate.delta, generation: comparison.generation,
      pairedTasks, fastVerdict: comparison.comparison.verdicts[candidate.id],
      nextGeneration: next ? {receiptPath: next.receiptPath, feedback: next.feedback, trainingQuestions: next.trainingQuestions,
        failedFastQuestionVisible: data.fast.tasks.filter(t => !candidateFast.rows.find(r => r.taskId === t.id).passed)
          .some(t => JSON.stringify(next.prompt).includes(t.expected.question))} : {status: 'NO_NEXT_GENERATION'},
      causalStatus: 'NOT_PROVEN: delta binding, text differences and gate reasons are observations; individual prompt-clause effects require separate evidence.'}
  })
  arms.push({arm, states, evaluations, deltaExplanations, journalPath: join(dir, 'journal.json'), journalEvents: journal.events,
    result: {championId: journal.result.championId, improvementProven: journal.result.improvementProven,
      conclusion: journal.result.conclusion, selectedOverlay: journal.result.selectedOverlay}})
}
const fast = arms.flatMap(a => a.evaluations.filter(e => e.tier === 'fast'))
const candidateFast = fast.filter(e => e.candidateId !== 'baseline')
const paired = arms.flatMap(a => a.deltaExplanations.flatMap(d => d.pairedTasks))
assert.equal(arms.length, 6); assert.equal(candidateFast.length, 8); assert.equal(fast.length, 14)
assert.ok(fast.every(e => e.quality === .75 && e.rows.filter(r => !r.passed).map(r => r.taskId).join() === 'ab-01'))
const summary = {arms: arms.length, candidates: candidateFast.length, fastEvaluations: fast.length,
  everyCandidateOverlayInActualRequest: candidateFast.every(e => e.overlayMatchesActualHeader),
  allFastScores: [...new Set(fast.map(e => e.quality))], allFailedFastTaskIds: ['ab-01'],
  pairedFastOutputs: paired.length, changedAnswerTexts: paired.filter(p => p.answerTextChanged).length,
  changedTaskPassFail: paired.filter(p => p.passFailChanged).length,
  allAbstentionsMissingCue: fast.every(e => !e.rows.find(r => r.taskId === 'ab-01').matchedAcceptanceCues.length),
  forbiddenNameFailures: arms.flatMap(a => a.evaluations.filter(e => e.tier === 'fast').flatMap(e =>
    e.rows.filter(r => r.forbidden?.length).map(r => ({arm: a.arm, candidateId: e.candidateId, taskId: r.taskId, forbidden: r.forbidden})))),
  qualityDefinition: 'passed rows / rows; four rows => values 0, .25, .5, .75, 1; grounded is a separate path-membership constraint',
  final: arms.flatMap(a => a.evaluations.filter(e => e.tier === 'final').map(e => ({arm: a.arm, candidateId: e.candidateId, quality: e.quality}))),
  controls: {count: controlResults.length, frozenLegacyBehaviorChecksPassed: controlResults.length,
    semanticMismatches: controlResults.filter(c => !c.agreesWithSemanticExpectation).map(c => c.id)},
  scoreVersion: 'native-docs-qa-*/1 unchanged', realRequestsThisDiagnostic: 0, costCny: 0}
writeFileSync(resolve(outputArg), JSON.stringify({atUtc: new Date().toISOString(), summary, controlResults, arms, sourceHashes: hashes}, null, 2) + '\n', {flag: 'wx'})
console.log(JSON.stringify(summary, null, 2))
