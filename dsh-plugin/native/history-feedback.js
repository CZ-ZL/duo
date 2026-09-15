import { ConservativeFeedback, WeightedComparator, finite } from './policies.js'
import { freeze } from './contract.js'
import { digest } from './store.js'
import { fail } from './definitions.js'
import { balancedHistoryOrder } from './warm-start.js'
import { tierNamePattern } from './stages.js'

const scopeKeys = ['candidateId', 'evaluatorId', 'version', 'dataId', 'tier']
function rules(config = {}) {
  const list = structuredClone(config.exclusions ?? [])
  if (
    !Array.isArray(list) ||
    list.some(
      (r) =>
        !r ||
        Object.keys(r).sort().join(',') !== 'candidateId,dataId,evaluatorId,reason,tier,version' ||
        [...scopeKeys, 'reason'].some((k) => typeof r[k] !== 'string' || !r[k].trim()) ||
        !(tierNamePattern.test(r.tier) || r.tier === 'final'),
    )
  )
    fail(
      'DUO_EXCLUSIONS_INVALID',
      'Each frozen exclusion requires exact candidate/evaluator/version/data/tier identities and an owner-supplied reason',
    )
  return freeze(list)
}
export const excludedBy = (result, exclusions) =>
  result ? exclusions.find((rule) => scopeKeys.every((k) => rule[k] === result[k])) : undefined
export class ExclusionComparator extends WeightedComparator {
  constructor(ctx, config) {
    super(ctx)
    this.exclusions = rules(config)
  }
  describe() {
    return {
      id: 'weighted_exclusions_v1',
      version: '2',
      deterministic: true,
      constraintPolicy: super.describe().constraintPolicy,
      exclusionsDigest: digest(this.exclusions),
    }
  }
  compare(results, spec, incumbentId = null) {
    const exclusions = Object.create(null)
    const admitted = results.map((r) => {
      const rule = excludedBy(r, this.exclusions)
      if (!rule) return r
      exclusions[r.candidateId] = {
        code: 'DUO_EVIDENCE_EXCLUDED',
        reason: rule.reason,
        scope: rule,
      }
      return { ...r, ok: false }
    })
    return {
      ...super.compare(admitted, spec, incumbentId),
      comparatorId: this.describe().id,
      exclusions,
    }
  }
}
function measurement(value, exclusions) {
  if (!value) return null
  const excluded = excludedBy(value, exclusions)
  return {
    ...Object.fromEntries([...scopeKeys, 'ok'].map((k) => [k, value[k] ?? null])),
    metrics: Object.fromEntries(
      Object.entries(value.metrics ?? {}).filter(([, v]) => finite(v) || typeof v === 'boolean'),
    ),
    excluded: !!excluded,
    exclusionReason: excluded?.reason ?? null,
  }
}
export class HistoryFeedback extends ConservativeFeedback {
  constructor(ctx, config) {
    super(ctx)
    this.exclusions = rules(config)
    this.historyOrder = config?.historyOrder ?? 'balanced'
    if (!['balanced', 'recent_failures_first'].includes(this.historyOrder))
      fail('DUO_HISTORY_SELECTION_INVALID', 'Use a bounded declared history ordering policy')
  }
  describe() {
    return {
      id: 'conservative_history_feedback',
      version: '4',
      deterministic: true,
      exclusionsDigest: digest(this.exclusions),
      historyOrder: this.historyOrder,
      history: 'all_latest_candidates_ranked_by_recorded_fast_score',
      slowFeedback: 'same_run_search_v1',
      finalFeedback: false,
    }
  }
  orderHistory(records) {
    if (this.historyOrder === 'balanced') return balancedHistoryOrder(records)
    return records
      .map((_, i) => i)
      .sort(
        (a, b) =>
          Number(records[b].role === 'failure') - Number(records[a].role === 'failure') ||
          records[b].source.generation - records[a].source.generation ||
          a - b,
      )
  }
  summarize(entries, quotas, options = {}) {
    const tiers = options.tiers ?? ['fast', 'review', 'slow'],
      first = tiers[0] ?? 'fast',
      upper = tiers.length > 1 ? tiers[tiers.length - 1] : null
    const filtered = entries.map((e) => ({
      ...e,
      ...Object.fromEntries(
        tiers.map((tier) => [
          tier,
          excludedBy(e[tier], this.exclusions)
            ? { ...e[tier], ok: false, excluded: true }
            : e[tier],
        ]),
      ),
    }))
    const summary = super.summarize(filtered, quotas, options)
    const latest = new Map(entries.map((e) => [e.candidateId, e]))
    const history = [...latest.values()]
      .map((e) => {
        const fast = measurement(e[first], this.exclusions),
          slow = upper ? measurement(e[upper], this.exclusions) : null
        const admittedFast =
          fast?.ok === true &&
          !fast.excluded &&
          !['incomparable', 'constraint_violation'].includes(e[first + 'Verdict'])
        return {
          candidateId: e.candidateId,
          parentId: e.parentId ?? null,
          parentVersion: e.parentVersion ?? null,
          candidateVersion: e.candidateVersion ?? null,
          generation: e.generation ?? 0,
          mode: e.mode ?? null,
          family: e.family ?? null,
          operatorId: e.operatorId ?? null,
          hypothesis: e.hypothesis ?? null,
          delta: structuredClone(e.delta ?? null),
          fast,
          slow,
          ...Object.fromEntries(
            tiers
              .slice(1, -1)
              .filter((t) => e[t])
              .flatMap((t) => [
                [t, measurement(e[t], this.exclusions)],
                [t + 'Verdict', e[t + 'Verdict'] ?? null],
              ]),
          ),
          fastScore: admittedFast && finite(e[first + 'Score']) ? e[first + 'Score'] : null,
          fastVerdict: e[first + 'Verdict'] ?? null,
          slowDecision: slow?.excluded ? 'incomparable' : (e.slowDecision ?? null),
          slowVerdict: slow?.excluded
            ? 'incomparable'
            : upper
              ? (e[upper + 'Verdict'] ?? null)
              : null,
          status: e.status ?? null,
        }
      })
      .sort(
        (a, b) =>
          (b.fastScore ?? -Infinity) - (a.fastScore ?? -Infinity) ||
          a.generation - b.generation ||
          a.candidateId.localeCompare(b.candidateId),
      )
    return {
      ...summary,
      history,
      historyCompleteness: 'all_latest_candidates',
      historyLimitations: [
        'Scores are frozen comparator observations, not causal effects.',
        'No raw terminal/final outputs or evaluation evidence are exposed to generation.',
      ],
    }
  }
}
export default HistoryFeedback
