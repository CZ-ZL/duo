import Schema from '@deepseek-ai/schemastery'
import { TopKGate, finite } from './policies.js'
import { fail } from './definitions.js'

// An optional provider for deeper measurement, never a new adoption rule.
export default class BoundedTieGate extends TopKGate {
  static Config = Schema.object({ maxTies: Schema.natural().required() })
  constructor(ctx, config) {
    super(ctx)
    if (!Number.isSafeInteger(config?.maxTies) || config.maxTies < 0)
      fail('DUO_BUDGET_INVALID', 'A finite nonnegative maxTies is required')
    this.maxTies = config.maxTies
  }
  describe() {
    return {
      id: 'bounded_tie_gate_v1',
      version: '2',
      deterministic: true,
      maxTies: this.maxTies,
      limitScope: 'per_transition_per_generation',
      purpose: 'deeper_measurement_only',
    }
  }
  select(comparison, candidateIds, limits) {
    const improved = super.select(comparison, candidateIds, limits),
      { incumbentId, epsilon, topK, remaining } = limits
    const incumbent = comparison.scores?.[incumbentId]
    if (!finite(incumbent) || !finite(epsilon) || epsilon < 0)
      fail(
        'DUO_COMPARISON_INVALID',
        'Tie exploration requires the measured incumbent score and frozen epsilon',
      )
    const slots = Math.min(this.maxTies, Math.max(0, Math.min(topK, remaining) - improved.length))
    const ties = comparison.ranking.filter(
      (id) =>
        id !== incumbentId &&
        candidateIds.includes(id) &&
        comparison.verdicts[id] === 'not_better' &&
        finite(comparison.scores[id]) &&
        Math.abs(comparison.scores[id] - incumbent) <= epsilon,
    )
    return [...improved, ...ties.slice(0, slots)]
  }
}
