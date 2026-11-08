# Historical record map

This page locates preserved evidence. A status such as PASS, COMPLETE, READY or
RUNNING inside an old record applies to its recorded source and attempt. Use the
[current release index](../releases/README.md) and
[current capabilities](../../dsh-plugin/CURRENT_STATUS.md) for supported product state.

| Collection | What it preserves |
| --- | --- |
| [Original design](DESIGN.md) | Earlier design, including the Python bridge plan; current implementation is mapped in [ARCHITECTURE](../ARCHITECTURE.md) |
| [0.4.0 documents](0.4.0/README.md) | Historical README, contracts, status and design coverage |
| [Pre-organization records](pre-organization/STATUS.md) | Status, coverage and delivery snapshots before directory migrations |
| [Product acceptance records](../product-foundation/README.md) | Audits, closed work queues and first-use receipts |
| [Slow-semantics records](../slow-evidence-strategy/README.md) | Original 0.6.0 acceptance and its earlier attempts |
| [Versioned releases](../releases/README.md) | Release notes and immutable delivery receipts |
| [Research results](../research/README.md) | Shared baseline, study summaries, corrections and source availability |
| [Exposed research inputs](../../research/README.md) | Historical benchmarks, partial upstream document snapshots and contracts |

## Reading a relative reference

1. Read the record's source commit and provenance before treating a path as a
   current repository location.
2. Consult the [first migration map](../development/REPOSITORY_MIGRATION.json)
   and [homepage migration map](../development/HOMEPAGE_MIGRATION.json) for old-to-new
   locations and preserved-byte hashes.
3. If the reference names private `runs/`, raw timing streams, account records or
   omitted upstream source, that content is not supplied here. A recorded hash
   identifies a source; it does not make the source downloadable.

Historical Markdown and attributed benchmark snapshots retain their original
relative links, including unresolved ones. Navigation checks report those
separately from maintained guide links. They are not repaired by rewriting a
frozen record or inventing the missing file. New navigation pages use current
paths; the original receipts remain available for audit.
