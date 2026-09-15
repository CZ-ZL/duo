import { aggregateJudgments, decideEvidence, projectStrategyFeedback } from './evidence-strategy.js'
import { ComparatorService, GateService, FeedbackService, fail } from './definitions.js'
import { tierNamePattern } from './stages.js'
export const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const sameScope = (a, b) =>
  ['evaluatorId', 'version', 'dataId', 'tier'].every((key) => a[key] === b[key])
const operators = {
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
}

export class WeightedComparator extends ComparatorService {
  describe() {
    return {
      id: 'weighted_v1',
      version: '2',
      deterministic: true,
      constraintPolicy: 'feasible_candidates_before_infeasible_incumbent',
    }
  }
  aggregate(request) {
    return aggregateJudgments(request)
  }
  compare(results, spec, incumbentId = null) {
    const weights = Object.entries(spec.weights ?? {})
    if (
      !weights.length ||
      weights.some(([, v]) => !finite(v)) ||
      !finite(spec.epsilon) ||
      spec.epsilon < 0
    )
      fail('DUO_COMPARISON_INVALID', 'Explicit finite weights and nonnegative epsilon are required')
    const incumbent = results.find((r) => r.candidateId === incumbentId)
    const scope = incumbent ?? results[0]
    const verdicts = Object.create(null),
      scores = Object.create(null),
      constraintViolations = Object.create(null),
      decisionBasis = Object.create(null),
      seen = new Set()
    const constraints = spec.constraints ?? []
    if (constraints.some((c) => !Object.hasOwn(operators, c.op)))
      fail('DUO_COMPARISON_INVALID', 'Unsupported constraint operator')
    for (const r of results) {
      if (seen.has(r.candidateId)) fail('DUO_EVIDENCE_INVALID', 'Duplicate candidate evidence')
      seen.add(r.candidateId)
      if (
        r.ok !== true ||
        !sameScope(r, scope) ||
        !r.metrics ||
        weights.some(([m]) => !finite(r.metrics[m])) ||
        constraints.some((c) =>
          typeof c.value === 'boolean'
            ? typeof r.metrics[c.metric] !== 'boolean'
            : !finite(r.metrics[c.metric]),
        ) ||
        (spec.minSamples > 0 &&
          (!finite(r.metrics.sample_size) || r.metrics.sample_size < spec.minSamples))
      ) {
        verdicts[r.candidateId] = 'incomparable'
        continue
      }
      const score = weights.reduce((sum, [m, w]) => sum + w * r.metrics[m], 0)
      if (!finite(score)) {
        verdicts[r.candidateId] = 'incomparable'
        continue
      }
      const violations = constraints
        .filter((c) => !operators[c.op](r.metrics[c.metric], c.value))
        .map((c) => ({ ...c, actual: r.metrics[c.metric] }))
      if (violations.length) {
        verdicts[r.candidateId] = 'constraint_violation'
        constraintViolations[r.candidateId] = violations
        continue
      }
      scores[r.candidateId] = score
    }
    const ranking = Object.keys(scores).sort((a, b) => scores[b] - scores[a] || a.localeCompare(b))
    for (const id of ranking) {
      const repairsIncumbent =
        incumbentId !== null && verdicts[incumbentId] === 'constraint_violation'
      verdicts[id] =
        incumbentId !== null && scores[incumbentId] === undefined && !repairsIncumbent
          ? 'incomparable'
          : repairsIncumbent ||
              incumbentId === null ||
              scores[id] > scores[incumbentId] + spec.epsilon
            ? 'better'
            : 'not_better'
      if (verdicts[id] !== 'incomparable')
        decisionBasis[id] = repairsIncumbent ? 'constraint_feasibility' : 'weighted_score'
    }
    return {
      ranking,
      verdicts,
      scores,
      constraintViolations,
      decisionBasis,
      comparatorId: 'weighted_v1',
    }
  }
}
export class TopKGate extends GateService {
  describe() {
    return { id: 'top_k_v1', version: '1', deterministic: true }
  }
  decide(request) {
    return decideEvidence(request)
  }
  select(comparison, candidateIds, { topK, remaining }) {
    if (![topK, remaining].every((x) => Number.isSafeInteger(x) && x >= 0))
      fail('DUO_BUDGET_INVALID', 'Gate limits must be nonnegative integers')
    return comparison.ranking
      .filter((id) => candidateIds.includes(id) && comparison.verdicts[id] === 'better')
      .slice(0, Math.min(topK, remaining))
  }
}
// Projection shared by default feedback and structured generation. Raw outputs,
// evaluator evidence and final measurements are never copied into search input.
export function slowSearchFeedback(entries, constraints = [], tier = 'slow') {
  if (typeof tier !== 'string' || !tierNamePattern.test(tier))
    fail('DUO_FEEDBACK_INVALID', 'Only configured search tiers may enter feedback')
  const observations = [...new Map(entries.map((e) => [e.candidateId, e])).values()].map((e) => {
    const r = e[tier],
      valid =
        r?.tier === tier &&
        r.candidateId === e.candidateId &&
        ['candidateId', 'evaluatorId', 'version', 'dataId'].every(
          (k) => typeof r[k] === 'string' && r[k],
        )
    return {
      candidateId: e.candidateId,
      generation: e.generation ?? 0,
      status: !r
        ? 'NOT_EVALUATED'
        : !valid
          ? 'INVALID_IDENTITY'
          : r.excluded
            ? 'EXCLUDED'
            : 'OBSERVED',
      [tier + 'Verdict']: valid ? (e[tier + 'Verdict'] ?? null) : null,
      [tier + 'Decision']: valid ? (e[tier + 'Decision'] ?? null) : null,
      [tier]: valid
        ? {
            ...Object.fromEntries(
              ['candidateId', 'evaluatorId', 'version', 'dataId', 'tier', 'ok'].map((k) => [
                k,
                r[k] ?? null,
              ]),
            ),
            excluded: r.excluded === true,
            metrics: Object.fromEntries(
              Object.entries(r.metrics ?? {}).filter(
                ([, v]) => finite(v) || typeof v === 'boolean',
              ),
            ),
          }
        : null,
    }
  })
  return {
    version: '1',
    purpose: 'same_run_search',
    availability: observations.some((o) => o.status === 'OBSERVED')
      ? 'OBSERVED'
      : observations.some((o) => o.status !== 'NOT_EVALUATED')
        ? 'UNUSABLE'
        : 'NOT_EVALUATED',
    constraints: constraints.map((c) => ({ metric: c.metric, op: c.op, value: c.value })),
    observations,
    limitation:
      'Frozen measurements and recorded comparator verdicts are observations, not causal explanations or proof that a strategy generalizes.',
  }
}
export class ConservativeFeedback extends FeedbackService {
  describe() {
    return {
      id: 'conservative_feedback_v1',
      version: '2',
      deterministic: true,
      slowFeedback: 'same_run_search_v1',
    }
  }
  summarize(
    entries,
    baseQuotas,
    {
      failureThreshold = 2,
      maxShift = 1,
      minSamples = 4,
      fastMetrics = ['quality'],
      upperMetric = 'quality',
      constraints = [],
      tiers = null,
      evidenceDecisions,
    } = {},
  ) {
    if (
      !Number.isSafeInteger(failureThreshold) ||
      failureThreshold < 2 ||
      !Number.isSafeInteger(maxShift) ||
      maxShift < 0 ||
      !Number.isSafeInteger(minSamples) ||
      minSamples < 2
    )
      fail('DUO_FEEDBACK_INVALID', 'Conservative feedback requires bounded thresholds')
    // First stage is the cheap proxy; the terminal stage is the validation
    // objective. Without a declared ladder, keep the legacy fast/slow names.
    const firstTier = tiers?.[0] ?? 'fast',
      upperTier = tiers ? (tiers.length > 1 ? tiers[tiers.length - 1] : null) : 'slow'
    const upperVerdict = upperTier ? upperTier + 'Verdict' : null
    const latest = new Map(entries.map((e) => [e.candidateId, e])),
      families = Object.create(null)
    const paired = Object.fromEntries(fastMetrics.map((m) => [m, []]))
    for (const e of latest.values()) {
      if (!e.family || e.family === 'baseline') continue
      const f = (families[e.family] ??= {
        failures: 0,
        n: 0,
        modes: new Map(),
        fastValues: [],
        slowValues: [],
      })
      f.modes.set(e.mode, (f.modes.get(e.mode) ?? 0) + 1)
      if (e[firstTier]?.ok === true && finite(e[firstTier].metrics?.[fastMetrics[0]]))
        f.fastValues.push(e[firstTier].metrics[fastMetrics[0]])
      const admittedSlow =
        upperTier &&
        e[upperTier]?.ok === true &&
        !['incomparable', 'constraint_violation'].includes(e[upperVerdict]) &&
        e.slowDecision !== 'incomparable'
      if (admittedSlow) {
        f.n++
        if (e.slowDecision === 'rejected') f.failures++
        if (finite(e[upperTier].metrics?.[upperMetric]))
          f.slowValues.push(e[upperTier].metrics[upperMetric])
      }
      if (e[firstTier]?.ok === true && admittedSlow && finite(e[upperTier].metrics?.[upperMetric]))
        for (const m of fastMetrics)
          if (finite(e[firstTier].metrics?.[m]))
            paired[m].push([e[firstTier].metrics[m], e[upperTier].metrics[upperMetric]])
    }
    const penalizedFamilies = Object.keys(families)
      .filter((f) => families[f].failures >= failureThreshold)
      .sort()
    const quotas = { ...baseQuotas }
    let shifts = 0
    for (const name of penalizedFamilies) {
      const src = [...families[name].modes].sort((a, b) => b[1] - a[1])[0][0],
        dst = src === 'exploit' ? 'explore' : 'exploit'
      if (shifts < maxShift && quotas[src] > 0) {
        quotas[src]--
        quotas[dst]++
        shifts++
      }
    }
    const average = (values) =>
      values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
    for (const f of Object.values(families)) {
      f.fastAvg = average(f.fastValues)
      f.slowAvg = average(f.slowValues)
      delete f.modes
      delete f.fastValues
      delete f.slowValues
    }
    const fastSlowCorrelation = Object.fromEntries(
      fastMetrics.map((m) => {
        const pairs = paired[m]
        if (pairs.length < minSamples) return [m, 'insufficient_data']
        const ax = average(pairs.map((p) => p[0])),
          ay = average(pairs.map((p) => p[1]))
        const cov = pairs.reduce((n, [x, y]) => n + (x - ax) * (y - ay), 0),
          vx = pairs.reduce((n, [x]) => n + (x - ax) ** 2, 0),
          vy = pairs.reduce((n, [, y]) => n + (y - ay) ** 2, 0)
        const correlation = vx && vy ? cov / Math.sqrt(vx * vy) : 0
        return [m, finite(correlation) ? correlation : 'insufficient_data']
      }),
    )
    const middleTiers = tiers && tiers.length > 2 ? tiers.slice(1, -1) : []
    return {
      ...(evidenceDecisions
        ? { evidenceDecisions: projectStrategyFeedback(evidenceDecisions) }
        : {}),
      penalizedFamilies,
      families,
      quotas,
      fastSlowCorrelation,
      slowFeedback: slowSearchFeedback(entries, constraints, upperTier ?? 'slow'),
      ...(middleTiers.length
        ? Object.fromEntries(
            middleTiers
              .filter((t) => entries.some((e) => e[t]))
              .map((t) => [t + 'Feedback', slowSearchFeedback(entries, constraints, t)]),
          )
        : entries.some((e) => e.review)
          ? { reviewFeedback: slowSearchFeedback(entries, constraints, 'review') }
          : {}),
      championLineage: [...latest.values()]
        .filter((e) => e.status === 'champion')
        .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))
        .map((e) => e.candidateId),
      failedRegions: penalizedFamilies.map((name) => ({
        family: name,
        fastAvg: families[name].fastAvg,
        slowAvg: families[name].slowAvg,
        slowFailures: families[name].failures,
      })),
      evidence:
        Object.values(families).reduce((n, f) => n + f.n, 0) < minSamples
          ? 'insufficient_data'
          : 'observed_family_outcomes',
    }
  }
}
