# @dual-loop/dsh-plugin

Version 0.3.0 runs DualLoop inside DSH as Cordis services. The default entry
contains the experiment controller, evidence policies, persona overlays and
persistent accounting in JavaScript. It does not invoke the Python CLI.
The earlier Python bridge remains available explicitly as `/legacy`.

## Offline verification from source

From the repository root, run the existing verifier against an installed DSH
package. Python 3.10+ and PyYAML are needed for this verification script; the
native plugin runtime needs Node 24+, not Python.

```sh
python3 scripts/verify_dsh_native.py --dsh-package /absolute/path/to/node_modules/@deepseek-ai/dsh --scenario packaged --output /tmp/new-duo-check
```

The verifier invokes the actual DSH CLI and DUO public tools in a fresh profile,
using scripted, zero-cost providers. Inspect `report.json` and the generated
`product-report.json`. It does not call a model or establish optimization benefit.
The output directory must not already exist.

## Install the package into DSH

Requires an existing DSH installation on Linux with Node 24+.

1. **Pack** from this source directory. There is no build step and no runtime
   dependency to fetch, so packing works offline:

   ```sh
   cd dsh-plugin
   npm pack --offline --ignore-scripts   # produces dual-loop-dsh-plugin-0.3.0.tgz
   ```

2. **Install** into an existing, authorized Agent profile. In this example,
   `duo-demo` must already supply the host application, system prompt and tools
   (for example through `@deepseek-ai/dsh-base`). Adding this bundle alone does
   not configure a model or supply an Agent application. `dsh plugin` forwards to pnpm in the
   profile directory; because the package declares `dsh.bundle`, the bundle is
   auto-appended to `dsh.profile.bundles`:

   ```sh
   dsh plugin --profile duo-demo add /absolute/path/dual-loop-dsh-plugin-0.3.0.tgz
   ```

   This installation step may resolve peer dependencies and access the registry.
   An installation error is not a successful install. Check the exit status,
   installed package, and profile bundle list before proceeding. The offline
   verifier above uses an existing DSH cache; it does not prove installation on
   a machine without dependencies.

3. **Set the two required paths** in the profile's own
   `$DSH_HOME/profiles/duo-demo/cordis.patch.yml`. Patch config replaces the
   entire row config:

   ```yaml
   - id: duo-contract
     config:
       experiment: $DSH_HOME/profiles/duo-demo/node_modules/@dual-loop/dsh-plugin/examples/experiment.json
   - id: duo-journal
     config:
       root: /absolute/path/to/a-new/native-runs
   ```

   Use the real absolute paths; `$DSH_HOME` above is literal shell shorthand.
   The shipped `examples/experiment.json` + `examples/persona.txt` pair and the
   default-wired offline fixture providers make this a zero-cost run: no model,
   network or paid permission is involved.

4. **Inspect the composed tree** without booting anything:

   ```sh
   dsh --profile duo-demo --dump-config
   ```

   Expected output: a layer header `# == @dual-loop/dsh-plugin, patched by
   .../duo-demo/cordis.patch.yml` listing the `duo-onboarding` …
   `duo-offline-fixture`, `dualloop` rows with your two absolute paths applied.
   A configuration dump does not execute the experiment. Use the offline
   verifier above for an executable plan → run → report demonstration. For a
   Calling Agent, compose this bundle into the host's configured Agent profile
   and follow [AGENT_GUIDE.md](AGENT_GUIDE.md). That Calling Agent's model requests
   can cost money even when the DUO work providers are free fixtures; authorize
   and account for those requests separately.

## Composition

The execution bundle supplies the existing eight core providers, a read-only Observer,
onboarding tools and execution/report tool consumers:

| Service | Provider export | Responsibility |
|---|---|---|
| `duoContract` | `/contract` | Validate and freeze an explicit native JSON experiment |
| `duoTarget` | `/target` | Snapshot a persona; apply parent-bound candidate overlays |
| `duoComparator` | `/comparator` | Admit evidence; compare weighted metrics and hard constraints |
| `duoGate` | `/gate` | Select fast candidates for bounded slow evaluation |
| `duoFeedback` | `/feedback` | Feed admissible slow observations into the next generation |
| `duoJournal` | `/journal` | Persist run ownership, transitions and receipts in SQLite |
| `duoBudget` | `/budget` | Reserve cost atomically; settle or reconcile bound receipts |
| `duoController` | `/controller` | Run fast → gate → slow → feedback → separate final evaluation |
| `duoObserver` | `/observer` | Read stage states, lineage, decisions and latest accounting |

