# Releases and verification

## Current release: v0.6.3

[v0.6.3](https://github.com/CZ-ZL/duo/releases/tag/v0.6.3) is the supported public
release. Download its plugin archive, SHA256SUMS, host-package.json and
VERIFICATION.json from that page. The receipt binds the source commit,
exact-commit CI, archive checksum and acceptance scope.

Start with [Quickstart](../../dsh-plugin/QUICKSTART.md); use
[installation and compatibility](../../dsh-plugin/guides/INSTALL.md) for the
verified Linux / Node / DSH composition. The DSH dependency remains an upstream
preview. This release is not an npm publication or a security certification.

[Release notes](0.6.3/RELEASE_NOTES.md) explain the changes and the
[repository QC checklist](0.6.3/QC.md) records acceptance criteria.
[Product verification](https://github.com/CZ-ZL/duo/actions/workflows/product.yml)
runs for each commit; use the run matching the artifact's receipt.

The [earlier source update](source-update-20261108/README.md) and
[first-use acceptance](../product-foundation/FIRST_USE.md) retain their original
scope. The earlier live starter tied 4/4 and retained the original. It validates
that model journey, not improvement or a fresh live test of every later change.

## Earlier tagged downloads

[v0.6.2](https://github.com/CZ-ZL/duo/releases/tag/v0.6.2) and
[v0.6.1](https://github.com/CZ-ZL/duo/releases/tag/v0.6.1) remain prereleases;
[v0.6.0](https://github.com/CZ-ZL/duo/releases/tag/v0.6.0) is an earlier release.
Use each tag's own archive, checksum and evidence. Historical artifacts are not
rewritten to contain current source.

## Earlier notes and evidence

| Version or stage | Record |
| --- | --- |
| 0.6.2 Target/provider compatibility | [Notes](0.6.2/RELEASE_NOTES.md), [receipt](0.6.2/DELIVERY_EVIDENCE.json) |
| 0.6.1 ecosystem distribution | [Distribution](0.6.1/DISTRIBUTION.md), [receipt](0.6.1/DISTRIBUTION_EVIDENCE.json) |
| 0.6.1 public-source audit | [Audit](../product-foundation/FINAL_PUBLIC_AUDIT.md), [receipt](0.6.1/PUBLIC_EVIDENCE.json) |
| 0.6.1 homepage and directory organization | [Homepage receipt](0.6.1/HOMEPAGE_EVIDENCE.json), [directory receipt](0.6.1/ORGANIZATION_EVIDENCE.json), [layout](../development/REPOSITORY_LAYOUT.md) |
| 0.6.1 identity repair | [Notes](0.6.1/RELEASE_NOTES.md), [F01 receipt](0.6.1/F01_EVIDENCE.json) |
| 0.6.0 Slow semantics | [Notes](0.6.0/RELEASE_NOTES.md), [acceptance map](../slow-evidence-strategy/README.md) |
| 0.5.0 Product Foundation | [Notes](0.5.0/RELEASE_NOTES.md), [acceptance](0.5.0/ACCEPTANCE.json) |
| 0.4.0 earlier delivery | [Notes](0.4.0/RELEASE_NOTES.md), [local evidence](0.4.0/LOCAL_EVIDENCE.json), [publication evidence](0.4.0/PUBLICATION_EVIDENCE.json) |

Frozen records retain their original bytes and conclusions. Their relative paths
may refer to an earlier tree or private inputs; consult the
[historical record map](../history/README.md) and recorded commits.
For capabilities use [CURRENT_STATUS](../../dsh-plugin/CURRENT_STATUS.md);
for delivery work use [RELEASING](../development/RELEASING.md).
