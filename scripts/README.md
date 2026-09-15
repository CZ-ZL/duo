# Script map

Run product checks from the repository root. New users should start with
[`duo init` and the shipped examples](../docs/QUICKSTART.md), not these drivers.

| Purpose | Entry |
|---|---|
| Full release gate, without model calls | `bash scripts/release_gate.sh /tmp/new-duo-release-check` |
| Package contents, exports and source-byte check | `product/check_release_package.py` (invoked by gate) |
| Fresh-store DSH installation | `product/verify_product_install.py` |
| Installed public journeys | `product/verify_product_examples.py` |
| Installed evidence-mode semantics | `product/verify_slow_evidence.py` |
| Infeasible-baseline repair and safety controls | `product/verify_baseline_repair.py` |
| Host integration compatibility | `product/verify_dsh_native.py` |
| Public extension types | `product/check_public_types.mjs` |
| Generated capability/guide consistency | `node scripts/product/sync_product_docs.mjs --check` |

See [TESTING.md](../docs/development/TESTING.md) for prerequisites and evidence boundaries.
Individual Python verifiers expose `--help`; the release gate supplies their
archive, package, host and isolated output paths in dependency order.

`research/` contains `run_*`, `prepare_code_*`, comparison, calibration and historical Caller drivers.
These
are retained research or prior acceptance utilities. They are not an alternative
product API, are not shipped in the package, and are not all offline. Do not run
them as a catch-all test command: real-model experiments require their own
authorization and frozen contract. `code_evaluation.py` and its worker support
the deterministic isolation control used by the product gate as well as older
tests; filenames alone do not imply a script is unused.

These files are physically separated. Product scripts import shared research
test machinery only for explicit local compatibility/isolation controls; the
installed runtime has no dependency on this directory. Old script paths have
moved; use the [migration map](../docs/development/REPOSITORY_MIGRATION.json).
No duplicate wrapper scripts are retained. Existing sealed experiment manifests
must be interpreted at their recorded commit, not silently resumed with moved
source hashes or borrowed budget.