The remaining three services — `duoGenerator`, `duoExecutor` and
`duoEvaluators` — are supplied by the bundled `/offline-fixture` provider,
which the default [cordis.patch.yml](cordis.patch.yml) wires with
`currency: CNY`. It is explicitly synthetic (no model, network or subprocess
calls, zero cost) so a fresh install boots and runs end to end; replace it with
your own providers for real work. Their definition classes are exported by
`/definitions`. See [PROVIDERS.md](PROVIDERS.md). Cordis owns each
provider's lifetime and dependency injection. Removing a required provider
unregisters the dependent DUO tools; adding a replacement reactivates them.
At startup, however, DSH rejects a tree with required services still pending.
To compose a profile before your providers exist, use the standalone
`/onboarding` plugin in a setup profile without activating the full execution
bundle; see the [Agent guide](AGENT_GUIDE.md) (shipped with this package).

The bundled fixture checks static text. Optional `/model-executor` and
`/model-generator` providers now use DSH's native Agent lifecycle; `/docs-evaluators`
judges actual answers and citations. Follow the repository's
`NATIVE_MODEL_GUIDE.md` and `STATUS.md` (not shipped in this package) to
distinguish offline functionality from completed real model runs. The previous
Python paid-session adapters remain separate.

## Configure a profile

Requires an existing DSH installation, Node **24+**, and **Linux** for process
ownership checks. Verification used cached DSH `0.1.2-rc.1`, Cordis `4.0.2` and
Node `24.14.1`. Node's SQLite support currently emits an experimental warning.
Windows/macOS ownership support has not been implemented or tested.

Once this local package is available in the profile's `node_modules`, declare:

```json
{"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base","@dual-loop/dsh-plugin"],"patchReload":"startup"}}}
```

The two required configuration overrides are `duo-contract.config.experiment`
and `duo-journal.config.root`; the quickstart above shows both. The repository's
`examples/native/` directory (not shipped in this package) contains further
contract/persona/provider variants and complete profile patches.
Patch config replaces the entire row config. Do not put the old Python
`experiment/coreDir/journalDir` config on the native tools row.

A profile that inserts provider modules by relative path (for example
`./fixture-provider.js`) must give its own `package.json` a `version` field
(and `"type": "module"` for ES-module files): the relative entry makes the
profile itself an active loader package, and DSH's package-inventory request
extension fails every model request when that manifest has no `version`.

The default execution bundle wires the bundled offline fixture providers, so a
fresh install boots and the tools are immediately usable at zero cost. To bring
your own generator/executor/evaluators, disable the bundled row and insert your
own provider plugin in the profile patch — registering the same service twice
throws and DSH refuses startup:

```yaml
- id: duo-offline-fixture
  disabled: true
- insert:
  - id: my-providers
    name: ./my-provider.js
```

A setup profile loads only `/onboarding` alongside host tools. The repository's
`examples/native/onboarding-profile.patch.yml` (setup) and
`examples/native/byo-profile.patch.yml` (BYO execution) demonstrate these
separate compositions. A configuration
file's permission declarations describe trusted provider behavior; they do not
create authority or an OS sandbox. Use existing DSH approval/isolation mechanisms
when implementing an executor with real side effects; see
[SECURITY.md](SECURITY.md).

## Agent tools (native API version 2)

| Tool | Input | Result |
|---|---|---|
| `dualloop_describe` | `{}` | Static product schema and provider contracts; works in setup composition |
| `dualloop_design` | `{ "draft": {...}, "experimentPath": "/absolute/file.json" }` | Read-only missing-input list / canonical draft validation; no authority or run |
| `dualloop_discover` | `{}` | Configured provider identities, capabilities and limits |
| `dualloop_plan` | `{}` | Frozen inputs, provider descriptors, `planDigest`, `runId` |
| `dualloop_run` | `{ "planDigest": "…" }` | Native run result and cumulative accounting |
| `dualloop_report` | `{ "runId": "…", "includeEvents": false }` | Candidate stages, lineage, decisions, latest cost and readable table |
| `dualloop_status` | `{ "runId": "…" }` | Stored terminal result, events and latest budget |
| `dualloop_budget_status` | `{ "runId": "…" }` | Latest read-only reservation ledger |
| `dualloop_budget_reconcile` | `{ "runId": "…", "receiptHash": "…" }` | Apply an already-staged bound receipt once |

Inspect the plan before run. Changed contract, persona, root or versioned provider
descriptors invalidate its digest. Provider authors must include all behaviorally
relevant configuration/data identities in `describe()` and change the version
when implementation changes; DUO does not hash arbitrary external provider code.
Plan/discovery read trusted provider metadata but do not execute their work methods
or create run artifacts. A repeated terminal plan returns artifacts; an interrupted
nonterminal run refuses blind replay. Status never resumes work.

Results distinguish `completed`, `failed`, and `cancelled` execution from
`recommend_candidate`, `retain_baseline`, or `insufficient_evidence`. Invalid final
evidence cannot justify either recommendation or retention. Fast-only results
identify a proxy leader; exploration emits hypotheses without invented scores.
`improvementProven` remains false. Candidate overlays never replace the original persona.

## Persistence and budget semantics

