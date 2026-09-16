# Ecosystem distribution and Agent discovery — 2026-09-16

Current installable package: [v0.6.2](../releases/0.6.2/RELEASE_NOTES.md), with
[delivery evidence](../releases/0.6.2/DELIVERY_EVIDENCE.json). The existing catalog
PR5216 now references its verified tarball; upstream review remains pending.
The 0.6.1 distribution receipts below preserve that earlier delivery unchanged.

Status: DELIVERED; COMMUNITY CATALOG REVIEW PENDING. Owner approved the preceding distribution plan and improving Agent discoverability. This is a bounded follow-up to the closed public-source audit. No core redesign, paid model experiment, npm publication or automatic adoption.

| Task | Acceptance | Status |
|---|---|---|
| D1 Discovery | GitHub dsh-plugin topic plus accurate task-oriented description; bilingual public guidance and installed tool descriptions explain when to use DUO | COMPLETE: topic/metadata read back; bilingual guidance and existing tools updated |
| D2 Distribution | Exact-code product CI passes; versioned 0.6.1 Release includes reviewed tarball and checksum; anonymous download matches and installs through DSH in isolated profile | COMPLETE: CI35050843877; public assets match; installed plan/run/report PASS |
| D3 Catalog | One subpackage entry follows current awesome-dsh-plugin schema with explicit tarball; submission PR published; upstream acceptance recorded separately | SUBMITTED: PR5216; maintainer review/sync pending |
| D4 Verification | Real GitHub discovery queries and fresh installed tool/plan/run/report checked; limitations and external indexing/review state recorded | COMPLETE within scripted scope; ranking/Caller limitations below |

Before: repository public, but missing dsh-plugin topic; root package is development-only; actual bundle lives in dsh-plugin/; latest Release v0.6.0; no DUO entry found in the curated catalog README. Current preparation tools already work; their first description explains schemas rather than the user's task.

Minimum changes: add metadata and task-first descriptions to existing surfaces; package a fixed Release asset; submit the existing subpackage, without reshaping the repository or creating a new discovery service. All runtime algorithms, budgets, permissions, evidence rules and historical outcomes remain unchanged.

Sources: [official discovery](https://github.com/deepseek-ai/deepseek-harness#community-and-support), [market submission](https://github.com/dsh-market/dsh-market#submit-your-plugin), [catalog rules](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md), [Agent finder](https://github.com/awesome-dsh-plugin/dsh-find-plugin). These describe community distribution, not official certification. The catalog explicitly accepts subpackages and prebuilt Release tarballs; npm publication is optional.

Evidence: retained commands, upstream rule snapshots, package hashes, CI and external readbacks under the local ecosystem-distribution-20260916 run directory. Publish sanitized delivery receipts here. Search indexing and catalog review are external processes; a topic update or open PR is not proof of ranking or acceptance. Scripted discovery/install checks do not establish autonomous natural-language tool selection by a fresh LLM Caller.

## Delivery and observed discovery

- [Release v0.6.1](https://github.com/CZ-ZL/duo/releases/tag/v0.6.1) is a developer-preview prerelease with a fixed tarball, SHA256SUMS and verification receipt. It does not silently replace older tags/assets.
- [Exact-code CI35050843877](https://github.com/CZ-ZL/duo/actions/runs/35050843877) passed at `31a88508f5d8748ef166f816400b32e4a58500d2`: 340 native /451 Python product tests (86 research deselected), fresh dependency-store install, 73 public checks, 31 Slow checks, five baseline-repair cases and 21 host profiles. Both npm advisory graphs returned zero. Existing non-blocking Action runtime deprecation annotation retained.
- Anonymous HTTP200 downloads of all three release assets matched local/CI bytes. A new local isolated DSH profile installed that downloaded tarball, registered its bundle and completed plan/run/report at CNY0. This local check reused existing host peers; the CI check independently installed fresh dependencies.
- The actual installed ToolRuntime exposes the changed describe/design descriptions; describe grants no authority. Local onboarding/deferred-runtime regression passed 24 tests. No new tool, service or schema was added.
- [Catalog PR5216](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/5216) adds exactly one seven-line YAML file, with a subdirectory URL and pinned tarball. Submission does not establish acceptance or storefront visibility. No npm publication.

[Machine-readable evidence](../releases/0.6.1/DISTRIBUTION_EVIDENCE.json) and the [submitted entry](CATALOG_ENTRY.yml) retain all outcomes.

Live GitHub queries without a repository/name qualifier found DUO: `topic:dsh-plugin agent evaluation` at 18/19; `topic:dsh-plugin optimization` at 41/55; `topic:dsh-plugin "custom evaluators"` at 1/1; Chinese `topic:dsh-plugin 评估` at 12/17. These snapshots sort all returned results by stars and are not ranking promises.

Reproducing the inspected finder query/window/order (16 fetched, first eight retained, then star-sorted) found DUO for `custom evaluators`, but **not** in its default eight results for `agent evaluation`. This used authenticated GitHub transport, not a live LLM or an installed finder. The inspected finder also generates `github:owner/repo` install commands without subpackage/tarball resolution; that command is unsuitable for DUO's development root. Our guides and curated catalog entry point to the reviewed tarball. We did not modify third-party finder code or claim that every finder is compatible.

Lean change: improve existing entry descriptions, metadata and canonical guides; keep existing core/controller/evaluator/budget code, names, exports and package membership intact. The only runtime file changes are two description strings. Model selection, evidence criteria, permissions and historical results are unchanged.

## Remaining external step and limits

A catalog maintainer must review/merge PR5216; the market then synchronizes its catalog. No automatic recurring monitoring is promised. A future acceptance after merge should check the actual storefront entry and its download button. Do not call the plugin listed before observing that state.

No fresh autonomous Caller-selection experiment ran. Existing independent Caller evidence remains historical; this delivery proves discoverability for the recorded queries and public package behavior, not universal recommendation or method quality. Model requests: 0; CNY0. All source/package/CI failures from earlier work remain sealed; a local packaging-path setup error in this turn was corrected before npm ran. The CLI's PR command warned about unrelated parent-workspace changes; the API comparison confirms only the one intended catalog file was submitted, without those files.
