# DUO public reference

The live dualloop_describe schema is authoritative. CURRENT_STATUS.md is generated from the same capability catalog. PROVIDERS.md describes public component interfaces.

## Before configuration

Three starts: complete inputs; missing evaluator with existing samples/tests; or unclear goal. dualloop_design returns unresolved inputs and resource-backed suggestions. It does not read resources or grant authority. Optional context contains intent, measurementGoal (task_result/format/cost), and resources with kind/ref/summary/readAuthorized. Only confirmed goals become objectives.

Evaluator discovery covers the active EvaluatorsService, not a marketplace. Service.listService is a coding contract catalog, not a live registry. An uncatalogued supplied service can exist. Bring/Find/Build/Compose use existing host tools and the /function-evaluators adapter; no automatic evaluator invention.

## Start a new experiment with native history

Use warmStart:{runIds:["observed-id"],maxRecords:6,maxContextBytes:8192}. Only authorized IDs in the configured Journal are inspected. Target identity/lineage, provider/evaluator versions, data purposes and environment are screened. Changed conditions become ideas-only; invalid/incompatible records are excluded. Empty history is cold start. Fixtures default to excluded; explicit fixturePolicy:"ideas_only" never treats fixture scores as real observations.

The Target adapter validates snapshots and projects its own Delta. Generation receives bounded search records, never final rows, raw answers or old costs. A new dataId does not prove unseen data. Keep final outside search/Caller preparation; consumed final cannot be described as unseen. The local text example has no independent final-quality claim.

## Failure and recovery

Read status/report/budget using the known runId. An unchanged terminal run returns retained artifacts without repeated work. Pause requires resumeFrom:checkpoint.digest. Supported boundaries are settled baseline/generation; original deadline includes pause time. Changed inputs, pending/unknown work or receipt drift prevent continuation.

Public errors preserve DSH isError/code and add cause, component, nextAction, recoverability, costState and sideEffectState. Retryable input correction is not paid retry authorization. Unknown cost blocks further paid work. Reconcile only an observed staged receipt; estimates cannot clear unknown exposure.

## Supported replacement

TargetService: snapshot/apply, identity, and explicit snapshot validation/Delta projection for warm start. GeneratorService: propose. ExecutorService: execute. EvaluatorsService: evaluate. ComparatorService aggregates admitted metrics. GateService controls promotion. FeedbackService summarizes evidence and may return bounded orderHistory indices. Cordis owns registration and lifecycle; DUO has no parallel registry.

Profile config patches replace whole row config. Missing dependencies keep execution unavailable; discovery remains available in the setup composition. A provider declaration is not proof of measurement quality or isolation.

## Delivery and limits

Reports distinguish execution, rendered artifacts and observed Caller delivery. Rendering takes zero model calls; it does not prove a Caller read the result. The native budget excludes external Caller requests. Trusted providers run in-process. No arbitrary provider sandbox, Windows/macOS ownership support, automatic adoption or automatic interrupted-call replay is promised. Linux/Node24 and the documented DSH snapshot define the supported foundation. Method superiority remains unproven.

## Slow evidence strategy

Read EVIDENCE_STRATEGY.md for public presets, metadata, coverage receipts, bounded acquisition, aggregation/decision hooks, result modes and legacy boundaries. No extra evidence is required for optimize-basic. Graph/Bayesian are extension locations only, not implementations.


### Cumulative admission and terminal selection (0.6.0)

An unfinished run retains its full frozen allowance, including while paused.
A new run must fit beside those allowances and settled costs under the shared
Journal's cumulative cap; a remaining account balance is not new authority.
DUO_BUDGET_ADMISSION_BUSY means another admission is in progress or its lock
requires owner inspection. Inspect status and retry only after the owner has
finished; never remove a live or unverified lock. No work was admitted by that
failed request. Recovery does not renew the original allowance or deadline.

One terminal candidate is actually selected per generation. Policy eligibility
is retained as policyProposal when another candidate occupies that slot. Read
the effective decision and report selection, not just a provider's proposal.
A higher-scoring candidate missing required coverage does not suppress a valid
runner-up. This is product selection consistency, not evidence of method benefit.

## Baseline constraints and repair

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
