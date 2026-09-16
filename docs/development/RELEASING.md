# Product release procedure

0.6.2 is the current developer-preview source line. Consult the release index for the actual tag and artifact status.
The [release index](../releases/README.md) records current verification and
visibility. Current support is recorded in [current capabilities](../../dsh-plugin/CURRENT_STATUS.md). The
[pre-publication acceptance contract](../product-foundation/PRE_PUBLICATION_ACCEPTANCE.md)
and [final public-source audit](../product-foundation/FINAL_PUBLIC_AUDIT.md) govern this candidate's
release decision; docs/slow-evidence-strategy/ACCEPTANCE.json is the sealed 0.6.0 receipt.
docs/releases/0.5.0/ACCEPTANCE.json retains the sealed 0.5.0 Product Foundation receipt.
The destination is CZ-ZL/duo. No npm registry publication is authorized.
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
   relevant inputs; record that it is an earlier run. Changed preparation/control
   paths currently have scripted installed-DSH evidence only. Do not present them
   as a fresh independent Agent acceptance. Scripted tests do not replace this acceptance.
5. Check git diff and version consistency; update current acceptance and lean
   change records. Commit and push through the owner's authorized repository
   flow, then wait for the exact commit's GitHub Actions result. Keep failed CI
   runs and fix within scope. No force push or npm publish.
6. Record the commit, workflow URL and tarball hash. Distinguish tested code from
   subsequent documentation-only evidence updates.
7. Before changing repository visibility, review reachable history, release
   assets and workflow artifacts against the frozen acceptance contract and
   obtain explicit authorization for public exposure. Private delivery authority
   is not public-visibility or npm-publication authority. Preserve failed runs.

The [quickstart and fault guide](../QUICKSTART.md) covers the supported
upgrade/rollback boundaries. The audit is a release review, not a security
certification. Keep its unresolved dependency, CI and exposure checks visible.

## Compatibility

Tested host target: DSH 0.1.2-rc.1, Cordis 4.0.2, Node 24.14.1 and pnpm 11.24.0 on Linux.
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
