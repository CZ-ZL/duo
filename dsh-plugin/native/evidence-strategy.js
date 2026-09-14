import { searchStages, searchTiersOf } from './stages.js'
import { moneyFields } from './money.js'
import { matchEvaluator } from './evaluator-discovery.js'

export const productPresets = Object.freeze([
  'evaluate',
  'optimize-basic',
  'optimize-dual',
  'optimize-auto',
  'optimize',
])
import { evidenceSource, inspectIncrement } from './evidence-source.js'
export { evidenceSource, evidenceSourceFields, inspectIncrement } from './evidence-source.js'
const text = (x) => typeof x === 'string' && !!x.trim()
const strings = (x) => (Array.isArray(x) && x.every(text) ? [...new Set(x)] : [])
export function negotiateEvidence(spec, descriptors = []) {
  const stages = searchStages({ ...spec, budget: spec.budget ?? {} }),
    first = stages[0],
    preset = spec.preset ?? null,
    legacy = !preset
  const match = (s) => (s ? matchEvaluator(descriptors, s, s.tier, spec) : null),
    fastMatch = match(first),
    fast = fastMatch?.selected
  const fastAvailable = fastMatch?.status === 'COMPATIBLE_BY_DECLARATION'
  const options = stages.slice(1).map((stage) => {
    const m = match(stage),
      increment = inspectIncrement(fast ?? {}, m?.selected ?? {}, spec, stage)
    return {
      tier: stage.tier,
      ...increment,
      available: increment.available && m?.status === 'COMPATIBLE_BY_DECLARATION',
      reasons: [...increment.reasons, ...(m?.issues ?? [])],
      providerId: m?.selected?.id ?? null,
    }
  })
  const covered = new Set(evidenceSource(fast ?? {}).coverage)
  for (const option of options)
    if (option.available) {
      option.addedCoverage = option.addedCoverage.filter((k) => !covered.has(k))
      if (!option.addedCoverage.length) {
        option.available = false
        option.slow_mode = 'unavailable'
        option.reasons.push('COVERAGE_ALREADY_AVAILABLE')
      } else for (const k of option.addedCoverage) covered.add(k)
    }
  const evaluation = spec.operation === 'evaluate',
    basic = preset === 'optimize-basic',
    available = options.filter((o) => o.available)
  const active =
    evaluation || legacy
      ? stages
      : basic
        ? stages.slice(0, 1)
        : stages.filter((s, i) => i === 0 || available.some((o) => o.tier === s.tier))
  const chosen = basic ? [] : available,
    slow_mode = chosen.length
      ? chosen.every((o) => o.slow_mode === 'high_fidelity')
        ? 'high_fidelity'
        : 'expanded_evidence'
      : 'unavailable'
  const additional = chosen.length > 0,
    forced = preset === 'optimize-dual',
    requiresPreparation = !evaluation && ((!fastAvailable && !legacy) || (forced && !additional))
  const optimization_mode = evaluation
    ? 'evaluate_only'
    : additional
      ? 'dual_loop'
      : 'single_fidelity'
  const recommended_mode = requiresPreparation
    ? 'preparation_required'
    : evaluation
      ? 'evaluate_only'
      : additional
        ? 'dual_loop_' + slow_mode
        : 'single_fidelity_optimize'
  const downgrade =
    !evaluation && stages.length > 1 && !additional
      ? {
          from: 'dual_loop',
          to: 'single_fidelity',
          reason: basic ? 'EXPLICIT_BASIC_PRESET' : 'NO_QUALIFIED_INFORMATION_INCREMENT',
          legacyExecutionRetained: legacy,
        }
      : null
  const evidence_gaps =
    evaluation || additional
      ? []
      : [
          {
            type: 'additional_evidence',
            status: 'unknown',
            reason:
              basic && available.length
                ? 'Additional evidence is available but not selected by optimize-basic.'
                : 'No usable source adds declared objective-relevant coverage with an applicable provenance boundary.',
          },
        ]
  const limitations = [
    'Evidence metadata and qualification references are supplied by trusted providers; DUO does not attest their truth or invent confidence.',
  ]
  if (!additional && !evaluation)
    limitations.push(
      basic && available.length
        ? 'Additional evidence is available but not selected by optimize-basic; this does not constitute dual-loop validation.'
        : 'No independent Slow evidence is available; this does not constitute dual-loop validation.',
    )
  if (legacy && stages.length > 1 && !additional)
    limitations.push(
      'Legacy authored stages execute unchanged, as unqualified repeated measurements. Use optimize-basic/auto to avoid redundant acquisition; this is not complete dual-loop validation.',
    )
  if (slow_mode === 'expanded_evidence')
    limitations.push(
      'Coverage is expanded; higher fidelity is not established by cost, sample count or model choice.',
    )
  return {
    version: '1',
    preset: preset ?? 'legacy-authored',
    status: requiresPreparation
      ? 'PREPARATION_REQUIRED'
      : additional || evaluation
        ? 'READY'
        : 'READY_WITH_LIMITATIONS',
    target: {
      state: spec.target?.kind && spec.target?.path ? 'DECLARED_NOT_VALIDATED' : 'NOT_READY',
    },
    fast_evidence: fastAvailable ? 'available' : 'unavailable',
    additional_slow_evidence: available.length ? 'available' : 'unavailable',
    optimization_mode,
    slow_mode,
    recommended_mode,
    available: evaluation
      ? ['evaluate_only']
      : fastAvailable
        ? [
            'evaluate_only',
            'single_fidelity_optimize',
            ...(additional ? ['dual_loop_' + slow_mode] : []),
          ]
        : [],
    dual_loop_missing: available.length ? [] : ['additional evidence source'],
    suggested_next_steps: additional
      ? ['inspect_plan_and_authorization']
      : ['connect held-out evaluator', 'expand evaluation set', 'continue single-fidelity'],
    sources: descriptors
      .filter((d) => stages.some((s) => s.tier === d.tier) || (d.tier === 'final' && spec.final))
      .map(evidenceSource),
    additional_options: options,
    activeTiers: active.map((s) => s.tier),
    skippedTiers: stages.filter((s) => !active.includes(s)).map((s) => s.tier),
    evidence_gaps,
    downgrade,
    limitations,
    requiresPreparation,
  }
}
export function effectiveEvidenceSpec(spec, strategy) {
  if (!spec.preset || spec.operation === 'evaluate') return spec
  const tiers = strategy.activeTiers,
    copy = { ...spec }
  for (const t of searchTiersOf(spec)) if (!tiers.includes(t)) delete copy[t]
  if (spec.searchStages)
    copy.searchStages = spec.searchStages
      .filter((s) => tiers.includes(s.tier))
      .map((s, i, a) => ({ ...s, topK: i === a.length - 1 ? 0 : s.topK }))
  copy.mode = tiers.length > 1 ? 'optimize' : tiers.length ? 'fast_only' : 'explore'
  return copy
}
export function evidenceReceipt(descriptor, result) {
  const source = evidenceSource(descriptor),
    declared = source.coverage,
    coverage = strings(result.evidenceCoverage).filter((k) => declared.includes(k))
  return {
    candidateId: result.candidateId,
    tier: result.tier,
    source: { id: source.id, version: source.version, dataId: source.dataId },
    coverage,
    status: result.ok && coverage.length ? 'OBSERVED' : 'UNKNOWN',
    limitation:
      'Provider-reported coverage; full source declaration is frozen in plan.evidenceStrategy.sources.',
  }
}
export function evidenceOutcome(strategy, events) {
  const evidence_used = events.filter((e) => e.kind === 'evidence_acquired').map((e) => e.receipt)
  const additional_evidence_acquired = evidence_used.filter((r) =>
    strategy.additional_options.some(
      (o) =>
        o.available &&
        o.tier === r.tier &&
        r.status === 'OBSERVED' &&
        o.addedCoverage.some((k) => r.coverage.includes(k)),
    ),
  )
  const decisions = events
    .filter((e) => e.kind === 'evidence_decision')
    .map((e) => ({ candidateId: e.candidateId, generation: e.generation, ...e.decision }))
  const gaps = decisions
    .filter(
      (d) =>
        d.action === 'hold' ||
        (d.action === 'request_more_evidence' &&
          !evidence_used.some(
            (r) =>
              r.candidateId === d.candidateId &&
              r.tier === d.request?.tier &&
              r.status === 'OBSERVED',
          )),
    )
    .flatMap((d) => d.evidence_gaps ?? [])
  const candidateEvidence = additional_evidence_acquired.some((r) => r.candidateId !== 'baseline')
  const limitations = [
    ...strategy.limitations,
    ...(strategy.optimization_mode === 'dual_loop' && !candidateEvidence
      ? [
          'No additional candidate evidence was acquired; the planned dual-loop validation did not complete.',
        ]
      : []),
  ]
  return {
    optimization_mode: strategy.optimization_mode,
    slow_mode: strategy.slow_mode,
    evidence_used,
    additional_evidence_acquired,
    evidence_gaps: [...strategy.evidence_gaps, ...gaps],
    decision_basis: decisions,
    limitations,
    downgrade: strategy.downgrade,
    dual_loop_validation:
      strategy.optimization_mode !== 'dual_loop'
        ? 'UNAVAILABLE'
        : candidateEvidence
          ? 'ADDITIONAL_CANDIDATE_EVIDENCE_ACQUIRED'
          : 'NOT_OBSERVED',
  }
}
// Reserve the existing executor + evaluator pair; no additional ledger or call
// path. Estimates are declarations, never authority or replacement receipts.
export function acquisitionCost(executor, evaluator) {
  const m = moneyFields(executor)
  return {
    currency: m.currency,
    reservation: executor[m.reservation] + evaluator[m.reservation],
    operations: 2,
  }
}

