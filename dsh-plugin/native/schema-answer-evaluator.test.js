import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSchemaMeasurement } from '../../examples/native/schema-answer-evaluator.js'
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'duo-answer-schema-')),
    dataset = {
      version: 1,
      ...Object.fromEntries(
        ['fast', 'slow', 'final'].map((t) => [
          t,
          {
            id: t,
            tasks: [
              { id: t + '-1', input: 'Question ' + t + '\nSOURCE: source.md (lines 1-2)\nText.' },
            ],
          },
        ]),
      ),
    },
    datasetPath = join(root, 'data.json')
  writeFileSync(datasetPath, JSON.stringify(dataset))
  const m = createSchemaMeasurement({ datasetPath, artifactRoot: root, evidenceKind: 'fixture' }),
    d = m.describe()[0],
    candidate = { id: 'candidate', version: 'v1' }
  return {
    m,
    candidate,
    artifact: {
      candidateId: candidate.id,
      candidateVersion: candidate.version,
      status: 'completed',
      tier: 'fast',
      dataId: 'fast',
      datasetDigest: d.datasetDigest,
      text: '',
    },
  }
}
test('custom schema measurement executes the existing validator on actual supplied output, with distinct fixed controls', async () => {
  const { m, candidate, artifact } = setup(),
    answers = [
      { answer: 'Answer.', citations: ['source.md'] },
      { answer: 4, citations: ['source.md'] },
      { answer: 'Answer.', citations: ['made-up.md'] },
      { answer: '', citations: [] },
    ],
    expected = [1, 0, 0, 0]
  for (let i = 0; i < answers.length; i++) {
    const r = await m.evaluate({
      candidate,
      artifact: { ...artifact, text: JSON.stringify({ 'fast-1': answers[i] }) },
      tier: 'fast',
    })
    assert.equal(r.ok, true)
    assert.equal(r.metrics.quality, expected[i])
    assert.equal(r.costCny, 0)
    assert.equal(r.evidence[0].qualification, 'OUTPUT_PROTOCOL_ONLY')
    assert.equal(r.evidence[0].independentData, false)
  }
})
test('custom measurement refuses mismatched artifact identity and counts malformed task output as failed protocol', async () => {
  const { m, candidate, artifact } = setup()
  const wrong = await m.evaluate({
    candidate,
    artifact: { ...artifact, candidateVersion: 'wrong' },
    tier: 'fast',
  })
  assert.equal(wrong.ok, false)
  assert.equal(wrong.costCny, 0)
  for (const text of ['not json', '{}', '{"extra":{"answer":"x","citations":["source.md"]}}']) {
    const r = await m.evaluate({ candidate, artifact: { ...artifact, text }, tier: 'fast' })
    assert.equal(r.ok, true)
    assert.equal(r.metrics.quality, 0)
    assert.equal(r.metrics.sample_size, 1)
  }
})
