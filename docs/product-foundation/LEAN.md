# Lean change record

Each row preserves algorithm, safety and historical evidence boundaries. No LOC target is used as acceptance.

| Before → after | Why simpler | Regression evidence |
|---|---|---|
| Separate Target kind lists in contract/schema/descriptions → one capability catalog plus generic kind syntax and active adapter binding | Capability additions no longer require editing a core allow-list; support remains explicit | P1 discovery/custom-contract tests; generated docs check |
| Core guesses persona/config identity; history repeats persona validation → Target owns identity, snapshot validation and safe Delta projection | Same lifecycle works with opaque custom Target; no target-specific core branch | P2 config warm and non-persona custom Target tests; retained forged-lineage/final/fixture controls |
| Tool finalizer and controller each construct incomplete errors → shared describeFailure | One vocabulary for cause/recovery/action/cost/effects; native DSH error identity unchanged | P3 actual ToolRuntime denial/argument/cancellation tests; controller regressions |
| Full contract boilerplate for initial setup → explicit evaluate/optimize defaults on existing design tool | No new overlapping tool; target/objective/paid authority remain explicit | Preset tests include missing budget and zero-cost evaluation |
| Default runtime starts a synthetic fixture → setup plus existing deferred runtime | Installed package states missing providers rather than silently measuring a fixture | Fresh setup/public example profiles; explicit retained fixture compatibility gate |
| Duplicate source and shipped fixture implementation → one public compatibility export | Removes a duplicate implementation without removing legacy acceptance inputs | Existing native/DSH fixture regressions |
| Multiple Current/Latest research narratives in product status → generated current support and separate historical snapshots | One current support source; historical files preserved byte-for-byte | docs sync; package link/export checks |
| Source-only example launcher/scripts → small shipped setup/ToolRuntime transport and complete examples | Caller needs installed package and public docs; no Python research script | Fresh tarball CLI scenarios and independent Agent acceptance |

Retained intentionally: legacy Python API/ledger; explicit fixture export; separate application adapters; budget/receipt guards; bounded host-specific recovery; advanced existing tier support. No speculative service, global scheduler, Graph/Bayesian layer or method experiment added.

Failure records: P2 initial implementation run had a syntax typo (74 passes, 2 import failures), corrected before green; initial CLI source symlink failed DSH dependency resolution, replaced with declared-file staging. Original logs remain in the private local acceptance archive. No model requests or fees were incurred by these failures.

Additional retained failures: id-only Cordis name patch left the old provider
active (public-acceptance-1); disable-old/insert-new corrected it, confirmed by
provider identity in public-acceptance-2. Malformed targetKinds could admit a
substring instead of an exact kind; target-binding-red reproduces it and the
nonempty list check passes in target-binding-green. Native midpoint 293/294 had
one test caller missing the now-explicit Target projector; corrected invocation
and final native 295/295 passed. Fresh registry dependency installation failed
locally with TLS EOF; offline DSH tarball install passed using existing host peers.
This is recorded as an environment limit, not hidden as clean registry success.

Independent documentation review exposed stale readiness wording. Inspection
also found evaluate presets used the unmerged draft when recommending an
operation. A regression reproduced prepare_measurement instead of evaluate;
the recommendation now reads the already resolved contract. No scoring or
execution policy changed. See evaluate-preset-red/green evidence.

CI run 34858521791 passed native 295, Python 451 and all 21 host profiles,
then failed pnpm 10.17.1 auto-peer installation: no matching dsh-invariants
>=0.1.2 <0.2.0-0. Local pnpm is 11.24.0. Align the CI version and retest before
claiming installation fixed. Installation now runs before expensive suites;
all original gates remain mandatory. The package/runtime bytes are unchanged.

Peer metadata inspection independently reproduced another packaging defect:
^0.1.1-rc.1 did not admit the actual tested dsh-tools 0.1.2-rc.1. Corrected
the declaration to ^0.1.2-rc.1 and added semantic checks for every package peer
against the installed host. peer-metadata-red retains the false result; the
new package check must pass all six peers. No native JS/runtime changed.

CI 34859657539: pnpm alignment alone did not repair peer resolution (dsh-scope
>=0.1.2 <0.2.0-0). Preserve this failed hypothesis. The subsequent package peer
correction passes the local six-peer semantic check; fresh installation remains
to be verified. Repository/support metadata now points to the actual private repo.
