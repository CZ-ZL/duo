> Package-only readers: paths marked "source checkout" refer to files in the GitHub source distribution, outside this npm tarball. Historical run files require the separate research archive. The public tool and provider contracts below remain available without those files.

<!-- Canonical copy. dsh-plugin/AGENT_GUIDE.md is the shipped duplicate; dsh-plugin/native/docs-sync.test.js enforces sync. -->
# Calling DUO from DSH

DUO evaluates or optimizes an existing persona/system prompt inside DSH. Use it
when you have a measurable task and permission to test prompt changes. It returns
candidates, observations, costs and a recommendation. No improvement is a valid
outcome; it does not deploy a candidate. Format validity alone is not task quality.

## Start from your available inputs

Use the host's authorized setup/profile and the supplied resources. If execution
providers are not ready, preparation tools still work. Do not install dependencies
or infer money/permissions from example files.

1. `dualloop_describe({})` describes supported targets, current service availability,
   the native contract schema and provider boundaries. `executionReady:false` in
   this description means no executable contract has been validated yet.
2. `dualloop_design({draft, experimentPath, context})` checks your proposed contract
   without writing or running it. Supply an authorized target, task goal, evaluator,
   data identity and finite budget. Missing inputs are reported together. Optional
   `context.measurementGoal` is `task_result`, `format` or `cost`. For vague goals or
   no evaluator, follow `preparation` and its unresolved owner questions. Do not
   invent an objective, answer key, budget or authorization.
3. With a supplied compatible evaluator, inspect its declared semantics and fixed
   correct/incorrect controls. If the host exposes an authorized Cordis bridge,
   discover it using `cordis_inspect_list` and its advertised describe query, then
   use `cordis_define` and `cordis_run` to attach that exact adapter. New plugin
   `idPrefix` must be 3–6 lowercase English letters (the host adds a numeric suffix). Execution
   tools can appear after attachment. `authorityGranted:false` on a descriptor
   grants no new permission; existing task authorization still applies.
   `Service.listService` is a coding-contract catalog, not a live registry of all
   plugin bindings. For an uncatalogued supplied service, use its published
   plugin contract and observed runtime availability; absence from that catalog
   does not establish that the service is missing.
4. Save only the inspected, authorized contract at `experimentPath`. Call
   `dualloop_plan({view:"summary"})`, inspect providers, data, permissions, cost limits
   and stages (use `view:"full"` for complete provider semantics or history context),
   then pass the exact returned digest to `dualloop_run({planDigest})`. A changed
   contract/provider/target/build needs a new plan; a new ID is not new allowance.
5. Read `dualloop_report({runId, view:"summary"})` and `dualloop_budget_status({runId})`. Report actual
   stage completion, score meaning, uncertainty, candidate lineage and settled or
   unknown costs. A candidate not promoted has no later-stage result. Report
   generation and repeated reads require no model calls. Rich Caller explanation
   is optional and needs its own remaining allowance. Use `view:"full"` on demand
   for full candidate/provider/diagnostic facts; structured tool results retain them.

For only measuring the current target, use `operation:"evaluate"` with no search.
An evaluator can be a deterministic function; "real" measurement need not incur
another model request. Keep final data outside search and Caller setup resources.
Do not pool observations across changed evaluator, data, strategy or code versions.

## Read only the reference needed now

| Need | Public reference / example |
|---|---|
| Native schema and provider replacement | Live `dualloop_describe`, provider contracts (source checkout: `dsh-plugin/PROVIDERS.md`) and BYO patch (source checkout: `examples/native/byo-profile.patch.yml`) |
| Missing evaluator or unclear objective | [Preparation reference](AGENT_REFERENCE.md#before-configuration), control adapter (source checkout: `examples/native/evaluator-controls.js`), task-result example (source checkout: `examples/native/fact-task.md`) |
| Evaluation-only | Contract (source checkout: `examples/native/evaluation-experiment.json`) and profile (source checkout: `examples/native/evaluation-profile.patch.yml`) |
| Default two stages / explicit ladder of uncapped depth with caller-named tiers | Default contract (source checkout: `examples/native/experiment.json`), ordered stages (source checkout: `examples/native/ordered-stages.md`), four-level ladder (source checkout: `examples/native/ladder-experiment.json`) |
| Attach evaluator after startup | Deferred profile (source checkout: `examples/native/deferred-profile.patch.yml`); set `evaluationOnly:true` for an evaluation-only runtime |
| Warm start from authorized history | [Warm-start reference](AGENT_REFERENCE.md#start-a-new-experiment-with-native-history) and example (source checkout: `examples/native/warm-start.md`) |
| Model execution and cost preparation | Native model entry (source checkout: `NATIVE_MODEL_GUIDE.md`) |
| Clean Caller with complete inputs and supplied fact evaluator | Isolated Caller example (source checkout: `examples/native/calling-facts.md`) |
| Failure, pause, resume or readonly recovery | [Recovery reference](AGENT_REFERENCE.md#failure-and-recovery) |
| Explicit adoption and rollback on an authorized copy | Host recipe (source checkout: `examples/native/adoption.md`) |

A clean setup can use onboarding-profile.patch.yml (source checkout: `examples/native/onboarding-profile.patch.yml`).
The complete execution bundle requires all work providers; the shipped bundle
wires labelled zero-cost fixture providers so a fresh install boots, and the
deferred profile waits for runtime attachment. Replace the bundled fixture with
real providers for actual work; real providers, target data and authority must
be supplied separately.

## Budget and evidence boundaries

Reserve Caller preparation/interpretation separately from inner generation,
execution and evaluation. The native experiment ledger covers inner operations;
it does not enforce the Calling Agent's whole budget. A hosting entry may enforce
both and must say so. Never add overlapping ledger views as extra charges.
Unknown receipts stop paid work; reading retained reports does not reconcile cost.

`report.delivery` separates execution, artifact readiness and Caller delivery.
A rendered report is not evidence that an independent Caller received it.
`pauseAfter:"baseline"` or `"generation"` requests a settled checkpoint. Continue
with a current plan and exact `resumeFrom` digest only when checkpoint status
permits it. Original wall deadline and allowance remain. In-flight calls and
terminal failures cannot be blindly replayed. Warm start is a new experiment
using screened historical ideas; it is not recovery or renewed authorization.

Offline clean-host checks use an existing cached DSH package and a fresh output:

```sh
python3 scripts/verify_dsh_native.py --dsh-package /absolute/path/to/node_modules/@deepseek-ai/dsh --output /tmp/new-duo-check
```

These verify engineering with fixtures, not independent real Caller use or method
benefit. See current evidence (source checkout: `STATUS.md`). Legacy Python/YAML contracts remain
behind the explicit `/legacy` interface with separate schemas and ledgers.
