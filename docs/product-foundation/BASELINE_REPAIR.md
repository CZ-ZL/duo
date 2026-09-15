# Baseline quality repair — bounded product follow-up

Status: COMPLETE — LOCAL ENGINEERING AND PACKAGED DSH VERIFICATION.
Not published; the closed product and research Goals remain unchanged.
Source: independent Caller trial on 2026-09-15, followed by the owner's approval
to fix the optimization entry limitation. This is local product development,
not a new method experiment or permission to use paid models.

Observed defect: the controller refuses a measured baseline that violates a
quality constraint. The default comparator also makes a feasible challenger
incomparable when the incumbent has no feasible score.

Approved behavior: a safely executable baseline with valid, scoped measurements
may start repair despite quality violations. Failed, missing, malformed or
insufficient evidence still cannot justify search. Candidates must meet the
unchanged constraints at every selection stage. The default comparator prefers
feasibility over an infeasible incumbent; otherwise its weighted/epsilon rule
stays unchanged. Permission, budget, receipt and deployment boundaries remain.

| Task | Completion condition | Status |
|---|---|---|
| R1 Reproduce | Tests catch rejected repair and incomparable feasible challenger; invalid evidence controls retained | COMPLETE: red.log, 9 tests, 1 pass/8 failures (behavior failures plus absent diagnostic field) |
| R2 Minimal repair | Existing comparator/controller allow valid repair; all-infeasible search returns no qualified selection | COMPLETE: native-2.log, 331/331 PASS; baseline-repair and expanded Slow controls |
| R3 Public explanation | Plan, status, Journal, report and guide expose baseline violations and repair limits | COMPLETE: host-1 reports, synchronized Agent Guide/current status, public declarations/typecheck |
| R4 Verify and review | Relevant native suite, types/docs/package/DSH local entry checks; diff and receipts retained | COMPLETE: package-report.json, host-1/RESULT.json (5 profiles/26 commands), format/docs/types and diff checks |

Limit: this does not add multi-step search through infeasible parents. A candidate
that still violates a constraint is not promoted. Final measurements stay outside
search. Successful search alone is not independent validation or deployment.

Evidence directory (workspace-local, outside published source):
`dualloop/runs/product-baseline-repair-20260915/`.

Implementation: existing weighted/exclusion comparator providers are version 2;
no new service, strategy framework or contract input is required. The controller
uses one admission helper for eager and lazy baseline tiers. A shared Journal
projection supplies pause/result/report diagnostics. Final recommendations allow
a valid violating reference, but never a violating/invalid challenger. Original
targets and historic receipts are not written or re-evaluated by this follow-up.

Lean review: redundant candidate recording found by two existing regression tests
was removed instead of weakening the tests. The separate baseline-assessment
event remains; settled measurements are recorded once. Native first pass was
329/331; the corrected pass is 331/331. Both logs are retained.

Packaged controls: basic repair (5 operations), expanded Slow repair (9), custom
Target repair (5), impossible requirement/no selection (5), and exhausted session
allowance before generation (2). Total 26 settled local operations, CNY 0, zero
model requests. The basic case pauses/resumes; each original target remains
byte-identical. Package member/export/license/peer and source-byte checks passed.
The acceptance script is now included in release_gate.sh for future CI runs.

Boundaries: this is deterministic engineering acceptance, not a new independent
Caller, live model, method or business-effect test. No new GitHub CI, full release
gate, clean dependency installation, push or publication was performed in this
follow-up. The working package version is still 0.6.0; the official v0.6.0 release
and historical acceptance are unchanged. A future published artifact needs its
own release version and delivery checks. No fresh session is needed to inspect
the local changes; consumers must load the updated package and create a new plan.
