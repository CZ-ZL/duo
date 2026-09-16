# Ecosystem distribution and Agent discovery — 2026-09-16

Status: IN PROGRESS. Owner approved the preceding distribution plan and improving Agent discoverability. This is a bounded follow-up to the closed public-source audit. No core redesign, paid model experiment, npm publication or automatic adoption.

| Task | Acceptance | Status |
|---|---|---|
| D1 Discovery | GitHub dsh-plugin topic plus accurate task-oriented description; bilingual public guidance and installed tool descriptions explain when to use DUO | IN PROGRESS |
| D2 Distribution | Exact-code product CI passes; versioned 0.6.1 Release includes reviewed tarball and checksum; anonymous download matches and installs through DSH in isolated profile | PENDING |
| D3 Catalog | One subpackage entry follows current awesome-dsh-plugin schema with explicit tarball; submission PR published; upstream acceptance recorded separately | PENDING |
| D4 Verification | Real GitHub discovery queries and fresh installed tool/plan/run/report checked; limitations and external indexing/review state recorded | PENDING |

Before: repository public, but missing dsh-plugin topic; root package is development-only; actual bundle lives in dsh-plugin/; latest Release v0.6.0; no DUO entry found in the curated catalog README. Current preparation tools already work; their first description explains schemas rather than the user's task.

Minimum changes: add metadata and task-first descriptions to existing surfaces; package a fixed Release asset; submit the existing subpackage, without reshaping the repository or creating a new discovery service. All runtime algorithms, budgets, permissions, evidence rules and historical outcomes remain unchanged.

Sources: [official discovery](https://github.com/deepseek-ai/deepseek-harness#community-and-support), [market submission](https://github.com/dsh-market/dsh-market#submit-your-plugin), [catalog rules](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md), [Agent finder](https://github.com/awesome-dsh-plugin/dsh-find-plugin). These describe community distribution, not official certification. The catalog explicitly accepts subpackages and prebuilt Release tarballs; npm publication is optional.

Evidence: retained commands, upstream rule snapshots, package hashes, CI and external readbacks under the local ecosystem-distribution-20260916 run directory. Publish sanitized delivery receipts here. Search indexing and catalog review are external processes; a topic update or open PR is not proof of ranking or acceptance. Scripted discovery/install checks do not establish autonomous natural-language tool selection by a fresh LLM Caller.
