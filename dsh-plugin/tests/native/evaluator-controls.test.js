import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import * as Example from '../../../examples/native/evaluator-controls.js'
test('existing external schema validator measures actual format plus separate citation constraint', async () => {
  const good = await Example.measure({
    artifact: { text: '{"answer":"42","citations":["local:test"]}' },
  })
  assert.equal(good.metrics.format_valid, 1)
  assert.equal(good.metrics.sources_allowed, true)
  assert.equal(good.costCny, 0)
  assert.equal(good.evidence[0].kind, 'external_schema_validation')
  assert.equal(good.evidence[0].dependencyVersion, '3.18.2')
  const bad = await Example.measure({
    artifact: { text: '{"answer":42,"citations":"local:test"}' },
  })
  assert.equal(bad.metrics.format_valid, 0)
  assert.equal(bad.metrics.sources_allowed, false)
  const wrongSource = await Example.measure({
    artifact: { text: '{"answer":"42","citations":["unapproved"]}' },
  })
  assert.equal(wrongSource.metrics.format_valid, 1)
  assert.equal(wrongSource.metrics.sources_allowed, false)
})
test('external adapter controls run via existing FunctionEvaluators without a generator', async () => {
  const ctx = new Context(),
    f = await ctx.plugin(Example)
  try {
    assert.equal(ctx.get('duoGenerator'), undefined)
    const d = ctx.duoEvaluators.describe()[0]
    assert.equal(d.dependencies[0].available, true)
    assert.equal(d.maxRequests, 0)
    const r = await ctx.duoEvaluators.evaluate({
      candidate: { id: 'baseline' },
      tier: 'fast',
      artifact: { text: 'ignored' },
      signal: new AbortController().signal,
    })
    assert.equal(r.metrics.control_match_rate, 1)
    assert.equal(r.metrics.controls_distinguish, true)
    assert.equal(r.metrics.sample_size, 4)
    assert.ok(r.evidence[0].rows.every((row) => row.purpose === 'control' && row.matched))
  } finally {
    await f.dispose()
  }
})
test('constant negative control declares that it does not execute the external validator', async () => {
  const ctx = new Context(),
    f = await ctx.plugin(Example, { constant: true })
  try {
    const d = ctx.duoEvaluators.describe()[0]
    assert.equal(d.evidenceFamily, 'constant_evaluator_negative_control')
    const r = await ctx.duoEvaluators.evaluate({
      candidate: { id: 'baseline' },
      tier: 'fast',
      artifact: {},
      signal: new AbortController().signal,
    })
    assert.equal(r.evidence[0].measurementKind, 'constant_negative_control')
    assert.equal(r.metrics.control_match_rate, 0.25)
  } finally {
    await f.dispose()
  }
})
