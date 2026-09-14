# Slow Loop: evidence acquisition and decisions

Slow is a bounded experiment strategy, not another score or a more expensive
LLM. It receives search measurements, identifies an evidence gap, admits a
planned acquisition within existing authority and limits, combines scoped
judgments and returns reject, hold, promote, request_more_evidence or stop.
It records observed judgments, rule-based inference and unknowns separately.

## Choose the public preset

Pass `preset` to dualloop_design and save its returned contract, including preset.
Do not remove preset when saving. Plan always recomputes live capabilities.

| Preset | Required inputs | Behavior |
|---|---|---|
| evaluate | Target, measurement objective and evaluator | Measure baseline; no Generator required |
| optimize-basic | Target, objective, evaluator and explicit budget | Single-fidelity generation/evaluation/selection; no Slow needed |
| optimize-dual | The above plus applicable additional evidence | Refuse preparation before work if evidence increment is unavailable |
| optimize-auto | Target, objective, evaluator, budget; optional additional source | Use qualified available evidence, otherwise show the single-fidelity limitation |
| optimize | Compatibility alias for optimize-auto | Same negotiation |

Each objective uses the existing evaluatorId/version/dataId/metric/direction/weights
shape. Configure `fast` and optionally `slow`, or the existing searchStages
schedule. `final` remains separate and never enters evidence requests or search
feedback. No preset grants permission, creates data, adjusts metrics or increases
an allowance. No evaluator is required merely to fill a second slot.

`dualloop_design.evidenceStrategy` and `dualloop_plan.evidenceStrategy` show
status, Fast and additional availability, active/skipped tiers, recommended_mode,
available modes, evidence gaps and suggested next steps. Preparation only checks
Target declarations; the real plan snapshots and validates the Target.
A usable Fast with no additional source is READY_WITH_LIMITATIONS. If configured
additional work is skipped, downgrade appears in plan, Journal and result.
Inspect planDigest again after any provider/configuration change. Unloading or
replacing a provider invalidates old plans; it cannot authorize replay.

## Evidence modes

**high_fidelity:** additional objective-relevant coverage plus an applicable
qualification reference (passed, versioned, objective metric) and declared
independence from search. State why it is closer to the goal. Price, model name,
provider name and different dataId do not qualify it. DUO validates the metadata
contract, not the truth of a provider's qualification claim. Read its controls.

**expanded_evidence:** same measurement family with explicitly new task, seed,
boundary or environment coverage. More coverage does not establish higher
fidelity. The execution receipt must confirm the planned coverage for both the
candidate and incumbent before promotion.

**unavailable:** no admissible information increment. Basic/auto continue on
available development evidence. The result is not complete dual-loop validation.
Forced dual returns DUO_ADDITIONAL_EVIDENCE_REQUIRED with a preparation action
and no dispatched work. You may add held-out tasks, new seeds, boundary checks,
a separately qualified reviewer, human review or a production metric, or
explicitly choose basic. These are preparation options, not automatic calls.

Old contracts **without preset** retain their authored execution and legacy
mode/result fields. Unqualified repeated stages are explicitly labeled
unavailable, not complete dual validation. They are retained for compatibility,
not the default product path. Migrate a new experiment through design; do not
rewrite historical experiments or remove their old records.

## Self-describing source

Add `evidenceSource` to an EvaluatorsService descriptor. Missing metadata remains
unknown; it is not a default confidence, price or safety assertion. Existing
identity, metrics, permissions, CNY reservation and implementation/data/config
hashes remain unchanged.

```js
{
  id: 'boundary-checks', version: '2', dataId: 'dev-boundaries-v2', tier: 'slow',
  // existing metrics, metricDefinitions, permissions and reservationCny fields
  evidenceSource: {
    measurement: 'Pass rate on supplied boundary assertions',
    targetKinds: ['my-target'], family: 'executable_tests',
    coverage: ['basic-cases', 'empty-input', 'maximum-size'],
    dataScope: { id: 'boundaries-v2', purpose: 'search', description: 'Development boundary cases; never final' },
    independentOfSearch: false, realTools: true, deterministic: true,
    requiresModel: false, approximateCost: { currency: 'CNY', amount: 0 },
    latencyMs: null, sideEffects: 'Isolated temporary files only',
    increment: {
      relativeTo: { id: 'fast-checks', version: '1', dataId: 'dev-basic-v1' },
      kind: 'expanded_evidence',
      reason: 'Execute empty and maximum-size inputs absent from Fast coverage'
    }
  }
}
```

For high_fidelity, increment.kind changes and increment.qualification includes
`{status:'passed',reference:'retained-control-evidence',version:'1',metric:'quality'}`.
The provider declares independentOfSearch:true only if that boundary is real.
Unknown/unreviewed qualification cannot be replaced by an arbitrary confidence.
`dataScope.purpose` is search, final or control; a source marked final/control
cannot be bound to a search tier.

