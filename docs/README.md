# Documentation map

Start with the product, then read the implementation or historical evidence as
needed. A closed historical Goal does not establish the status of a newer build.

| Need | Start here |
|---|---|
| Understand DUO | [English README](../README.md) · [中文 README](../README.zh-CN.md) |
| Run the smallest local evaluation | [Quickstart](./QUICKSTART.md) |
| Use DUO as a Calling Agent | [Agent Guide](../dsh-plugin/AGENT_GUIDE.md) · [tool reference](../dsh-plugin/AGENT_REFERENCE.md) |
| Check supported targets and modes | [Current capabilities](../dsh-plugin/CURRENT_STATUS.md) |
| Understand the two loops and code boundaries | [Current architecture](./ARCHITECTURE.md) |
| Supply or replace a component | [Provider contracts](../dsh-plugin/PROVIDERS.md) · [runnable examples](../dsh-plugin/examples/product/README.md) |
| Develop and verify a change | [Contributing](../CONTRIBUTING.md) · [tests](./development/TESTING.md) · [script map](../scripts/README.md) |
| Review this release | [Release index and current verification](releases/README.md) · [release acceptance criteria](product-foundation/PRE_PUBLICATION_ACCEPTANCE.md) |
| Understand origins and licenses | [Third-party notices and inspiration](THIRD_PARTY_NOTICES.md) |
| Read research results | [Experiment record](./research/EXPERIMENTS.md) |

## Repository layout

```text
dsh-plugin/                 Installable DSH product and public contracts
  bin/duo.mjs               Public local CLI
  native/                   Production runtime modules
  tests/                    Native tests, helpers and exposed fixtures
  examples/product/         Shipped, deterministic product examples
scripts/
  release_gate.sh           Stable entry for the complete product gate
  product/                  Package, types, docs and DSH verification
  research/                 Retained experiment/diagnostic scripts and fixtures
tests/                      Python compatibility and integration tests
dualloop/                   Retained Python protocol / explicit legacy path
docs/
  ARCHITECTURE.md            Current implementation map
  development/              Testing, releasing and repository migration
  releases/                 Versioned notes and immutable acceptance receipts
  research/                 Experiment outcomes and historical usage guides
  product-foundation/        Product audit, maintenance queue and acceptance
  slow-evidence-strategy/    Sealed Slow-semantics Goal and evidence
  history/                  Historical documentation snapshots
research/                  Exposed historical inputs (benchmarks/, experiments/)
```

`dsh-plugin/package.json` owns shipped files and exports. Runtime consumers do not
need the repository's Python tests, research scripts or historical fixtures.
`native/capabilities.js` owns current capability declarations;
`dsh-plugin/CURRENT_STATUS.md` is generated from it. Agent instructions have one
canonical location in `dsh-plugin/`; repository navigation links to those same
shipped guides. The [changelog](releases/CHANGELOG.md) lives with release records.

Historical documents and receipts have moved out of the root. The
[first migration map](development/REPOSITORY_MIGRATION.json) and
[homepage migration map](development/HOMEPAGE_MIGRATION.json) record their original
paths and hashes. Frozen receipts still describe their original commits and
layouts; they have not been rewritten as current results. Read
[the layout guide](development/REPOSITORY_LAYOUT.md) for compatibility details.
Private profiles, ledgers and raw run directories remain excluded.
