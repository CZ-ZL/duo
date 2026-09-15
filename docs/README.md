# Documentation map

Start with the product, then read the implementation or historical evidence as
needed. A closed historical Goal does not establish the status of a newer build.

| Need | Start here |
|---|---|
| Understand DUO | [English README](../README.md) · [中文 README](../README.zh-CN.md) |
| Run the smallest local evaluation | [Quickstart](../RELEASE_QUICKSTART.md) |
| Use DUO as a Calling Agent | [Agent Guide](../AGENT_GUIDE.md) · [tool reference](../AGENT_REFERENCE.md) |
| Check supported targets and modes | [Current capabilities](../CURRENT_STATUS.md) |
| Understand the two loops and code boundaries | [Current architecture](ARCHITECTURE.md) |
| Supply or replace a component | [Provider contracts](../dsh-plugin/PROVIDERS.md) · [runnable examples](../dsh-plugin/examples/product/README.md) |
| Develop and verify a change | [Contributing](../CONTRIBUTING.md) · [tests](../TESTING.md) · [script map](../scripts/README.md) |
| Review this release | [0.6.1 notes](../RELEASE_NOTES_v0.6.1.md) · [release acceptance criteria](product-foundation/PRE_PUBLICATION_ACCEPTANCE.md) · [F01 follow-up](product-foundation/F01_REPAIR.md) |
| Understand origins and licenses | [Third-party notices and inspiration](../THIRD_PARTY_NOTICES.md) |
| Read research results | [Experiment record](../EXPERIMENTS.md) |

## Repository layout

```text
dsh-plugin/                 Installable DSH product and public contracts
  bin/duo.mjs               Public local CLI
  native/                   Runtime modules and adjacent regression tests
  examples/product/         Shipped, deterministic product examples
scripts/                    Release checks; separately indexed research tools
tests/                      Python compatibility and integration tests
dualloop/                   Retained Python protocol / explicit legacy path
docs/
  ARCHITECTURE.md            Current implementation map
  product-foundation/        Product audit, maintenance queue and acceptance
  slow-evidence-strategy/    Sealed Slow-semantics Goal and evidence
  history/                  Historical documentation snapshots
benchmarks/, experiments/   Exposed historical research inputs
```

`dsh-plugin/package.json` owns shipped files and exports. Runtime consumers do not
need the repository's Python tests, research scripts or historical fixtures.
`native/capabilities.js` owns current capability declarations; the two
`CURRENT_STATUS.md` copies are generated from it.

Historical root documents and receipts remain at their established paths so
existing citations and tooling keep working. In particular, `DESIGN.md` records
the original architecture, while this index and `ARCHITECTURE.md` describe the
current product. Raw private profiles, ledgers and run directories are excluded
from the source distribution. They are not required for the public examples.