Evaluations return their usual scoped metrics, receipts and raw evidence plus
`evidenceCoverage: ['basic-cases','empty-input','maximum-size']` naming checks
actually executed. Missing/new coverage not confirmed → hold, with an explicit
gap. The function-evaluators adapter preserves this receipt. Metadata and
coverage are trusted provider statements, not an OS containment mechanism or
independent proof that tests really ran.

## Existing plugin boundaries

| Responsibility | Existing seam | Default behavior |
|---|---|---|
| Produce observations | EvaluatorsService.evaluate | Caller-defined measurement; Executor remains separate |
| Compare and combine | Comparator.compare + optional aggregate | Compare only same evaluator/version/data/tier; combine verdicts without adding unlike scores |
| Decide spend/continue | Gate.select + optional decide | Strict improvement/top-K admission, bounded evidence request; hold missing evidence or budget; stop halts subsequent search/final work |
| Search feedback | Feedback.summarize; safe strategy projection | Search-only numeric judgments, identities and decisions; no final or raw artifacts |

`aggregate({candidateId, observations})` receives scoped results and comparisons,
not final. It returns observed judgments, conflict and unknowns. `decide` receives
candidateId, aggregate, the next frozen evidence option, selection state,
affordability and terminalSelected. It returns action, reason, evidence_gaps,
request (or null), costConstraint and basis:{observed,inference,unknown}.
Public helpers in `/evidence-strategy` implement the default fallbacks; see the
shipped `/definitions` types. Existing compare/select-only providers still work.

The current strategy is deliberately bounded: the owner freezes the provider
schedule; Gate can request/decline its next applicable source, hold, reject,
promote or stop. It does not discover/install providers, invent new tests,
reorder an arbitrary marketplace, estimate expected information gain, or retry
failed acquisition. Evidence-gap type/coverage explains whether the next source
addresses boundaries, more samples or conflicting judgments. Default terminal
selection remains strict and scoped; it does not learn aggregation weights.

The missing incumbent measurement is acquired lazily only after a candidate is
admitted. Executor + evaluator reservations, missing incumbent work, operation
limits and remaining Fast/Slow allowance constrain admission. The existing
ledger still reserves/settles each actual call. Unknown cost/cancellation and
supported settled-checkpoint recovery retain their original boundaries.

Graph Structured Evaluation belongs in an Evaluator/evidence reasoning provider.
Bayesian belongs in Comparator aggregation or Gate decision policy, only after
reliability can be estimated from calibration data. Neither is implemented;
there is no posterior/probability schema or invented confidence in Core.

## Results and history

Run and report include optimization_mode, slow_mode, evidence_used,
additional_evidence_acquired, evidence_gaps, decision_basis, limitations and any
downgrade. Read dual_loop_validation separately: a planned dual mode whose
candidates never obtain additional evidence is NOT_OBSERVED. Source/version,
actual coverage and every decision are retained in the Journal. Failed and
paused runs preserve partial evidence rather than claiming completion.

Warm start compares evidence modes as well as existing provider/data/config
conditions. Changed/unknown modes retain permissible ideas only, not comparable
scores. Old final evidence, raw answers, costs and authority never enter search.
Complete dual-loop means additional candidate evidence was actually acquired and
used under the declared objective boundary. It still does not prove independent
final generalization, calibration validity or superiority over another method.

Local usage: `duo init ... --example optimize` runs basic. `--example dual` adds
real local template-boundary assertions and reports expanded_evidence. Both
are product behavior demonstrations at CNY 0, not Agent quality benchmarks.

## Selection and budget consistency

Terminal candidates are considered in Comparator rank order. A candidate with
missing coverage or a policy hold leaves the slot available to an admissible
runner-up. Gate promotion eligibility is distinct from actual selection: each
generation has one terminal selected candidate. If another candidate is eligible,
its effective decision is hold / ANOTHER_CANDIDATE_SELECTED; policyProposal and
selectedCandidateId preserve the proposal and the selected identity. Journal,
report and search feedback use the effective decision, not multiple winners.

Cumulative admission counts settled cost plus the full retained allowance of
unfinished runs, including paused runs. A new contract cannot spend an allowance
promised to another run in the same currency and Journal root. Unknown costs
stop relevant admission. Actual claim/initialization uses a short exclusive
Journal admission lock; plan checks are advisory and execution rechecks. A busy
lock is not corrupted storage. After a crash, inspect its recorded Linux owner
and retained state before manual recovery; DUO never steals an unverified lock.
The existing operation ledger remains the only accounting authority. Costs in
different currencies are never converted or merged.
