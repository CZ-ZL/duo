# Public local examples

These examples execute DUO through an actual installed DSH CLI and ToolRuntime.
They measure trailing whitespace in supplied text. They use no model, network,
private account, research archive or historical ledger. They do not measure an
LLM Agent's task quality or establish method benefit. Local functions are real
measurements; the example is intentionally narrow.

The `custom` adapter uses `original` as its baseline ID. Final measurements and
reports use the identity supplied by that Target, rather than a required literal
name. Its provider version is 2; inspect a new plan after replacing an older copy.

Install the reviewed tarball into your authorized DSH profile using the package
README. The commands below use the `duo` executable shipped in that package;
equivalently use `node /path/to/installed/package/bin/duo.mjs`.
`--dsh-package` is your installed `@deepseek-ai/dsh` directory containing
`lib/bin.js`, not a command or private profile. Each `init` needs a new directory.
It stages the installed package's declared files into an isolated example
profile; this is setup, not registry installation. No existing profile is edited.

```sh
duo init --root /tmp/my-duo --dsh-package /path/to/node_modules/@deepseek-ai/dsh --example optimize
duo call --root /tmp/my-duo --tool schemas
duo call --root /tmp/my-duo --tool dualloop_describe
duo call --root /tmp/my-duo --tool dualloop_plan --args '{"view":"summary"}'
```

Inspect the plan's target, providers, permissions and limits. The result wrapper
is `{isError,value,error,content}`; `value.planDigest` is the exact digest to use.
Only when the plan is within your authority, call:

```sh
duo call --root /tmp/my-duo --tool dualloop_run --args '{"planDigest":"EXACT_DIGEST"}'
duo call --root /tmp/my-duo --tool dualloop_status --args '{"runId":"RUN_ID"}'
duo call --root /tmp/my-duo --tool dualloop_report --args '{"runId":"RUN_ID","view":"summary"}'
duo call --root /tmp/my-duo --tool dualloop_budget_status --args '{"runId":"RUN_ID"}'
```

The return values are retained under `calls/` with unique request/response files
and host logs. `journal/` holds the native ledger. `target.txt` remains unchanged;
the result's selectedOverlay is an unadopted candidate. Repeated report reads do
not execute providers. No final dataset is claimed by this text-only example. An optimization report
therefore returns `insufficient_evidence` for a qualified recommendation even
when the measured development text improves; this is an evidence boundary, not
a runtime failure.

| Example (`init --example`) | What changes | Expected observation |
|---|---|---|
| `evaluate` | Evaluation-only runtime, no generator | Current target measured; generationsRun=0, no candidate |
| `optimize` | optimize-basic: local normalizer + one text evaluator | Two bounded generations; normalized overlay; original file unchanged |
| `dual` | optimize-dual: adds executable template assertions | expanded_evidence; coverage receipts and bounded decisions; no high-fidelity claim |
| `byo` | Evaluator registered from a separate function plugin | Plan identifies the BYO implementationDigest; same public lifecycle |
| `replace` | HistoryFeedback replaces default feedback | Plan policy historyOrder is recent_failures_first |
| `warm` | Start with the same normal local run | Follow the history steps below; next generation receives validated history |
| `custom` | Supplied local-text adapter (content snapshots, no persona/config fields) | Complete public lifecycle without core edits; warm history supported |
| `setup` | No work providers | Discovery works, missing providers explicit, no execution tool |

**Warm start:** after completing the first `warm` run, retain its runId. Edit only
your example `experiment.json`: change `id` to `local-warm-next` and add
`"warmStart":{"runIds":["PREVIOUS_RUN_ID"]}`. Leave target.path and journal root
unchanged. Re-plan, inspect warmStart.mode/context/sources and the original costs,
then run with the new digest. The second result records historyReuse; the
candidate hypotheses record the historical candidate ids received. Old costs are not
imported; the current baseline is re-evaluated. This is a new run, not recovery.

Generator authors receive `feedback.warmStart.records`, the projected records
shown in `plan.warmStart.context.records`. Each has `source`, `use`, `role`,
`reasons`, `hypothesis`, and a Target-projected `delta` (null for baseline).
`family` is not a public history field. `role` is `baseline`, `good`, `failure`,
or `direction`; it describes past evidence, not a current recommendation.

```js
// Inside your Generator.propose request handler, after inspecting the plan:
const records = feedback.warmStart?.records ?? []
const idea = records.find(r => r.role === 'good' && r.delta)
// A bounded generator may use idea.delta as one proposal. Bind the proposal to
// the CURRENT champion id/version and quotas; the Target validates it again.
// Record idea.source in generation evidence and re-execute/re-evaluate it.
// Do not assume source.parentVersion still equals the current champion.
const past = idea?.use === 'comparable_declared' ? idea.observations : undefined
// past is historical evidence, never a substitute for this run's measurement.
```

