# Repository layout and compatibility

Two bounded passes on 2026-09-16 organize the source tree. The first maps 160
paths from `1abb2e1`; the homepage follow-up maps 22 paths from `46615a1`,
including two identical root documents consolidated into their shipped copies.
The current root has 9 files and 8 directories (17 entries). `scripts/` has two
top-level files; `dsh-plugin/native/` has 43 production modules/types.

## Where work belongs

| Content | Directory |
|---|---|
| Runtime code and supported adapter implementations | `dsh-plugin/native/` |
| Public package contracts and user guides | `dsh-plugin/` |
| Shipped runnable examples | `dsh-plugin/examples/product/` |
| Native regression, helpers, exposed task fixtures | `dsh-plugin/tests/` |
| Python protocol and compatibility tests | `dualloop/`, `tests/` |
| Product verification and its host drivers | `scripts/product/` |
| Retained research/diagnostic scripts and data | `scripts/research/` |
| Exposed historical benchmark inputs and experiment configurations | `research/` |
| Current architecture and first use | `docs/ARCHITECTURE.md`, `docs/QUICKSTART.md` |
| Developer instructions and release process | `docs/development/` |
| Versioned notes and sealed receipts | `docs/releases/` |
| Historical experiment outcomes and guides | `docs/research/` |
| Original designs and superseded navigation | `docs/history/` |

Root entry points are the bilingual README, license, contribution guide and
build configuration. The README links to one canonical shipped Agent Guide;
the documentation map links to current capabilities, attribution and release
records. Do not add a
new root STATUS, CURRENT, ACCEPTANCE or REPORT file for each work session.
New acceptance receipts belong under their release; link them from the
[release index](../releases/README.md).

## What remains compatible

Public npm exports, plugin names, service contracts, package file names, the
`duo` CLI, the `dualloop` Python import and
`bash scripts/release_gate.sh` remain intact. Runtime JavaScript and evaluator
algorithms are unchanged. Tests are discovered from `dsh-plugin/tests/`; the
gate and formatting commands include them explicitly.

Source-only script paths changed. Use the exact
[old → new map](REPOSITORY_MIGRATION.json), not a same-name compatibility wrapper.
The duplicate root Agent Reference, Agent Guide and generated capabilities are
consolidated into their canonical copies in `dsh-plugin/`. The doc generator
writes one capability page; it no longer copies a second Agent Guide. Shipped
instructions and package paths are unchanged. See the
[homepage move map](HOMEPAGE_MIGRATION.json) for the later source paths.

Moving the unshipped test helper also changes source-checkout implementation
identity to match the production module set. Reinspect source plans; do not
resume an old source checkpoint by bypassing its identity check. The installed
runtime's production module bytes and public exports do not change.

## Historical evidence

Moved frozen records and fixtures retain their original bytes. Their hashes are
included in the map. Relative paths inside a sealed receipt refer to that
receipt's original tree; consult its recorded commit, or the
[pre-migration tree](https://github.com/CZ-ZL/duo/tree/1abb2e154bbeca6dc12c15d56925c3ecd8372c49).
They are not current navigation documents or new experiment results.

Research scripts are retained for inspection and appropriately authorized
reproduction. No historical search, model request, final dataset, promotion
decision, cost or Goal conclusion is changed by this move. Private run archives
remain outside this repository. Product CI excludes research tests needing those
archives and records the exclusion.
