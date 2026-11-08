# Product release procedure

0.6.3 is the current public release. Consult the release index and tagged verification receipt for source and artifact identity.
The [release index](../releases/README.md) records current verification and
visibility. Current support is recorded in [current capabilities](../../dsh-plugin/CURRENT_STATUS.md).
The [earlier acceptance contracts and audits](../product-foundation/README.md)
are historical references for their recorded candidates. Current work needs the
owner's actual scope and verification of the files being delivered; old gates
and unused budgets do not authorize a new release.
The destination is CZ-ZL/duo. A source push, tagged Release, npm publication and
visibility change are distinct actions with their own authorization scope.
The earlier 0.3/0.4 preparation and experiments remain historical evidence, not
acceptance for new code. A release does not establish method superiority.

1. Review the actual checkout and remote; preserve concurrent edits. Confirm the
   destination and its visibility match the current authorization; do not push
   the parent workspace history.
2. Review source and tarball contents. Exclude credentials, private profiles,
   raw runs, journals, final data and account ledgers. Keep sanitized research
   summaries separate from current product instructions.
3. Run `bash scripts/release_gate.sh /tmp/new-duo-release` with DUO_DSH_PACKAGE
   selecting an installed DSH. This includes actual tarball installation in a
   fresh profile and dependency store; registry access is required. No model
   credentials are inherited. Read TESTING.md for the exact scope.
4. Complete independent Agent acceptance using only the installed public package
   and guides. Preserve steps, corrections, failed attempts and evidence limits.
   Earlier acceptance may be reused for unchanged journeys after checking the
   relevant inputs; record that it is an earlier run. Changed preparation/control paths need new installed-guide acceptance. Record
   scripted checks and independent Agent use separately; neither implies a new
   paid-model result.
5. Check git diff and version consistency; update current acceptance and lean
   change records. Commit and push through the owner's authorized repository
   flow, then wait for the exact commit's GitHub Actions result. Keep failed CI
   runs and fix within scope. No force push or npm publish.
6. Download the successful exact-commit CI archive. Verify its members and source
   bytes, then publish that same archive with SHA256SUMS, host-package.json and
   VERIFICATION.json under the new tag. Verify anonymous downloads and tag/source
   identity. The receipt records CI, scope and reused evidence; do not build an
   untested archive after the checks. Distinguish subsequent documentation edits.
7. Before changing repository visibility, review reachable history, release
   assets and workflow artifacts against the frozen acceptance contract and
   obtain explicit authorization for public exposure. Private delivery authority
   is not public-visibility or npm-publication authority. Preserve failed runs.

The [quickstart and fault guide](../QUICKSTART.md) covers the supported
upgrade/rollback boundaries. The audit is a release review, not a security
certification. Keep its unresolved dependency, CI and exposure checks visible.

## Compatibility

Tested host target: DSH 0.1.2-rc.1, the [declared Cordis 4.0.2 framework family](../../.github/verification-host/package.json), Node 24.14.1 and pnpm 11.24.0 on Linux.
DSH remains a developer preview; recheck compatibility before host upgrades.
Target identity/projection is adapter-owned in 0.5.0. Old plans bind the previous
policy/provider versions and must be inspected and re-planned; do not resume a
0.4 checkpoint under a changed 0.5 provider graph. The legacy Python API and
explicit fixture export remain available. The fixture is disabled by default.

Custom Target adapters may declare targetKinds and warm-history hooks. Providers
without warm-history hooks may still execute; their history is not imported.
No cross-platform, arbitrary interrupted-call
replay, automatic adoption or end-to-end caller-budget enforcement is claimed.
A future 1.0 release needs its own defined compatibility and acceptance decision.

Public TypeScript declarations and supported strategy hooks compile in the gate.
Changing the provider graph, including the 0.6.0 budget/evidence semantics, requires
a new inspected plan; old checkpoints do not authorize execution under new code.
