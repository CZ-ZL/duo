# Use DUO from an Agent

DUO evaluates or optimizes an existing Target inside DSH. Use it when the owner has an observable goal, an executable evaluator and permission to test changes. It returns evidence, candidate overlays and costs. Retaining the original is valid. It never automatically deploys a candidate. Format checks are not Agent task quality; product acceptance is not method superiority.

Read CURRENT_STATUS.md for support and examples/product/README.md for a free installed-package example. The default bundle exposes preparation while waiting for work providers.

1. **Discover:** `dualloop_describe({})` reports supported/partial Target capabilities, replacement seams, schemas, the active Target descriptor and evaluator declarations. Visible bindings alone are not a validated plan. `dualloop_discover` is the retained execution-composition view and requires a valid plan.
2. **Prepare:** `dualloop_design({preset:"evaluate"|"optimize-basic"|"optimize-dual"|"optimize-auto",draft,experimentPath,context})` is read-only. Presets fill lifecycle defaults, never the target, objective or paid authority. Supply id, target:{kind,path} and an explicit objective (fast for a simple case). Optimize needs an explicit budget; evaluate defaults to zero-cost local work. The returned draft/resolved.spec is the complete inspectable contract; retain its preset field. Basic needs only Fast; dual requires declared additional evidence; auto shows any fallback. The optimize alias means auto. Inspect evidenceStrategy and EVIDENCE_STRATEGY.md.
3. **Resolve missing inputs:** follow the combined issues/preparation list. Bring an evaluator, find a compatible visible provider, build a function adapter around existing tests, or compose measurement functions. Do not invent goals, answer keys, permissions or money. Check fixed correct/incorrect controls before using a measurement for search. A config Target needs a compatible Executor/Evaluator; persona execution does not establish config execution.
4. **Configure:** save the inspected contract using authorized host filesystem tools. Set duo-contract.config.experiment and duo-journal.config.root in your DSH profile. Attach work providers through existing DSH/Cordis interfaces. The deferred runtime exposes execution/report tools once dependencies are present. For no-generator evaluation use duo-runtime.config.evaluationOnly:true. If the host supplies authorized cordis_define/cordis_run tools, discover and use them; do not assume they exist.
5. **Plan:** `dualloop_plan({view:"summary"})` returns Target, providers, stages, limits, screened history and exact planDigest/runId. Inspect evidenceStrategy.status, slow_mode, active/skipped tiers and limitations. Price/model strength never establishes fidelity. Inspect full details when necessary. Changes require a new plan; a digest grants no permission. Reuse actual owner authorization.
6. **Run:** `dualloop_run({planDigest})` uses frozen limits; paused runs retain their cumulative allowance. Evaluation-only generates nothing. Unknown cost stops paid work. Never retry to discover a fee. Optional pauseAfter:"baseline" or "generation" requests a settled checkpoint.
7. **Read:** `dualloop_status({runId})`, `dualloop_report({runId,view:"summary"})` and `dualloop_budget_status({runId})` need no model calls. Report optimization_mode, slow_mode, additional_evidence_acquired, evidence_gaps, decision_basis, limitations, stage states and costs. A planned dual whose candidates never obtain additional evidence is NOT_OBSERVED. Unpromoted candidates have no later-stage score. Save the report through your host for a delivery artifact; rendered output alone is not a saved-file receipt.
8. **Reuse or recover:** warmStart:{runIds:[...]} creates a new experiment using screened history in the authorized Journal. It imports no old fees, final scores or authority. Changed evidence modes admit ideas only, not comparable measurements. Recovery instead uses the same planDigest and resumeFrom equal to status.checkpoint.digest. Original deadline/budget remain. No supported checkpoint means no automatic replay.
9. **Replace:** change one supported Cordis provider row, inspect its identity/permissions/contracts and re-plan. Removing a required provider retracts dependent tools. Target-specific history validation/projection is required for warm start. Legacy adapters without it remain limited.

An objective is {evaluatorId,version,dataId,metric,direction,weights}. Use the live schema for full authoring. Preset defaults are inspectable and may be overridden explicitly; missing owner decisions stay unresolved.

A baseline may have valid measurements but fail quality constraints. Inspect
plan.baselinePolicy: DUO can start repair from this original without requiring a
hand-repaired replacement. The default comparator favors a constraint-satisfying
candidate over a violating incumbent, even if its weighted score is lower;
otherwise weighted score and epsilon apply as before. Missing/failed/insufficient
evidence still stops search. Execution safety belongs to the host/Executor
permission boundary, not to a quality metric named "safe".

Read baselineAssessment for original violations, searchAllowed and the recorded
comparison. selectionOutcome describes search only: feasible_candidate,
baseline_retained or no_feasible_candidate. If no candidate meets the unchanged
constraints, DUO selects no solution and leaves the original untouched. There is
no multi-step promotion through still-infeasible parents. Inspect final evidence
and conclusion separately: feasible on development evidence is not independent
validation or authorization to deploy. Changed comparator versions require a new
plan; historical results remain sealed and may enter warm start only under the
existing compatibility rules.

Caller preparation and optional interpretation need their own host budget. The DUO ledger covers inner operations, not every Calling Agent request. Permission declarations are checked claims; the host enforces actual access. Existing authorization is reused; example files grant none.

For local CNY0 work keep permissions.paid:false and maxCostCny:0 on every run;
omit the optional maxCumulativeCostCny, which currently accepts positive amounts
only. Do not grant a positive allowance to bypass that validation. See the
packaged examples/product/README.md for control checks and actual warm history
fields: role/use/source/delta, not the candidate's private family field.

Failures expose cause, recoverability, nextAction (required action), costState and sideEffectState. UNKNOWN requires retained-evidence inspection, not inferred zero. dualloop_budget_reconcile applies only an observed already-staged receipt hash; it never creates usage evidence or repeats work.

See AGENT_REFERENCE.md and PROVIDERS.md in this package. Original profiles remain unchanged; adoption/rollback needs explicit host authorization. Python/YAML remains behind /legacy with separate schemas and ledgers.
