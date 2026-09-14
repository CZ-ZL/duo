import test from 'node:test'
import assert from 'node:assert/strict'
import {
  diagnoseCombinedFailure,
  diagnoseRequestBoundary,
} from '../../scripts/maturation_diagnostics.mjs'

const requestRoute = { provider: 'deepseek-official', model: 'deepseek-v4-flash', maxTokens: 2048 }
const config = { ...requestRoute, callerMaxInputBytes: 196608, innerMaxInputBytes: 32768 }

test('real trace input refusal is distinguished from a route mismatch without dispatch or retry', () => {
  const failure = diagnoseRequestBoundary({
    kind: 'caller',
    options: requestRoute,
    config,
    requestBytes: 199405,
  })
  assert.equal(failure.code, 'DUO_REQUEST_INPUT_LIMIT')
  assert.equal(failure.facts.excessBytes, 2797)
  assert.equal(failure.facts.providerRequestDispatched, false)
  assert.equal(failure.facts.reservationCreated, false)
  assert.deepEqual(failure.facts.routeMismatch, [])
  assert.equal(failure.recovery.automaticRetry, false)
  assert.equal(
    diagnoseRequestBoundary({
      kind: 'caller',
      options: requestRoute,
      config,
      requestBytes: 196608,
    }),
    null,
  )
  assert.equal(
    diagnoseRequestBoundary({
      kind: 'caller',
      options: requestRoute,
      config: { ...config, callerMaxInputBytes: 327680 },
      requestBytes: 199405,
    }),
    null,
  )
})

test('a larger Caller envelope never admits a wrong route or widens an inner request bound', () => {
  const bigger = { ...config, callerMaxInputBytes: 327680 }
  for (const changed of [{ provider: 'other' }, { model: 'other' }, { maxTokens: 4096 }]) {
    const error = diagnoseRequestBoundary({
      kind: 'caller',
      options: { ...requestRoute, ...changed },
      config: bigger,
      requestBytes: 199405,
    })
    assert.equal(error.code, 'DUO_REQUEST_ROUTE_MISMATCH')
    assert.deepEqual(error.facts.routeMismatch, Object.keys(changed))
  }
  assert.equal(
    diagnoseRequestBoundary({
      kind: 'inner',
      options: requestRoute,
      config: bigger,
      requestBytes: 32769,
    }).code,
    'DUO_REQUEST_INPUT_LIMIT',
  )
})

test('a completed Caller turn with tool-shaped text is an incomplete experiment, not an executed tool', () => {
  const failure = diagnoseCombinedFailure({
    failure: null,
    terminalReason: { kind: 'completed' },
    finalText:
      '<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="cordis_run">text only</｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>',
    checks: {
      callerFinished: true,
      callerAttachedCustomEvaluator: false,
      twoCompletedNativeRuns: false,
      warmStartConsumed: false,
      interpretationValid: false,
      totalAccounting: true,
    },
  })
  assert.ok(failure, 'incomplete real run must explain failure instead of returning null')
  assert.equal(failure.code, 'DUO_CALLER_TOOL_TEXT')
  assert.deepEqual(failure.facts.failedChecks, [
    'callerAttachedCustomEvaluator',
    'twoCompletedNativeRuns',
    'warmStartConsumed',
    'interpretationValid',
  ])
  assert.equal(failure.causeStatus, 'NOT_ESTABLISHED')
  assert.equal(failure.recovery.automaticRetry, false)
  assert.equal(failure.recovery.executeTextAsTools, false)
})

test('ordinary early completion names missing acceptance conditions without diagnosing a provider cause', () => {
  const failure = diagnoseCombinedFailure({
    failure: null,
    terminalReason: { kind: 'completed' },
    finalText: 'Done.',
    checks: { callerFinished: true, twoReports: false, interpretationValid: false },
  })
  assert.ok(failure)
  assert.equal(failure.code, 'DUO_COMBINATION_INCOMPLETE')
  assert.deepEqual(failure.facts.failedChecks, ['twoReports', 'interpretationValid'])
  assert.equal(failure.facts.toolShapedText, false)
})

test('diagnostics preserve existing errors and do not reject a successful interpretation that quotes tool syntax', () => {
  const original = { code: 'DUO_INNER_COST_UNKNOWN', message: 'Preserve uncertain settlement' }
  assert.equal(
    diagnoseCombinedFailure({ failure: original, checks: { totalAccounting: false } }),
    original,
  )
  assert.equal(
    diagnoseCombinedFailure({
      failure: null,
      checks: { callerFinished: true, interpretationValid: true },
      finalText: 'A report may mention <｜｜DSML｜｜tool_calls> as data.',
    }),
    null,
  )
})
