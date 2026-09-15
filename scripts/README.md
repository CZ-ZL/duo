# Script map

Run product checks from the repository root. New users should start with
[`duo init` and the shipped examples](../RELEASE_QUICKSTART.md), not these drivers.

| Purpose | Entry |
|---|---|
| Full release gate, without model calls | `bash scripts/release_gate.sh /tmp/new-duo-release-check` |
| Package contents, exports and source-byte check | `check_release_package.py` (invoked by gate) |
| Fresh-store DSH installation | `verify_product_install.py` |
| Installed public journeys | `verify_product_examples.py` |
| Installed evidence-mode semantics | `verify_slow_evidence.py` |
| Infeasible-baseline repair and safety controls | `verify_baseline_repair.py` |
| Host integration compatibility | `verify_dsh_native.py` |
| Public extension types | `check_public_types.mjs` |
| Generated capability/guide consistency | `node scripts/sync_product_docs.mjs --check` |

See [TESTING.md](../TESTING.md) for prerequisites and evidence boundaries.
Individual Python verifiers expose `--help`; the release gate supplies their
archive, package, host and isolated output paths in dependency order.

`run_*`, `prepare_code_*`, comparison, calibration and historical Caller drivers
are retained research or prior acceptance utilities. They are not an alternative
product API, are not shipped in the package, and are not all offline. Do not run
them as a catch-all test command: real-model experiments require their own
authorization and frozen contract. `code_evaluation.py` and its worker support
the deterministic isolation control used by the product gate as well as older
tests; filenames alone do not imply a script is unused.

Keeping these existing paths preserves imports and historical receipts. This
index separates their intended use without moving working modules or expanding
the package's public exports.