// Combine judgments, not unrelated raw scores. Each input comparison already
// enforces its own evaluator/version/data/tier scope via Comparator.compare.
export function aggregateJudgments({ candidateId, observations }) {
  const observed = observations.map(({ tier, result, comparison, coverageConfirmed }) => ({
    tier,
    source: { id: result.evaluatorId, version: result.version, dataId: result.dataId },
    verdict: comparison.verdicts[candidateId] ?? 'incomparable',
    score: comparison.scores[candidateId] ?? null,
    coverageConfirmed: coverageConfirmed ?? null,
  }))
  const verdicts = observed.map((o) => o.verdict)
  return {
    observed,
    conflict: verdicts.includes('better') && verdicts.includes('not_better'),
    unknown: observed
      .filter((o) => o.verdict === 'incomparable' || o.coverageConfirmed === false)
      .map((o) => ({
        tier: o.tier,
        type: o.coverageConfirmed === false ? 'coverage' : 'comparable_measurement',
      })),
    aggregation: 'scoped_judgments_no_cross_source_score_arithmetic',
  }
}
export function decideEvidence({
  aggregate,
  next,
  selected,
  affordability,
  terminalSelected = false,
}) {
  const latest = aggregate.observed.at(-1),
    verdict = latest?.verdict
  let action,
    reason,
    evidence_gaps = []
  if (aggregate.unknown.length) {
    action = 'hold'
    reason = aggregate.unknown.some((g) => g.type === 'coverage')
      ? 'EVIDENCE_COVERAGE_UNCONFIRMED'
      : 'INCOMPARABLE_EVIDENCE'
    evidence_gaps = aggregate.unknown
  } else if (verdict === 'constraint_violation') {
    action = 'reject'
    reason = 'HARD_CONSTRAINT_VIOLATION'
  } else if (next) {
    evidence_gaps = [
      {
        type: next.source.increment?.kind ?? 'additional_evidence',
        coverage: next.addedCoverage,
        reason: next.reason,
      },
    ]
    if (!selected) {
      action = verdict === 'better' ? 'hold' : 'reject'
      reason = verdict === 'better' ? 'NOT_SELECTED_WITHIN_TOP_K' : 'NO_DEVELOPMENT_IMPROVEMENT'
    } else if (affordability.remaining < 1) {
      action = 'hold'
      reason = 'BUDGET_CONSTRAINT'
    } else {
      action = 'request_more_evidence'
      reason = aggregate.conflict ? 'RESOLVE_EVIDENCE_CONFLICT' : 'FILL_EVIDENCE_GAP'
    }
  } else {
    action = terminalSelected ? 'promote' : verdict === 'not_better' ? 'reject' : 'hold'
    reason = terminalSelected
      ? 'SCOPED_EVIDENCE_SUPPORTS_PROMOTION'
      : verdict === 'not_better'
        ? 'NO_TERMINAL_IMPROVEMENT'
        : 'NOT_SELECTED'
  }
  return {
    action,
    reason,
    evidence_gaps,
    request:
      action === 'request_more_evidence'
        ? {
            tier: next.tier,
            type: next.source.increment.kind,
            coverage: next.addedCoverage,
            reason: next.reason,
          }
        : null,
    costConstraint: affordability ?? null,
    basis: { observed: aggregate.observed, inference: [reason], unknown: aggregate.unknown },
    limit:
      'Rule-based decision from scoped observations; no oracle, confidence or causal efficacy claim.',
  }
}
export function affordableAcquisitions({
  snapshot,
  limits,
  executor,
  evaluator,
  stageRemaining,
  evaluationRemaining,
  baselineNeeded,
  finalReserved = 0,
}) {
  const m = moneyFields(limits),
    pair = acquisitionCost(executor, evaluator),
    base = baselineNeeded ? 1 : 0
  const remainingCost = Math.max(
    0,
    limits[m.cap] - (snapshot[m.known] ?? 0) - (snapshot[m.reserved] ?? 0),
  )
  const operationSlots =
    Math.floor(Math.max(0, limits.maxSessions - snapshot.operations - finalReserved * 2) / 2) - base
  const costSlots =
    pair.reservation === 0
      ? Number.MAX_SAFE_INTEGER
      : Math.floor((remainingCost + 1e-10) / pair.reservation) - base
  const remaining = Math.max(
    0,
    Math.min(stageRemaining - base, evaluationRemaining - base, operationSlots, costSlots),
  )
  return {
    ...pair,
    baselineNeeded,
    baselineReservation: base * pair.reservation,
    remainingCost,
    remaining,
    rule: 'Executor plus evaluator pair and missing incumbent evidence must fit existing stage, operation and money limits; runtime ledger still admits every call.',
  }
}
export function strategyFeedback(events) {
  return events
    .filter((e) => e.kind === 'evidence_decision')
    .map((e) => ({
      candidateId: e.candidateId,
      generation: e.generation,
      action: e.decision.action,
      reason: e.decision.reason,
      requestedTier: e.decision.request?.tier ?? null,
      requestedEvidenceType: e.decision.request?.type ?? null,
      judgments: (e.decision.basis?.observed ?? [])
        .filter((o) => o.tier !== 'final')
        .map((o) => ({ tier: o.tier, verdict: o.verdict, source: o.source })),
    }))
}

