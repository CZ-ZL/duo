# Source update — 2026-11-08

This source update brings the retained product development changes and completed-stage DUO task research into the public repository. The package remains the 0.6.3 preview. No npm package or formal GitHub Release is published by this update.

The product additions include optional run diagnostics, explicit abandonment of quiescent runs with unresolved provider costs, bounded decision services with a local example, and opt-in diagnostic support judgments. Abandonment preserves unknown reservations and receipts; it neither retries a lost operation nor authorizes fresh spending. Shadow judgments remain diagnostic and do not affect candidate selection. The supported web-fetch configuration range now starts at 5,000 characters.

Pre-publication review found and corrected three doctor defects: incorrect rank correlation (including tied ranks), diagnostic shadow records misclassified as primary parse failures, and final provider work continuing after a doctor stop. The added regressions failed on the prepared source before the fixes; the corrected targeted suite passed 17 tests, and the complete native suite passed 412 tests.

Formatting, exported TypeScript contracts, generated product documentation and actual offline tarball inspection also passed. The tarball contains 88 reviewed members with compatible installed host peer versions. These checks use the existing DSH 0.1.2-rc.1 installation; no dependencies were installed and no model requests were made. See [verification evidence](VERIFICATION.json) for exact scope, source bindings and remaining limits. GitHub Actions performs its own checks on the pushed commit.

The [research closeout](../../research/duo-task-optimization-20261105/README.md) publishes the component study, fixed-pool attribution and mechanism-alignment results with their separate denominators, failures, corrections and source availability. The adoption decision remains to retain Simple. Offline engineering verification does not establish optimization benefit; the aligned study's strict scientific status remains UNRESOLVED.

Original experiment inputs, runtime state and raw timing archives are not part of this source update. Historical experiment launch scripts that depend on the local archive remain local. The public research material is a curated results publication, not a complete standalone reproduction package.

## CI follow-up

The [first published commit's CI run](https://github.com/CZ-ZL/duo/actions/runs/42397371441) passed formatting, public types, packaging, fresh-profile installation, public examples, Slow evidence, baseline repair, sandbox isolation and dependency advisories. It then failed two Doctor stop tests and a test that expected the locally cached Schemastery version `3.18.2`; the CI host resolved Cordis `4.1.0` and Schemastery `3.19.0`.

The Doctor failure was an undeclared optional-service lookup, not a changed stopping rule. Calling the controller through a consuming plugin reproduced both failures even with the earlier Cordis `4.0.2`. The controller now uses `ctx.get('duoDoctor')` at both consultation boundaries. The regression tests use that plugin calling path and retain the stop, journal, disabled/absent service and no-final-call assertions. The evaluator control test checks the reported dependency name and version against the package actually loaded, while retaining its valid/invalid output controls.

The revised targeted suite passed all 20 tests locally, the complete native suite passed all 412 tests, and formatting passed. A subsequent CI run also passed all 412 native tests with Cordis `4.1.0`. The original `VERIFICATION.json` remains the pre-publication snapshot; its source hashes and package digest describe the initial commit.

The later [Caller diagnostics run](https://github.com/CZ-ZL/duo/actions/runs/42398706216) exposed a separate host compatibility failure: 446 Python product tests passed and five failed because `cordis_run` returned `Cannot read properties of undefined (reading 'parent')`. The published DSH `0.1.2-rc.1` tool enumerates provided services using `impl.fiber`; Cordis `4.1.0` stores the providing context as `impl.ctx`. Applying that exact enumeration to the new record shape reproduces the error. The tool can fail while reporting a plugin it has already activated, so later successful evaluation does not make the attachment check pass.

CI now declares DSH `0.1.2-rc.1` with an explicit Cordis `4.0.2` override in [the verification host manifest](../../../.github/verification-host/package.json). It retains every Caller assertion and archives the resolved host lockfile. Other transitive dependencies continue to resolve at installation; this is not a completely locked environment. The isolated tarball installation check also remains in place. A green run on this host composition does **not** establish the dynamic Caller path on Cordis `4.1.0`; that combination remains unqualified. No upstream package or user's installed host was patched.

The research publication also includes a [source-checked description of Simple](../../research/duo-task-optimization-20261105/SIMPLE_BASELINE.zh-CN.md), including its iterative controller, existing feedback and measurement capabilities, and the separate `S-current` / `S-aligned` configurations.
