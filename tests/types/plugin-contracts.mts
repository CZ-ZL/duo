import {
  GateService,
  ComparatorService,
  type Comparison,
  type ComparisonSpec,
  type Evaluation,
  type AggregateRequest,
  type EvidenceAggregate,
  type EvidenceDecision,
  type EvidenceDecisionRequest,
  type EvidenceAction,
  type RunResult,
} from '@dual-loop/dsh-plugin/definitions'

class HoldPolicy extends GateService {
  describe() { return {id: 'typed-hold', version: '1', deterministic: true as const} }
  select(comparison: Comparison, candidates: string[], limits: {topK: number; remaining: number}) {
    return comparison.ranking.filter(id => candidates.includes(id)).slice(0, Math.min(limits.topK, limits.remaining))
  }
  decide(request: EvidenceDecisionRequest): EvidenceDecision {
    return {
      action: 'hold', reason: 'OWNER_REVIEW', evidence_gaps: request.aggregate.unknown,
      basis: {observed: request.aggregate.observed, inference: [], unknown: request.aggregate.unknown},
      costConstraint: request.affordability,
    }
  }
}

class TypedComparator extends ComparatorService {
  describe() { return {id: 'typed-comparison', version: '1', deterministic: true as const} }
  compare(_results: Evaluation[], _spec: ComparisonSpec, _incumbent: string | null = null): Comparison {
    return {ranking: [], verdicts: {}, scores: {}, comparatorId: 'typed-comparison'}
  }
  aggregate(request: AggregateRequest): EvidenceAggregate {
    return {observed: request.observations.map(o => ({
      tier: o.tier, source: {id: o.result.evaluatorId, version: o.result.version, dataId: o.result.dataId},
      verdict: o.comparison.verdicts[request.candidateId], score: o.comparison.scores[request.candidateId] ?? null,
      coverageConfirmed: o.coverageConfirmed,
    })), conflict: false, unknown: []}
  }
}

declare const decision: EvidenceDecisionRequest
// @ts-expect-error A numeric score alone is not a structured evidence request.
const wrongRequest: EvidenceDecisionRequest = {candidateId: 'a', aggregate: 1}
// @ts-expect-error Invalid policy actions must not silently become any.
const wrongAction: EvidenceAction = 'maybe_promote'
// @ts-expect-error The request has no arbitrary evaluator confidence field.
decision.confidence
declare const result: RunResult
const mode: 'high_fidelity' | 'expanded_evidence' | 'unavailable' | undefined = result.slow_mode
void [HoldPolicy, TypedComparator, wrongRequest, wrongAction, mode]