// Public generator/Feedback boundary: retain only search decision identities and
// judgments. Do not copy raw evidence, final observations, arbitrary nested data.
export function projectStrategyFeedback(rows) {
  if (!Array.isArray(rows)) return []
  const searchTier = (t) =>
    typeof t === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(t) && !['final', 'baseline'].includes(t)
  return rows
    .filter(
      (r) =>
        r &&
        text(r.candidateId) &&
        Number.isSafeInteger(r.generation) &&
        r.generation >= 0 &&
        ['reject', 'hold', 'promote', 'request_more_evidence', 'stop'].includes(r.action) &&
        text(r.reason),
    )
    .map((r) => ({
      candidateId: r.candidateId,
      generation: r.generation,
      action: r.action,
      reason: r.reason,
      requestedTier: searchTier(r.requestedTier) ? r.requestedTier : null,
      requestedEvidenceType: ['expanded_evidence', 'high_fidelity'].includes(
        r.requestedEvidenceType,
      )
        ? r.requestedEvidenceType
        : null,
      judgments: (Array.isArray(r.judgments) ? r.judgments : [])
        .filter(
          (o) =>
            searchTier(o.tier) &&
            ['better', 'not_better', 'incomparable', 'constraint_violation'].includes(o.verdict) &&
            ['id', 'version', 'dataId'].every((k) => text(o.source?.[k])),
        )
        .map((o) => ({
          tier: o.tier,
          verdict: o.verdict,
          source: Object.fromEntries(['id', 'version', 'dataId'].map((k) => [k, o.source[k]])),
        })),
    }))
}

export function strategySummary(strategy) {
  const keys = [
    'version',
    'preset',
    'status',
    'optimization_mode',
    'slow_mode',
    'fast_evidence',
    'additional_slow_evidence',
    'activeTiers',
    'skippedTiers',
    'evidence_gaps',
    'downgrade',
    'limitations',
  ]
  return Object.fromEntries(
    keys.filter((k) => strategy[k] !== undefined).map((k) => [k, structuredClone(strategy[k])]),
  )
}
