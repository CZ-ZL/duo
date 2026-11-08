# Repository layout and compatibility

The public repository separates the installable product, development tooling,
shared research methods and retained evidence. Use the [documentation map](../README.md)
for reading paths and the [script map](../../scripts/README.md) for execution entry points.

## Directory map

```text
dsh-plugin/                  Installable DSH plugin; package files and public contracts
  native/                    Runtime services, adapters, policies and declarations
  bin/duo.mjs                Public setup and tool transport
  examples/product/          Shipped deterministic examples
  examples/model/            Shipped grounded-QA starter
  examples/decisions/        Shipped bounded-decision example
  tests/                     Native tests, helpers and exposed fixtures
scripts/
  release_gate.sh            Complete product verification entry
  product/                   Installation, package, types, docs and host checks
  research/                  Retained research and Caller drivers; see its README
examples/                    Source-checkout adapters and compatibility controls
  native/                    Inputs also staged by product/research verifiers
  agent_native/              Retained Python adapter example
dualloop/                    Python protocol and explicitly selected legacy path
tests/                       Python product tests and marked historical research tests
.github/                     Product workflow, templates and verification-host manifest
docs/
  ARCHITECTURE.md             Current product implementation map
  development/               Contribution, testing, release and migration guidance
  research/                  Shared Simple method, study results and research guides
  releases/                  Source-update notes and versioned release evidence
  product-foundation/         Retained product acceptance records and first-use evidence
  slow-evidence-strategy/     Retained 0.6.0 acceptance records
  history/                   Historical document snapshots and the archive reading map
research/                    Exposed benchmark inputs and original experiment contracts
```

Root files hold the bilingual overview, contribution guide, license and build
configuration. Session reports belong with their scoped evidence; they do not
become additional root STATUS or CURRENT entry points.

## Canonical documents and interfaces

- `dsh-plugin/package.json` defines shipped files and npm exports. Package guides,
  CLI paths, service names and plugin IDs remain stable through this cleanup.
- `dsh-plugin/native/capabilities.js` generates `dsh-plugin/CURRENT_STATUS.md`.
  Edit the catalog and regenerate that page when capabilities change.
- The shipped Agent Guide and Agent Reference live in `dsh-plugin/`; navigation
  points to those copies.
- `docs/research/SIMPLE_BASELINE.zh-CN.md` defines the shared baseline. Study pages
  record their own versions, budgets, results and provenance.
- `docs/releases/README.md` separates source previews from tagged downloads.
  Historical PASS or CLOSED records do not qualify later source changes.

## Retained files that look redundant

The root license also ships inside the npm package. The sample experiment and
persona exist in both the package and the source compatibility examples because
both distributions need them. Empty Python `__init__.py` files mark packages.
These are intentional copies, not disposable output.

Some host drivers are copied into isolated profiles beside their dependencies:
`dsh_adoption_host_driver.js` receives `adoption.js` from the host verifier;
`dsh_maturation_host.js` receives `schema-answer-evaluator.js` from the Caller
profile builder. Their source-relative imports resolve in the staged profile.
No standalone wrapper or duplicate runtime is needed in the scripts directory.

## Historical paths

The [first migration map](REPOSITORY_MIGRATION.json) and
[homepage migration map](HOMEPAGE_MIGRATION.json) retain original paths and hashes.
The [historical record map](../history/README.md) explains how to read frozen
relative references and attributed upstream snapshots. Runtime exports, tests,
input data and sealed records are retained; no experiment was rerun or historical
result rewritten by this navigation cleanup.
