# F01 repair and repository presentation follow-up

Date: 2026-09-16. Status: LOCAL_PRODUCT_CHECKS_PASS; exact-commit CI and
dependency advisories pending. This follows the frozen
[pre-publication audit](PRE_PUBLICATION_AUDIT.zh.md); its failures and original
artifact remain unchanged.

## Defect and minimal repair

A custom Target could return original snapshot ID `original`. Planning accepted
it, but final execution assumed the literal ID `baseline`, executed that same
snapshot twice and failed with `DUO_EVIDENCE_INVALID`. Reporting also counted
the original as a Slow-tested candidate and could mislabel final selection.

Controller now uses `plan.baseline.id` for original/champion comparisons and
final execution. Observer and evidence outcome use the plan's original identity;
their literal fallback applies only to old records without that field. The
report version is 9 and observer descriptor version is 7. The shipped custom
Target example is version 2 and returns `original`, exercising the extension
contract through the public installed path. Reinspect a plan after upgrading.

No scoring, promotion rule, budget, permission, historical candidate or final
dataset was changed by this identity repair.

## Fresh evidence

| Check | Observed result |
|---|---|
| Test-first identity regression | 7 cases: RED 1 PASS / 6 FAIL; GREEN 7 PASS |
| Native regression | 340 PASS / 0 FAIL |
| Python product regression | 451 PASS / 86 research tests deselected |
| Installed public examples | 73 checks / 97 steps / 14 isolated profiles, PASS |
| Installed Slow semantics | 31 checks / 22 steps, PASS |
| Installed baseline-repair controls | 5 cases / 26 commands, PASS |
| DSH compatibility | 21 profiles, PASS |
| Package structure/types/format | PASS; 69 shipped files |
| Cached-host package installation | PASS, actual DSH registration and execution |
| Fresh dependency store | BLOCKED locally: ERR_PNPM_META_FETCH_FAIL |
| Previous GitHub workflow artifact scan | 8 artifacts; 1,573 files/nested members; no sensitive-pattern hits or unreadable members |

The three new installed custom-ID cases cover retain-original, selected candidate
and evaluate-only with final. They observe respectively 4, 9 and 4 operations,
all ¥0. Their final stage is a local execution/reporting control, not an unseen
quality benchmark. No new independent Calling Agent trial is claimed.

New tarball SHA256:
`c53c183ba5fd16bb262c540ed77bbcc458575d30451e397c1672c4661b356221`.
The original unrepaired 0.6.1 tarball
`5fe28bdf5d041e6c2c955afde2737b04dc25610d2909663f8d68e4eff6e8ebf4`
remains a separate failed candidate; evidence is not merged between them.

Raw logs, before-file hashes, installed profiles, receipts and scan locations
are retained outside published source in
`dualloop/runs/pre-publication-f01-20260916/`.
New model requests: 0; model cost: ¥0.

## Organization and lean review

| Before | After | Why simpler / regression boundary |
|---|---|---|
| Original identity implicitly tied to a fixture name | Target-owned identity in execution and reports | Removes a target-specific assumption; regression and installed custom example above |
| README collapses both loops into one evidence node | Fast history return and Slow decision return shown separately | Checked against Controller generation/stage loop and Feedback input; no runtime change |
| Current usage, old plans and research tools compete for attention | Documentation map, current architecture and script map | Keeps established imports/exports/history paths; no directory move or new framework |
| Paper inspiration visible mainly in historical design | Bilingual origin sections and precise attribution | Separates concept, host dependencies and included fixture licenses |
| Historical CI artifacts not inspected after raw API failure | Downloaded through the normal GitHub CLI and scanned | All eight retained; earlier failed download attempt remains recorded |
| Advisory access unavailable locally | CI queries development and installed-host graphs, retains both reports and fails on access error or high/critical findings | Neither a cheaper host nor disabled TLS is substituted |

The current code remains organized around existing services. This pass does not
split Controller into new managers, move public exports, delete legacy APIs or
rewrite the execution engine merely to reduce line count.

## Remaining release boundary

Complete exact-code private CI, including fresh-store installation and advisory
review, and retain matching receipts. The private repository upload is authorized;
changing visibility and npm publication are not. Signature scans are bounded
checks, not a security certification. Product checks do not establish DUO method
superiority. New optional integrations and new business-task trials remain outside
this finite release gate.
