# DUO 0.6.1 — public plugin distribution

Status: PREPARING; release only after matching product CI passes. See the [distribution queue](../../product-foundation/DISTRIBUTION.md) for current delivery and marketplace status. The older RELEASE_NOTES.md and audit receipts remain historical snapshots.

This developer-preview package carries the previously accepted product repairs, plus task-oriented Agent entry descriptions and public distribution metadata. It evaluates supported targets, compares candidate changes and records evidence/costs within an authorized budget. It makes no new optimization-benefit claim.

## Install

Use the fixed Release asset `dual-loop-dsh-plugin-0.6.1.tgz` and SHA256SUMS, as shown in the [package guide](../../../dsh-plugin/README.md). The repository root is development-only. The plugin lives in `dsh-plugin/`, declares `dsh.bundle`, and is submitted to community catalogs as a subpackage with an explicit tarball URL. No npm registry publication.

After installation, the existing `dualloop_describe` and `dualloop_design` tools explain applicability and missing inputs before execution. The public Agent Guide includes natural-language task examples. No new tool, service, evaluator or permission is introduced.

## Compatibility and evidence

Linux; tested Node 24.14.1, DSH 0.1.2-rc.1, Cordis 4.0.2, pnpm 11.24.0. Custom targets require compatible adapters and evaluators. Default installation enables preparation, not paid execution. Providers remain trusted in-process code; recovery is limited to supported settled checkpoints. Candidate adoption is explicit.

Final CI, archive checksum, anonymous download/install and catalog PR receipts will be recorded in the distribution report. Existing independent Caller evidence is earlier evidence; deterministic discovery/install checks do not prove that every Agent will choose DUO or that a marketplace will accept/rank it. Research remains paused and general method superiority unproven.
