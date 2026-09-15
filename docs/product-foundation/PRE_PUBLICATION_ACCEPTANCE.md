# Pre-publication acceptance contract — 0.6.1

Frozen scope: 2026-09-16. The owner requested a complete repository audit and
release preparation before public exposure. This contract does not authorize
changing repository visibility, publishing npm packages, running paid models,
new benchmarks or reopening closed Goals. The existing bounded release closeout
and historical evidence remain intact.

## Decision and stopping rule

This is a Linux developer-preview product release, not a production-security
certification or evidence of optimization superiority. Public exposure requires
every REQUIRED row below to PASS against the release inputs. An explicitly
supported limitation can be ACCEPTED_LIMITATION only with its scope and user
impact documented; it cannot substitute for a failed required journey.
FAIL, BLOCKED and NOT_RUN remain distinct and prevent a READY verdict on a
required item. Earlier evidence is reusable only after relevant input checks,
with the earlier run identified. Scripted checks never become independent Caller
acceptance merely by being renamed.

Release blockers: exposed sensitive material; incorrect or missing license;
broken installation or promised public journey; incorrect selection/evidence;
budget/permission/provenance violations; evidence loss; misleading release
claims; missing exact-version required verification. Fix and rerun affected
checks only. Other refactoring, integrations and UX preferences go to backlog.
No additional business task, paid benchmark or positive research result is
required to close this release. Do not expand this contract during testing
without recording a material reason and the owner's scope decision.

## Required checks

| ID | Area | Observable pass condition and method |
|---|---|---|
| A01 | Repository and history exposure | Inventory all tracked and intended new files, all reachable local Git history, remote refs and release archive; inspect sensitive-pattern hits without printing secrets. No unresolved credentials/private profiles/raw ledgers/user data; state scan limits and unexamined GitHub surfaces. |
| A02 | License and dependencies | Root/package MIT and attribution agree; package exports resolve; declared dependencies/host versions and install scripts reviewed. Record dependency inventory and advisory-check scope; no known unresolved release-blocking issue in supported use. |
| A03 | Architecture and plugin boundary | Trace public lifecycle to Target, Generator, Executor, Evaluator, Comparator/Gate, Feedback, History, Journal and Budget. Supported component replacement works through existing public contracts; identify target-specific code and remaining coupling without gratuitous redesign. |
| A04 | Capability and readiness | Schema, describe, generated status and guides agree; missing Target/evaluator/objective has actionable preparation output; partial support is explicit. |
| A05 | Evidence semantics | Local controls distinguish correct/incorrect outputs; evaluate/basic/dual/auto report actual evidence mode, gaps and limitations. Missing additional evidence cannot silently become dual-loop; control/final data cannot enter search. |
| A06 | Money, permissions and durability | Tests cover reviewed plan binding, reservations, cancellation, failed/unknown-cost receipts, append-only evidence and denied unauthorized effects. Trusted-provider and Caller-cost boundaries are explicit; no real paid work is needed. |
| A07 | Recovery and delivery | Public status/report retrieval works; settled unchanged-checkpoint recovery avoids repeat charges; unsupported recovery is refused with action/cost state. Upgrade/rollback guidance does not instruct blind replay. |
| A08 | History and warm start | Compatible history actually reaches generation; incompatible versions/evidence modes and control/final data are filtered; ideas-only evidence is not relabeled comparable. |
| A09 | Package installation | Exact tarball passes fresh profile AND fresh dependency-store install, registration, CLI and plan/run/report. Cached-host checks are separate evidence and cannot replace this gate. |
| A10 | Regression and CI | Existing release_gate.sh completes on supported environment; native/Python product/package/types/docs/DSH checks retain failures and exclusions. Exact release-code commit has successful CI; later docs-only evidence commits are identified separately. |
| A11 | Independent Agent use | Review existing blank-Caller receipts for documented inputs, interventions, failures and supported outcomes. Record input-level reuse rationale; any changed journey not covered by those receipts remains scripted-only or requires a bounded Caller recheck before claiming Agent verification. No invented autonomous-use claim. |
| A12 | Release-facing documentation | Bilingual README, current support, version-specific notes/changelog, minimal local quickstart, upgrade/rollback and fault guidance agree and resolve. Historical research docs are explicitly historical; no private author path required on default path. |
| A13 | Version and distribution trace | Record version, source manifest, exact commit/tree, tarball SHA256, installation evidence and CI URL; all promoted artifacts are scanned. Owner explicitly authorizes actual public exposure. Historical failed archives are retained locally but not distributed as the release. |

## Audit execution queue

1. Snapshot current files/status and freeze this contract; preserve concurrent work.
2. Inventory repository/archive/history and review the critical runtime/public paths.
3. Reconcile earlier receipts with current inputs; run missing or affected local checks.
4. Complete bounded release notes, quickstart/fault/rollback guidance and evidence index;
   fix only substantiated release-preparation defects.
5. Check final diff and doc links; save the audit report with PASS/FAIL/BLOCKED/NOT_RUN,
   original failed attempts, evidence sources and the next executable action.

Artifacts use the existing `dualloop/runs/pre-publication-audit-20260916/`
local run directory and a sanitized report beside this contract. No new scheduler
or Goal API is introduced. No background execution is promised.
