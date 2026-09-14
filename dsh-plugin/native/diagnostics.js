// Shared public failure vocabulary. Does not override DSH error identity,
// reconcile a bill, infer side effects, authorize retry, or start any work.
export function describeFailure(error = {}, defaultComponent = 'duoController') {
  const code = error.code ?? 'DUO_PROVIDER_FAILED'
  let component = defaultComponent,
    retryable = false,
    recoveryCondition =
      'Inspect retained state and determine whether any work started or was charged',
    nextAction =
      'Inspect dualloop_status and dualloop_budget_status; reconcile supported receipts and obtain any missing authorization before a new run',
    costState = 'UNKNOWN_UNTIL_LEDGER_INSPECTION',
    sideEffectState = 'UNKNOWN_UNTIL_EXECUTION_INSPECTION'
  if (code === 'DUO_ADDITIONAL_EVIDENCE_REQUIRED') {
    component = 'duoController'
    retryable = true
    recoveryCondition =
      'Prepare compatible objective-relevant additional evidence or explicitly choose a supported single-fidelity preset'
    nextAction =
      'Read dualloop_design.evidenceStrategy; connect an applicable provider or explicitly select optimize-basic/auto, then inspect a new plan'
    costState = 'NO_WORK_DISPATCHED_BY_THIS_CALL'
    sideEffectState = 'NO_WORK_DISPATCHED_BY_THIS_CALL'
  } else if (code === 'INVALID_ARGS' || code === 'DUO_PLAN_CHANGED') {
    component = code === 'INVALID_ARGS' ? 'dsh.tools.arguments' : 'duoController'
    retryable = true
    recoveryCondition =
      code === 'INVALID_ARGS'
        ? 'Correct arguments to the discovered schema'
        : 'Inspect and accept the current plan within existing authorization'
    nextAction =
      'Read the tool schema and dualloop_plan; verify target, providers and budget, then pass the exact planDigest'
    costState = 'NO_WORK_DISPATCHED_BY_THIS_CALL'
    sideEffectState = 'NO_WORK_DISPATCHED_BY_THIS_CALL'
  } else if (/DENIED|APPROVAL|FORBIDDEN/.test(code)) {
    component = 'dsh.tools.policy'
    recoveryCondition = 'The required host permission or explicit authorization is granted'
    nextAction =
      'Report the denial and request the missing authorization through the host; do not bypass policy'
  } else if (/ABORT|CANCEL/.test(code)) component = 'dsh.tools.cancellation'
  else if (/CONTRACT|CURRENCY|FINAL_DATA/.test(code)) component = 'duoContract'
  else if (/EVALUATOR|EVIDENCE/.test(code)) component = 'duoEvaluators'
  else if (/BUDGET|COST|RECEIPT/.test(code)) component = 'duoBudget'
  else if (/TARGET|DELTA/.test(code)) component = 'duoTarget'
  const cause = error.message ?? 'A configured provider or host operation failed'
  return {
    code,
    message: cause,
    cause,
    component: error.component ?? component,
    retryable,
    recoverability: retryable
      ? 'CORRECT_INPUT_THEN_REPLAN'
      : 'INSPECT_RETAINED_STATE_NO_AUTOMATIC_RETRY',
    recoveryCondition,
    nextAction: error.nextAction ?? nextAction,
    costState,
    sideEffectState,
  }
}
