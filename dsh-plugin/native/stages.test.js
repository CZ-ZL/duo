import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveNativeContract } from './contract.js'
import { searchStages } from './stages.js'
import * as stageDefinitions from './stages.js'
import { contractSchema, designDraft } from './onboarding.js'
const base = () =>
  JSON.parse(readFileSync(new URL('../../examples/native/experiment.json', import.meta.url)))
function staged() {
  const c = base(),
    objective = c.fast
  delete c.fast
  delete c.slow
  c.searchStages = ['fast', 'review', 'slow'].map((tier, i) => ({
    ...objective,
    tier,
    evaluatorId: 'fixture-' + tier,
    dataId: tier,
    purpose: ['screen', 'rank', 'confirm'][i],
    informationGain: ['Small check', 'Additional cases', 'Broader confirmation'][i],
    maxEvaluations: 10,
    topK: i === 2 ? 0 : 1,
  }))
  return c
}
test('explicit three-stage contract resolves ordered objectives and preserves the distinct final', () => {
  const c = staged(),
    spec = resolveNativeContract(c, '/tmp/three.json').spec
  assert.deepEqual(
    searchStages(spec).map((s) => s.tier),
    ['fast', 'review', 'slow'],
  )
  assert.equal(spec.mode, 'optimize')
  assert.equal(spec.review.dataId, 'review')
  assert.equal(spec.final.dataId, c.final.dataId)
  const legacy = resolveNativeContract(base(), '/tmp/two.json').spec
  assert.deepEqual(
    searchStages(legacy).map((s) => s.tier),
    ['fast', 'slow'],
  )
  assert.equal(legacy.searchStages, undefined)
})
test('stages refuse ambiguous, unordered, unbounded or final-leaking authoring', () => {
  for (const mutate of [
    (c) => (c.fast = base().fast),
    (c) => c.searchStages.reverse(),
    (c) => c.searchStages.push(c.searchStages[2]),
    (c) => (c.searchStages[1].tier = 'final'),
    (c) => (c.searchStages[1].maxEvaluations = Infinity),
    (c) => (c.searchStages[1].informationGain = ''),
    (c) => (c.searchStages[1].topK = c.topK + 1),
    (c) => (c.searchStages[2].topK = 1),
    (c) => (c.searchStages[1].next = 'cycle'),
  ]) {
    const c = staged()
    mutate(c)
    assert.throws(() => resolveNativeContract(c, '/tmp/three.json'), {
      code: 'DUO_CONTRACT_INVALID',
    })
  }
  const c = staged()
  c.final.dataId = 'review'
  assert.throws(() => resolveNativeContract(c, '/tmp/three.json'), {
    code: 'DUO_FINAL_DATA_INVALID',
  })
})
test('caller-declared ladders accept custom names and reject invalid ladders', () => {
  const custom = (names) => {
    const c = staged()
    c.searchStages = names.map((tier, i) => ({
      ...c.searchStages[0],
      tier,
      evaluatorId: 'fixture-' + tier,
      dataId: tier,
      topK: i === names.length - 1 ? 0 : 1,
    }))
    return c
  }
  const spec = resolveNativeContract(
    custom(['unit', 'benchmark', 'holdout', 'audit']),
    '/tmp/ladder.json',
  ).spec
  assert.deepEqual(
    searchStages(spec).map((s) => s.tier),
    ['unit', 'benchmark', 'holdout', 'audit'],
  )
  assert.equal(spec.mode, 'optimize')
  assert.equal(spec.audit.dataId, 'audit')
  assert.deepEqual(
    searchStages(resolveNativeContract(custom(['solo']), '/tmp/ladder.json').spec).map(
      (s) => s.tier,
    ),
    ['solo'],
  )
  const deep = resolveNativeContract(
    custom(['a', 'b', 'c', 'd', 'e', 'f', 'g']),
    '/tmp/ladder.json',
  ).spec
  assert.deepEqual(
    searchStages(deep).map((s) => s.tier),
    ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  )
  for (const names of [
    ['unit', 'unit'],
    ['final', 'audit'],
    ['baseline', 'audit'],
    ['Unit', 'audit'],
    ['unit tier'],
    [],
  ]) {
    assert.throws(
      () => resolveNativeContract(custom(names), '/tmp/ladder.json'),
      { code: 'DUO_CONTRACT_INVALID' },
      names.join(','),
    )
  }
})
test('public objective and stage schema share definitions and all required objective fields are enforced', () => {
  assert.deepEqual(contractSchema.properties.fast.oneOf[0], stageDefinitions.objectiveSchema())
  assert.deepEqual(contractSchema.properties.searchStages, stageDefinitions.searchStagesSchema())
  for (const field of contractSchema.properties.fast.oneOf[0].required) {
    const c = staged()
    delete c.searchStages[1][field]
    assert.throws(() => resolveNativeContract(c, '/tmp/shared.json'), {
      code: 'DUO_CONTRACT_INVALID',
    })
    assert.notEqual(designDraft(c, '/tmp/shared.json').status, 'draft_valid')
  }
  for (const file of [
    'experiment.json',
    'byo-experiment.json',
    'three-stage-experiment.json',
    'warm-start-experiment.json',
    'ladder-experiment.json',
  ]) {
    const c = JSON.parse(readFileSync(new URL('../../examples/native/' + file, import.meta.url)))
    assert.doesNotThrow(() => resolveNativeContract(c, '/tmp/shared.json'))
    assert.equal(designDraft(c, '/tmp/shared.json').status, 'draft_valid')
  }
  const legacy = base()
  legacy.budget = {
    maxCostUsd: 0,
    maxSessions: 100,
    maxFastEvals: 20,
    maxSlowEvals: 10,
    maxWallTimeMs: 10000,
  }
  assert.doesNotThrow(() => resolveNativeContract(legacy, '/tmp/shared.json'))
  const legacyDraft = designDraft(legacy, '/tmp/shared.json')
  assert.equal(legacyDraft.status, 'needs_input')
  assert.ok(legacyDraft.issues.some((i) => i.path === 'budget.currency'))
})