Each native run owns `<root>/<runId>/duo.sqlite`. SQLite transactions serialize
cross-process admission; integer nano-units in the ledger currency conservatively round reservations
up and caps down. The journal is an injectable provider because DSH's cached
storage-domain read/modify/write API does not provide cross-process atomic admission.
A copied/moved ledger is refused until an explicit audited migration exists.
Python journals are neither converted nor reused as native allowances.

`maxSessions` in the native JSON contract bounds **provider operations**: generator,
executor and evaluator calls each reserve separately. It is not a count of model
sessions. Fast/slow limits count evaluation attempts before execution; final
attempts share the slow allowance. Generation/selection/evaluation totals are
reported separately. The built-in deterministic selection service costs zero.
Paid reservations are validated against explicit contract permission and caps;
current evidence for real native requests and their limits is recorded in the
repository's `STATUS.md` (not shipped in this package).

Missing cost stays `null`, keeps the reservation, and blocks further work. A late
finite receipt can settle that same interrupted operation; a receipt for another
operation cannot clear it. Overruns are retained in full and stop admission.
Cancellation stops scheduling and propagates `AbortSignal`; disposal drains
already-admitted calls before closing the journal. Providers must settle after
abort: an uncooperative in-process provider can delay disposal indefinitely.
There is no hard-kill sandbox for arbitrary JavaScript. A process crash without
a staged receipt leaves unknown cost, not inferred zero. The stored terminal
result is immutable; inspect top-level `status.budget` for later settlement.

## Reproduce offline verification

From the `dualloop/` project root, using an already-cached DSH package:

```sh
DUO_DSH_PACKAGE=/path/to/node_modules/@deepseek-ai/dsh node --loader ./scripts/dsh_native_loader.mjs --test dsh-plugin/native/*.test.js
python3 scripts/verify_dsh_native.py --dsh-package /path/to/node_modules/@deepseek-ai/dsh --output /tmp/new-native-duo-check
```

The verifier packs offline without scripts, stages byte-matching package files
in a new `DSH_HOME`, and uses the real CLI, loader and ToolRuntime. Twenty-one named
profiles cover a full base composition, a different generator, cancellation,
three-stage search, pause/resume, evaluation-only runs, live provider
unload/replacement, standalone setup, BYO evaluator/search/report usage,
frozen external-validator controls, constant-score and missing-dependency
negative controls, explicit noise repeats, warm start, missing-interface and
no-progress refusals, evaluation failure, embedded agent-loop use (allowed and
denied) and guarded adoption. All child-process APIs are forbidden during
native tool execution. The Python verifier launches the host; the plugin run
itself stays in that host process. No model calls or registry installs occur.

Current receipts and limits are linked from the repository's `STATUS.md` (not
shipped in this package).

The historical `dual-loop-dsh-plugin-0.1.0.tgz` tarball was never officially
released, is deprecated, and has been removed; install only a freshly packed
tarball of the current version as shown in the quickstart.

## Explicit legacy compatibility

Use the `/legacy` export and [legacy.patch.yml](legacy.patch.yml) to keep the old
Python behavior. This is a profile patch, not the package's default native bundle.
Retain the old `experiment`, `coreDir`, `python`, `journalDir` and `runTimeoutMs`
configuration. Do not register native and legacy tools in the same service scope:
their names overlap and their inputs differ (`planDigest` vs `plan_digest`).
The Python protocol and historical experiments are preserved.

```sh
python3 -m pytest tests/ -q -m 'not research'
node --test dsh-plugin/core-bridge.test.js
python3 scripts/verify_dsh_host.py --dsh-package /path/to/node_modules/@deepseek-ai/dsh --output /tmp/new-legacy-duo-check
```

The source repository's `dsh-plugin/SPIKE.md` records the earlier thin-bridge
spike. It is historical material and is not shipped in the package.

## Optional design-completion providers

- `/structured-generator` and `/history-feedback`: one native model call with
  code-assigned append/replace/compose operators and all ranked candidate history.
  `/model-generator` and `/feedback` preserve their original behavior.
- `/function-evaluators`: adapt an existing JavaScript evaluation function with
  native identities, versioned descriptors, CNY accounting and evidence limits.
- `/exclusion-comparator`: frozen per-candidate/evaluator/version/data/tier
  exclusions, preserving raw Journal evidence. Use the same exclusion list on
  `/history-feedback` so contaminated evidence cannot steer generation.
- `/observer` + `/observer-tools`: read-only native reports and derived JSONL
  exports. They never re-evaluate, change a score or deploy a candidate.

Provider replacement in the verified DSH snapshot requires disabling the old row
and inserting a new row. Changing `name` on an existing-ID patch is a guard
mismatch and the patch is skipped. The BYO patch demonstrates the correct form.

Type declarations accompany `/definitions` and `/function-evaluators`. They have
passed syntax parsing; no TypeScript semantic compiler was available in the local
verification environment. Actual runtime service/tool validation remains in force.
