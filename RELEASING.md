# GitHub publication checklist

This source is a publication candidate for the existing native persona plugin.
The package stays at 0.3.0 until the owner chooses a release and its acceptance
conditions are met. A source upload is not a claim of optimization superiority.

1. Confirm the GitHub owner/repository, public visibility, release scope and
   copyright attribution. Do not publish the parent workspace or its Git history.
2. Review the source manifest and proposed changes. Exclude credentials, host
   configuration, raw runs, journals, final datasets and account ledgers.
3. Run `bash scripts/release_gate.sh /tmp/new-duo-release` with an installed DSH
   package selected through `DUO_DSH_PACKAGE`. Read TESTING.md: this is the product
   gate, not the complete historical experiment replay.
4. Run the supplied GitHub workflow on the exact candidate. Its fresh dependency
   installation has not been validated by local cached-profile tests. Resolve
   any failure before calling the release reproducible on a new machine.
5. Perform an actual tarball install with `dsh plugin --profile <new-profile> add
   <absolute-tarball>` in a fresh environment, then verify the composed profile
   and run the shipped demonstration. Record commands, versions and exit codes.
6. Confirm real-model capability evidence for the shipped provider version. Old
   receipts stay historical; fixture checks do not replace this evidence. No
   additional paid experiment is authorized by this checklist.
7. Verify TypeScript declarations with an actual compiler before claiming
   semantic type validation; the local audit has no installed `tsc`.
8. Only then choose a tag and publish the reviewed source and tarball. This
   checklist does not grant repository-write or registry-publish authority.

## Version and compatibility policy

The previous project policy targets 1.0.0 for its first formal release, after
all product and publication requirements have evidence. This preparation does
not silently relax that definition or mark 1.0.0 complete. An experimental 0.3.0
public preview is a separate owner decision.

The tested host snapshot is DSH 0.1.2-rc.1, Cordis 4.0.2 and Node 24.14.1 on Linux.
DSH remains a developer preview. Recheck compatibility before host upgrades.
Use semver for public contracts and tools: additive optional fields are minor;
incompatible field/behavior changes are major. Plan digests deliberately bind
inputs; document changes that invalidate a previous digest in CHANGELOG.md.

GitHub source plus a local tarball is the intended channel for this preparation.
No npm scope ownership, registry publication or clean registry install is claimed.
The deprecated 0.1.0 tarball remains unpublished and unsupported.
