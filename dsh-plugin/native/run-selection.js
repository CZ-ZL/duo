import { fail } from './definitions.js'
import { freeze } from './contract.js'
import {
  evidenceReceipt,
  aggregateJudgments,
  decideEvidence,
  affordableAcquisitions,
} from './evidence-strategy.js'
const clone = (value) => structuredClone(value)

// Acquire admitted development stages and arbitrate one terminal incumbent.
export async function selectGeneration({
  ctx,
  plan,
  j,
  stages,
  stageAttempts,
  budget,
  strategic,
  generation,
  candidates,
  champion,
  championEvidence,
  searchStopped,
  stopReason,
  evaluate,
  assessIncumbent,
  compare,
  record,
}) {
  const { spec, providers } = plan
  let eligible = candidates
  const measured = new Map(candidates.map((c) => [c.id, {}])),
    observations = new Map(candidates.map((c) => [c.id, []]))
  const decide = (
    candidate,
    comparison,
    tier,
    next,
    selected,
    affordability,
    terminalSelected = false,
    selectedCandidateId = null,
  ) => {
    const r = measured.get(candidate.id)[tier],
      option = plan.evidenceStrategy.additional_options.find((o) => o.tier === tier)
    const ownReceipt = evidenceReceipt(
        providers.evaluators.find((d) => d.tier === tier),
        r,
      ),
      incumbentReceipt = evidenceReceipt(
        providers.evaluators.find((d) => d.tier === tier),
        championEvidence[tier],
      )
    const coverageConfirmed = option?.available
      ? option.addedCoverage.every(
          (k) => ownReceipt.coverage.includes(k) && incumbentReceipt.coverage.includes(k),
        )
      : null
    observations.get(candidate.id).push({ tier, result: r, comparison, coverageConfirmed })
    const input = { candidateId: candidate.id, observations: observations.get(candidate.id) }
    const aggregate =
      typeof ctx.duoComparator.aggregate === 'function'
        ? ctx.duoComparator.aggregate(freeze(clone(input)))
        : aggregateJudgments(input)
    const request = freeze(
      clone({
        candidateId: candidate.id,
        aggregate,
        next,
        selected,
        affordability,
        terminalSelected,
      }),
    )
    let d =
      typeof ctx.duoGate.decide === 'function'
        ? ctx.duoGate.decide(request)
        : decideEvidence(request)
    if (
      !d ||
      !['reject', 'hold', 'promote', 'request_more_evidence', 'stop'].includes(d.action) ||
      typeof d.reason !== 'string' ||
      !d.reason ||
      !Array.isArray(d.evidence_gaps) ||
      !d.basis ||
      (d.action === 'request_more_evidence' &&
        (!selected ||
          !next?.available ||
          affordability.remaining < 1 ||
          d.request?.tier !== next.tier)) ||
      (d.action === 'promote' &&
        (next ||
          !['better', 'not_better'].includes(comparison.verdicts[candidate.id]) ||
          coverageConfirmed === false))
    )
      fail(
        'DUO_EVIDENCE_DECISION_INVALID',
        'Policy decision must reference current comparable evidence and an admitted planned acquisition; it cannot bypass budget or coverage',
      )
    // A policy permits promotion; the lifecycle has one terminal slot.
    // Preserve the proposal when rank-based arbitration consumes that slot.
    if (d.action === 'promote' && selectedCandidateId)
      d = {
        ...d,
        action: 'hold',
        reason: 'ANOTHER_CANDIDATE_SELECTED',
        policyProposal: { action: d.action, reason: d.reason },
        selectedCandidateId,
        basis: {
          ...d.basis,
          inference: [
            ...(d.basis.inference ?? []),
            'A higher-ranked policy-admissible candidate occupies the terminal slot',
          ],
        },
      }
    if (d.action === 'stop') {
      searchStopped = true
      stopReason = 'evidence_policy_stop'
    }
    j.append({
      kind: 'evidence_decision',
      candidateId: candidate.id,
      generation,
      policy: providers.policies.duoGate,
      decision: clone(d),
    })
    return d
  }
  for (const [index, stage] of stages.entries()) {
    if (!eligible.length || searchStopped) break
    const { tier } = stage,
      results = []
    if (!championEvidence[tier]) {
      championEvidence[tier] = await evaluate(champion, tier)
      assessIncumbent(champion, championEvidence[tier], tier)
    }
    for (const c of eligible) {
      const r = await evaluate(c, tier)
      results.push(r)
      measured.get(c.id)[tier] = r
      record(c, { status: r.ok ? tier + '_evaluated' : 'error', [tier]: r })
    }
    const comparison = compare([championEvidence[tier], ...results], tier, champion.id)
    j.append({ kind: 'comparison', tier, generation, comparison })
    for (const c of [champion, ...eligible])
      record(c, {
        [tier + 'Score']: comparison.scores[c.id] ?? null,
        [tier + 'Verdict']: comparison.verdicts[c.id],
        [tier + 'Rank']: comparison.ranking.indexOf(c.id),
      })
    const next = stages[index + 1]
    if (!next) {
      let id = comparison.ranking.find(
        (id) => id !== champion.id && comparison.verdicts[id] === 'better',
      )
      if (strategic) {
        id = null
        const byId = new Map(eligible.map((c) => [c.id, c]))
        const ordered = [
          ...comparison.ranking.filter((key) => byId.has(key)),
          ...eligible
            .map((c) => c.id)
            .filter((key) => !comparison.ranking.includes(key))
            .sort(),
        ]
        for (const candidateId of ordered) {
          if (searchStopped) break
          const c = byId.get(candidateId)
          const decision = decide(
            c,
            comparison,
            tier,
            null,
            false,
            null,
            !id && comparison.verdicts[c.id] === 'better',
            id,
          )
          record(c, {
            status:
              decision.action === 'promote'
                ? 'champion'
                : decision.action === 'reject'
                  ? 'rejected'
                  : 'held',
            slowDecision:
              decision.action === 'promote'
                ? 'accepted'
                : decision.action === 'reject'
                  ? 'rejected'
                  : 'held',
          })
          if (decision.action === 'promote' && !id) id = c.id
        }
      }
      if (stages.length > 1 && !strategic)
        for (const c of eligible)
          record(c, {
            status:
              c.id === id
                ? 'champion'
                : comparison.verdicts[c.id] === 'not_better'
                  ? 'rejected'
                  : 'held',
            slowDecision:
              c.id === id
                ? 'accepted'
                : comparison.verdicts[c.id] === 'not_better'
                  ? 'rejected'
                  : comparison.verdicts[c.id] === 'better'
                    ? 'held'
                    : 'incomparable',
          })
      if (id) {
        champion = eligible.find((c) => c.id === id)
        championEvidence = measured.get(id)
      }
      break
    }
    const snapshot = budget.snapshot(),
      legacyRemaining = Math.max(
        0,
        Math.min(
          next.maxEvaluations - stageAttempts[next.tier],
          spec.budget.maxSlowEvals - snapshot.slowAttempts - (spec.final ? 2 : 0),
        ),
      )
    const affordability = strategic
      ? affordableAcquisitions({
          snapshot,
          limits: spec.budget,
          executor: providers.executor,
          evaluator: providers.evaluators.find((d) => d.tier === next.tier),
          stageRemaining: next.maxEvaluations - stageAttempts[next.tier],
          evaluationRemaining:
            spec.budget.maxSlowEvals - snapshot.slowAttempts - (spec.final ? 2 : 0),
          baselineNeeded: !championEvidence[next.tier],
          finalReserved: spec.final ? 2 : 0,
        })
      : null
    const remaining = strategic ? affordability.remaining : legacyRemaining
    const gateLimits = {
      topK: stage.topK,
      remaining,
      incumbentId: champion.id,
      epsilon: spec.epsilon,
    }
    let promoted = ctx.duoGate.select(
      comparison,
      eligible.map((c) => c.id),
      gateLimits,
    )
    if (
      !Array.isArray(promoted) ||
      new Set(promoted).size !== promoted.length ||
      promoted.length > Math.min(stage.topK, remaining) ||
      promoted.some(
        (id) =>
          !eligible.some((c) => c.id === id) ||
          !['better', 'not_better'].includes(comparison.verdicts[id]),
      )
    )
      fail(
        'DUO_GATE_INVALID',
        'Gate must select unique valid candidate evidence within the frozen limits',
      )
    if (strategic) {
      const nextOption = plan.evidenceStrategy.additional_options.find((o) => o.tier === next.tier),
        admitted = []
      for (const c of eligible) {
        const chosen =
          promoted.includes(c.id) || (remaining === 0 && comparison.verdicts[c.id] === 'better')
        const decision = decide(c, comparison, tier, nextOption, chosen, affordability)
        if (decision.action === 'request_more_evidence') admitted.push(c.id)
        else record(c, { status: decision.action === 'reject' ? 'rejected' : 'held' })
      }
      promoted = admitted
    }
    j.append({
      kind: 'gate',
      generation,
      fromTier: tier,
      toTier: next.tier,
      policy: providers.policies.duoGate,
      limits: gateLimits,
      considered: eligible.map((c) => c.id),
      selected: promoted.map((candidateId) => ({
        candidateId,
        verdict: comparison.verdicts[candidateId],
        score: comparison.scores[candidateId],
        reason:
          comparison.verdicts[candidateId] === 'better'
            ? index === 0
              ? 'FAST_BETTER'
              : 'STAGE_BETTER'
            : Math.abs(comparison.scores[candidateId] - comparison.scores[champion.id]) <=
                spec.epsilon
              ? 'WITHIN_EPSILON_DEEPER_TEST'
              : 'PROVIDER_DEEPER_TEST',
      })),
    })
    eligible = promoted.map((id) => eligible.find((c) => c.id === id))
  }

  return { champion, championEvidence, searchStopped, stopReason }
}
