# Releases and verification

Current installable release: **[v0.6.2 developer preview](https://github.com/CZ-ZL/duo/releases/tag/v0.6.2)** (prerelease). The previous non-prerelease tag is v0.6.0.

[Release notes](0.6.2/RELEASE_NOTES.md) and [receipt](0.6.2/DELIVERY_EVIDENCE.json)
cover declared Target/provider compatibility checks at
`f0a644335ec22941fd17a761070d93820f5468fc`.
[CI35055408273](https://github.com/CZ-ZL/duo/actions/runs/35055408273) passed.
The 69-member tarball SHA256 is
`22ea56ded0d85ae0788e1fe975ec476330a8b411250f73b4b69eec6ed495c866`.
Anonymous downloads match the CI-tested artifact. Download it and SHA256SUMS
from that fixed Release. v0.6.1 and its artifacts remain unchanged.

Source preview: **0.6.3 first-use convergence** adds the packaged grounded-QA
starter and reorganized entry guides. It is not tagged or released while live
G4/G5 acceptance awaits new authorization. See the [active gate record](../product-foundation/FIRST_USE.md).

The remaining entries preserve earlier verification stages.
The repository is **public**. The [final audit](../product-foundation/FINAL_PUBLIC_AUDIT.md)
and [publication receipt](0.6.1/PUBLIC_EVIDENCE.json) record the authorized exposure.
There is no npm publication.

Public-exposure audit verified source: `3670a659ca8d4d1452b08e803f3810858b4ed4db`.
[CI35009839832](https://github.com/CZ-ZL/duo/actions/runs/35009839832) passed the
complete product gate with the final documentation and pinned Actions.
The 69-member package SHA256 is
`0e842f5531e8261c801484ca196bba9d74c6272993fdd0bcbeacf046d9f40869`.
Later publication receipts change documentation only.

The [homepage follow-up](../product-foundation/ORGANIZATION.md) passed
[CI35008412237](https://github.com/CZ-ZL/duo/actions/runs/35008412237).
Its [receipt](0.6.1/HOMEPAGE_EVIDENCE.json) records the unchanged earlier archive.
The final-publication package updates security and installation documentation;
its new artifact and CI are tracked separately in the final audit.

The directory-organization follow-up is **complete**:
[exact-code CI passed](https://github.com/CZ-ZL/duo/actions/runs/35005165474) at
`e674101ea2f344cb43283d028320854103de644e`.
Read the [directory-migration receipt](0.6.1/ORGANIZATION_EVIDENCE.json) and
[queue/report](../product-foundation/ORGANIZATION.md). All runtime JavaScript, model
configuration, public exports and historical experimental outcomes are unchanged.
Package documentation changes receive a new artifact hash.

| Version / stage | Notes and evidence |
|---|---|
| 0.6.2 Target/provider compatibility — current | [Release](https://github.com/CZ-ZL/duo/releases/tag/v0.6.2), [notes](0.6.2/RELEASE_NOTES.md), [receipt](0.6.2/DELIVERY_EVIDENCE.json) |
| 0.6.1 ecosystem distribution | [Release](https://github.com/CZ-ZL/duo/releases/tag/v0.6.1), [notes](0.6.1/DISTRIBUTION.md), [receipt](0.6.1/DISTRIBUTION_EVIDENCE.json) |
| 0.6.1 public-source audit | [Audit](../product-foundation/FINAL_PUBLIC_AUDIT.md), [receipt](0.6.1/PUBLIC_EVIDENCE.json), [CI artifact](https://github.com/CZ-ZL/duo/actions/runs/35009839832) |
| 0.6.1 homepage organization | [Receipt](0.6.1/HOMEPAGE_EVIDENCE.json), [CI](https://github.com/CZ-ZL/duo/actions/runs/35008412237) |
| 0.6.1 directory organization | [Receipt](0.6.1/ORGANIZATION_EVIDENCE.json), [migration/compatibility](../development/REPOSITORY_LAYOUT.md), [CI artifact](https://github.com/CZ-ZL/duo/actions/runs/35005165474) |
| 0.6.1 identity repair before directory migration | [Notes](0.6.1/RELEASE_NOTES.md), [sealed F01 receipt](0.6.1/F01_EVIDENCE.json), [passing CI](https://github.com/CZ-ZL/duo/actions/runs/35001366148) |
| 0.6.0 Slow evidence semantics | [Notes](0.6.0/RELEASE_NOTES.md), [acceptance](../slow-evidence-strategy/ACCEPTANCE.json) |
| 0.5.0 Product Foundation | [Notes](0.5.0/RELEASE_NOTES.md), [acceptance](0.5.0/ACCEPTANCE.json) |
| 0.4.0 earlier delivery | [Notes](0.4.0/RELEASE_NOTES.md), [local evidence](0.4.0/LOCAL_EVIDENCE.json), [private upload](0.4.0/PUBLICATION_EVIDENCE.json) |

These records preserve original bytes and conclusions. Historical relative paths
describe the original layouts; the [migration map](../development/REPOSITORY_MIGRATION.json)
and recorded Git commits locate those inputs. They are not fresh acceptance of a
later build. For supported capabilities read [CURRENT_STATUS](../../dsh-plugin/CURRENT_STATUS.md);
for the release process read [RELEASING](../development/RELEASING.md).