Empty history is valid cold start. `ideas_only` records have no numeric
observations/verdicts. Provider or evaluator version changes can cause that
projection; inspect `sources[].reasons` and re-plan after changing an adapter.
Never add private final observations or restore removed fields yourself. A record
in the plan proves availability; save the actual generator input/source receipt
to establish consumption. This text-hygiene example records received ids and has
one fixed transformation; it does not demonstrate broad history-driven search.

**Zero-cost local configuration:** use `permissions.paid:false` and
`budget:{currency:"CNY",maxCostCny:0,maxSessions:2,maxFastEvals:1,maxSlowEvals:0,maxWallTimeMs:60000}`
for a bounded evaluate-only run. Omit `maxCumulativeCostCny`: the optional
cross-run cap currently accepts positive amounts only, so explicit zero is
invalid. Keep every new local run at zero; do not enter a positive amount to
work around validation. Paid providers must not be used under this configuration.
Cross-run/Calling Agent request limits still belong to the current authorization;
the native ledger does not include Caller inference. Omission does not renew money.

**Evaluator controls from the installed package:** the preparation interface
points to [the existing function adapter](byo-evaluator.js),
[control adapter](evaluator-controls.js), [control contract](evaluator-controls-experiment.json)
and [profile patch](evaluator-controls-profile.patch.yml). Use a NEW evaluate
workspace, then copy these templates into that workspace only:

```sh
duo init --root /tmp/my-duo-controls --dsh-package /path/to/node_modules/@deepseek-ai/dsh --example evaluate
python3 - /path/to/installed/package /tmp/my-duo-controls <<'PY'
import json, sys
from pathlib import Path
package, root = map(lambda p: Path(p).resolve(), sys.argv[1:])
examples = package / 'examples/product'
contract = json.loads((examples / 'evaluator-controls-experiment.json').read_text())
contract['target']['path'] = str(root / 'target.txt')
(root / 'experiment.json').write_text(json.dumps(contract, indent=2))
patch = root / 'dsh-home/profiles/duo-product/cordis.patch.yml'
rows = json.loads(patch.read_text())
rows += json.loads((examples / 'evaluator-controls-profile.patch.yml').read_text())
patch.write_text(json.dumps(rows, indent=2))
PY
duo call --root /tmp/my-duo-controls --tool dualloop_plan
```

Inspect this evaluation-only plan, then run/report using its exact digest/id as
above. Expect `control_match_rate=1`, `controls_distinguish=true`, sample_size=4,
and all `measurementChecks` satisfied. The wrapper invokes the actual local text
measurement four times on frozen good/bad outputs, all CNY0; no Generator runs.
It deliberately replaces the Executor artifact with control outputs. This tests
measurement plumbing only, not Target quality, Slow fidelity or optimization gain.
For a real task replace both measurement and fixed expectations with justified
task controls before any search; passing these text controls does not qualify it.

**Recover:** on a fresh optimize example, run with `pauseAfter:"baseline"`.
Read status.checkpoint, then call run with the same planDigest and
`resumeFrom: checkpoint.digest`. It continues within the original deadline and
budget. Plain run without resumeFrom refuses a paused run. A changed contract,
Target/provider or expired deadline prevents recovery. Interrupted calls with
unknown usage cannot be replayed. Do not edit a ledger to make it resumable.

**Cancellation:** `call ... --tool dualloop_run --args ... --cancel-after-ms 0`
passes cancellation through the native ToolRuntime. Inspect durable status and
budget; aborting an external provider does not prove that it charged zero.

**Use your own components:** edit the ordinary isolated profile at
`dsh-home/profiles/duo-product/cordis.patch.yml` (JSON is accepted as YAML), or use
your own authorized DSH profile. Disable the old row by id, then insert a new row
with the replacement module and a new id; changing `name` on an id-only patch
does not replace the module. Config changes alone use an id/config patch.
An evaluator-only replacement must disable the local provider's evaluator using
`local-work.config.evaluators:false`, then insert the adapter. Whole row config is
replaced by Cordis patches. Re-plan after any provider change. The supplied
byo-evaluator.js demonstrates wrapping an existing function. See the public
PROVIDERS.md for Target, Generator, Executor, comparison, gate and history hooks.

For real model work, use the published /model-generator or /structured-generator,
/model-executor and a matching evaluator with an authorized DSH model route,
caller-owned data and explicit current pricing/limits. The isolated example CLI
does not inherit credentials: compose such providers in your authorized host and
call the same DUO tools there. Installing a package or reading an example never
authorizes a paid run. The config Target needs a config-compatible executor.

Read EVIDENCE_STRATEGY.md for auto negotiation, forcing dual, source metadata and component replacement. Default optimize does not repeat the same evaluator as Slow. Basic results report single_fidelity/unavailable; no full dual validation is claimed.
