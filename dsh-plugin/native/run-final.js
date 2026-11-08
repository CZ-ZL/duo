const clone = (value) => structuredClone(value)

// Final evaluation is invoked only after search; none of these rows feed generation.
export async function completeSearch({
  plan,
  j,
  budget,
  stages,
  champion,
  championEvidence,
  stopReason,
  generationsRun,
  final,
  evaluate,
  compare,
  baselineAssessment,
}) {
  const { spec, providers, runId } = plan
  const evaluationOnly = spec.mode === 'evaluation_only'
  const noFeasibleCandidate =
    champion.id === plan.baseline.id &&
    Object.values(baselineAssessment()).some((a) => a.verdict === 'constraint_violation')
  let conclusion =
    stopReason !== 'doctor_stop' &&
    spec.mode === 'optimize' &&
    champion.id === plan.baseline.id &&
    !noFeasibleCandidate
      ? 'retain_baseline'
      : 'insufficient_evidence'
  let independentFinal = null
  if (
    spec.final &&
    spec.mode !== 'explore' &&
    !['evidence_policy_stop', 'doctor_stop'].includes(stopReason)
  ) {
    for (const c of champion.id === plan.baseline.id ? [plan.baseline] : [plan.baseline, champion])
      final.push(await evaluate(c, 'final'))
    j.append({ kind: 'final', results: final })
    const cmp = compare(final, 'final', plan.baseline.id)
    const admitted = final.every(
      (r) =>
        ['better', 'not_better'].includes(cmp.verdicts[r.candidateId]) ||
        (r.candidateId === plan.baseline.id &&
          champion.id !== plan.baseline.id &&
          cmp.verdicts[r.candidateId] === 'constraint_violation'),
    )
    const finalConclusion = !admitted
      ? 'insufficient_evidence'
      : champion.id !== plan.baseline.id && cmp.verdicts[champion.id] === 'better'
        ? 'recommend_candidate'
        : 'retain_baseline'
    const reusedHistory = plan.warmStart?.mode === 'warm_start',
      qualifiedConclusion =
        reusedHistory && finalConclusion === 'recommend_candidate'
          ? 'insufficient_evidence'
          : finalConclusion
    if (!evaluationOnly)
      independentFinal = {
        conclusion: qualifiedConclusion,
        comparison: cmp,
        ...(reusedHistory
          ? {
              observedConclusion: finalConclusion,
              independence: 'NOT_ESTABLISHED',
              dataReview: clone(plan.warmStart.finalDataReview),
            }
          : {}),
      }
    if (spec.mode === 'optimize' && !noFeasibleCandidate) conclusion = qualifiedConclusion
  }
  const doctorReport = [...j.events()].reverse().find((e) => e.kind === 'doctor')
  const result = {
    apiVersion: 2,
    runtime: 'dsh-native',
    runId,
    planDigest: plan.planDigest,
    status: 'completed',
    mode: spec.mode,
    stopReason,
    generationsRun,
    championId: spec.mode === 'optimize' && !noFeasibleCandidate ? champion.id : null,
    proxyLeaderId: spec.mode === 'fast_only' && !noFeasibleCandidate ? champion.id : null,
    ...(!evaluationOnly
      ? {
          selectionOutcome: noFeasibleCandidate
            ? 'no_feasible_candidate'
            : champion.id === plan.baseline.id
              ? 'baseline_retained'
              : 'feasible_candidate',
        }
      : {}),
    conclusion,
    selectedOverlay: champion.id === plan.baseline.id ? null : champion.delta,
    final,
    independentFinal,
    improvementProven: false,
    evidenceKind: providers.evaluators.every(
      (d) => d.evidenceKind === providers.evaluators[0]?.evidenceKind,
    )
      ? (providers.evaluators[0]?.evidenceKind ?? 'unknown')
      : 'mixed_declared',
    budget: budget.snapshot(),
    reusedArtifacts: false,
    ...(doctorReport
      ? { doctor: { severity: doctorReport.severity, checks: doctorReport.checks } }
      : {}),
  }
  if (evaluationOnly) {
    const evaluations = [...stages.map((s) => championEvidence[s.tier]), ...final].filter(Boolean)
    Object.assign(result, {
      operation: 'evaluate',
      stopReason: 'evaluation_complete',
      championId: null,
      conclusion: evaluations.every((r) => r.ok) ? 'retain_baseline' : 'insufficient_evidence',
      evaluations,
      measurementChecks: Object.fromEntries(
        evaluations.map((r) => [r.tier, compare([r], r.tier, null)]),
      ),
      limitations: [
        'Evaluation-only measures the current target; no search or candidate improvement was attempted.',
        'Retaining the target is not a claim that its constraints or quality passed; inspect measurementChecks.',
      ],
    })
  }

  return result
}
