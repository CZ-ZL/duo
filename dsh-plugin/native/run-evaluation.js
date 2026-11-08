import { fail } from './definitions.js'
import { freeze } from './contract.js'
import { evidenceReceipt } from './evidence-strategy.js'
const clone = (value) => structuredClone(value)

// Validate frozen measurement identities before admitting observations or selection.
export function createEvaluation({
  ctx,
  plan,
  signal,
  j,
  invoke,
  record,
  baselineTiers,
  final,
  noteEvaluation,
}) {
  const { spec, providers } = plan
  const evaluationOnly = spec.mode === 'evaluation_only'
  const evaluate = async (candidate, tier) => {
    const applied = freeze(clone(candidate)),
      d = providers.evaluators.find((e) => e.tier === tier),
      objective = spec[tier]
    const executed = await invoke(
      'evaluation',
      tier,
      providers.executor,
      () => ctx.duoExecutor.execute({ candidate: applied, applied, tier, signal }),
      { candidateId: candidate.id, tier, step: 'execute' },
    )
    const result = await invoke(
      'evaluation',
      null,
      d,
      () =>
        ctx.duoEvaluators.evaluate({
          candidate: applied,
          artifact: executed.artifact,
          tier,
          signal,
        }),
      { candidateId: candidate.id, tier, step: 'evaluate' },
    )
    if (
      result.candidateId !== candidate.id ||
      result.evaluatorId !== objective.evaluatorId ||
      result.version !== objective.version ||
      result.dataId !== objective.dataId ||
      result.tier !== tier ||
      typeof result.ok !== 'boolean' ||
      !result.metrics
    )
      fail(
        'DUO_EVIDENCE_INVALID',
        'Evaluator result identity or shape differs from the frozen contract',
      )
    j.append({ kind: 'evidence_acquired', receipt: evidenceReceipt(d, result) })
    // Preserve each settled measurement before the next provider can fail.
    // This records an observation, without granting promotion or adoption.
    if (tier !== 'final') record(candidate, { [tier]: result })
    if (candidate.id === plan.baseline.id) baselineTiers.add(tier)
    const consecutiveEvaluationFailures = noteEvaluation(result)
    if (
      spec.stopping?.maxConsecutiveEvaluationFailures !== undefined &&
      consecutiveEvaluationFailures >= spec.stopping.maxConsecutiveEvaluationFailures
    ) {
      // Retain the observation that reaches the cap before stopping. Provider
      // exceptions and unknown costs still stop immediately in invoke().
      if (tier === 'final') {
        final.push(freeze(clone(result)))
        j.append({ kind: 'final', results: clone(final) })
      } else record(candidate, { status: 'error', [tier]: result })
      fail(
        'DUO_EVALUATION_FAILURE_LIMIT',
        'Configured consecutive evaluation failures reached; no further work admitted',
      )
    }
    return freeze(clone(result))
  }
  const compare = (results, tier, incumbentId) =>
    ctx.duoComparator.compare(
      results,
      {
        weights: spec[tier].weights,
        epsilon: spec.epsilon,
        minSamples: spec.minSamples,
        constraints: spec.constraints,
      },
      incumbentId,
    )
  const assessIncumbent = (candidate, evidence, tier) => {
    const comparison = compare([evidence], tier, null),
      verdict = comparison.verdicts[candidate.id],
      searchAllowed = ['better', 'constraint_violation'].includes(verdict),
      reason =
        verdict === 'constraint_violation'
          ? 'VALID_MEASUREMENT_REQUIRES_QUALITY_REPAIR'
          : searchAllowed
            ? 'QUALITY_CONSTRAINTS_MET'
            : 'UNUSABLE_BASELINE_EVIDENCE'
    j.append({
      kind: candidate.id === plan.baseline.id ? 'baseline_assessment' : 'incumbent_assessment',
      candidateId: candidate.id,
      tier,
      verdict,
      searchAllowed,
      reason,
      comparison,
    })
    let doctor = null
    try {
      doctor = ctx.get('duoDoctor')?.consult?.(j.events(), spec) ?? null
    } catch {
      doctor = null // the guard must never break the run it guards
    }
    if (doctor) j.append({ kind: 'doctor', ...doctor })
    if (doctor?.severity === 'stop')
      fail(
        'DUO_DOCTOR_STOP',
        doctor.checks.find((c) => c.severity === 'stop')?.verdict ?? 'Run doctor stop',
      )
    if (!evaluationOnly && !searchAllowed)
      fail(
        'DUO_BASELINE_INVALID',
        'Baseline has unusable ' +
          tier +
          ' evidence; inspect baselineAssessment before repairing the evaluator or inputs',
      )
  }

  return { evaluate, compare, assessIncumbent }
}
