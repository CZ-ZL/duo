# Releases and verification

Current package line: **0.6.1 candidate**. Last tagged release: **v0.6.0**.
Public visibility is owner-authorized and pending the
[final audit](../product-foundation/FINAL_PUBLIC_AUDIT.md). There is no npm publication.

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
