import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { preparePersonaDelivery, personaReplacement } from '../../../examples/native/adoption.js'
const sha = (text) => createHash('sha256').update(text).digest('hex')
const baseline = {
  id: 'baseline',
  persona: 'Original {{model}} in {{cwd}}.\r\n',
  version: sha('Original {{model}} in {{cwd}}.\r\n'),
  path: '/original.txt',
}
const child = (id, parent, text) => ({
  id,
  parentId: parent.id,
  parentVersion: parent.version,
  persona: text,
  version: sha(text),
  delta: { kind: 'cordis-overlay', target: 'system-prompt', persona: text },
})
function fixture() {
  const a = child('a', baseline, baseline.persona + 'First.'),
    b = child('b', a, a.persona + 'Second.')
  return {
    apiVersion: 2,
    runtime: 'dsh-native',
    runId: 'run',
    result: {
      status: 'completed',
      runId: 'run',
      conclusion: 'retain_baseline',
      improvementProven: false,
    },
    events: [
      {
        kind: 'plan',
        plan: {
          runId: 'run',
          planDigest: 'plan',
          baseline,
          spec: { target: { kind: 'dsh-persona', path: baseline.path } },
        },
      },
      { kind: 'candidate', candidate: a },
      { kind: 'candidate', candidate: b },
    ],
  }
}
test('delivery verifies multigeneration lineage and preserves original bytes without inferring adoption authority', () => {
  const s = fixture(),
    before = JSON.stringify(s),
    d = preparePersonaDelivery(s, 'b')
  assert.equal(JSON.stringify(s), before)
  assert.equal(d.original.persona, baseline.persona)
  assert.deepEqual(
    d.lineage.map((x) => x.id),
    ['baseline', 'a', 'b'],
  )
  assert.equal(d.authorityGranted, false)
  assert.equal(d.conclusion, 'retain_baseline')
  assert.equal(d.improvementProven, false)
  const adopt = personaReplacement(d, baseline.persona, 'adopt')
  assert.equal(adopt.content, d.candidate.persona)
  assert.equal(adopt.authorityGranted, false)
  const rollback = personaReplacement(d, adopt.content, 'rollback')
  assert.equal(rollback.content, baseline.persona)
})
test('delivery refuses corrupted or missing lineage, placeholders, or nonterminal evidence', () => {
  for (const mutate of [
    (s) => {
      s.events[2].candidate.parentVersion = 'wrong'
    },
    (s) => {
      s.events[2].candidate.persona += 'unrecorded'
    },
    (s) => {
      s.events.splice(1, 1)
    },
    (s) => {
      s.result.status = 'running'
    },
    (s) => {
      s.events[2].candidate.delta.target = 'tools'
    },
    (s) => {
      s.events[2].candidate = child('b', s.events[1].candidate, 'missing placeholders')
    },
    (s) => {
      s.events[2].candidate.parentId = 'b'
    },
    (s) => {
      s.events[0].plan.runId = 'another'
    },
  ]) {
    const s = fixture()
    mutate(s)
    assert.throws(() => preparePersonaDelivery(s, 'b'), /DUO_DELIVERY_INVALID/)
  }
})
test('adoption and rollback refuse a changed current file or tampered delivered bytes', () => {
  const d = preparePersonaDelivery(fixture(), 'b')
  assert.throws(
    () => personaReplacement(d, 'someone else changed this', 'adopt'),
    /DUO_COPY_CHANGED/,
  )
  assert.throws(() => personaReplacement(d, baseline.persona, 'rollback'), /DUO_COPY_CHANGED/)
  assert.throws(() => personaReplacement(d, baseline.persona, 'deploy'), /DUO_DELIVERY_INVALID/)
  d.candidate.persona += 'tamper'
  assert.throws(() => personaReplacement(d, baseline.persona, 'adopt'), /DUO_DELIVERY_INVALID/)
})
