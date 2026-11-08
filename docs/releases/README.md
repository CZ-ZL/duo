# Releases and verification

## Source preview

The source line is **0.6.3**. The [2026-11-08 source update](source-update-20261108/README.md)
records the diagnostics, bounded decision services, accounting changes and research
publication. A source update does not create a tagged Release or publish an npm package.

[Product verification](https://github.com/CZ-ZL/duo/actions/workflows/product.yml)
records each pushed commit. The shared-baseline documentation commit `4cb93f8`
passed [CI 42437137855](https://github.com/CZ-ZL/duo/actions/runs/42437137855);
earlier source verification passed 412 native and 451 Python product checks.
Use the run matching the commit you inspect. The [test guide](../development/TESTING.md)
and [declared host composition](../../.github/verification-host/package.json)
explain scope and the Cordis 4.1 dynamic Caller limitation.

The [0.6.3 first-use acceptance](../product-foundation/FIRST_USE.md) is complete
with G1–G8 PASS. It includes the public free path and independent live starter
usage. Its [run result](../product-foundation/first-use/STARTER_RESULT.json) remains
historical evidence for that tested task and package; it does not establish
optimization benefit or automatically qualify subsequent changes.

## Tagged downloads

As checked on 2026-11-08, the latest tagged download is
**[v0.6.2 developer preview](https://github.com/CZ-ZL/duo/releases/tag/v0.6.2)**
(prerelease); the preceding non-prerelease tag is
[v0.6.0](https://github.com/CZ-ZL/duo/releases/tag/v0.6.0).
The v0.6.2 [notes](0.6.2/RELEASE_NOTES.md) and
[delivery receipt](0.6.2/DELIVERY_EVIDENCE.json) identify its tested source and
artifact hash. Download the archive and SHA256SUMS from the matching tagged Release.

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
