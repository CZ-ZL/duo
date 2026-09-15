# Repository layout and compatibility

The 2026-09-16 organization pass physically relocates 160 paths from commit
`1abb2e154bbeca6dc12c15d56925c3ecd8372c49`.
The root shrinks from 36 files to 13; `scripts/` has two top-level files;
`dsh-plugin/native/` shrinks from 79 files to 43 production modules/types.

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
| Current architecture and first use | `docs/ARCHITECTURE.md`, `docs/QUICKSTART.md` |
| Developer instructions and release process | `docs/development/` |
| Versioned notes and sealed receipts | `docs/releases/` |
| Historical experiment outcomes and guides | `docs/research/` |
| Original designs and superseded navigation | `docs/history/` |

Root entry points are the bilingual README, Agent Guide, generated capabilities,
license/attribution/contribution/changelog and build configuration. Do not add a
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
The duplicate root Agent Reference is consolidated into the identical canonical
`dsh-plugin/AGENT_REFERENCE.md`; the root Agent Guide remains the existing
public entry and is synchronized with the shipped copy.

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
