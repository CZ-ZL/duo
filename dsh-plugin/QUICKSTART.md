# Quickstart

[English](./QUICKSTART.md) · [简体中文](./QUICKSTART.zh-CN.md)

Two paths share the same installed package and public tools:

- [Free installation check](#free-installation-check): local text measurements, no model requests.
- [Real task starter](#real-task-starter): a model tries one change to a documentation-answering prompt, then answers four questions with each version.

Use Linux, Node 24+, pnpm and an existing DSH installation. The tested host is
DSH 0.1.2-rc.1 / Cordis 4.0.2. The package is a developer preview; see
[current support](./CURRENT_STATUS.md). Installing it does not connect your model
account or authorize spending.

## Install once in an isolated profile

Version 0.6.3 is an untagged source preview.
These commands package the current public source locally, then install that
archive. Git and npm are needed for this step; no source dependencies or build
are required. Keep DUO_SOURCE_COMMIT and SHA256SUMS with the report. The checksum
records the local artifact, not a separately signed publisher receipt. The latest
previous Release remains [v0.6.2](https://github.com/CZ-ZL/duo/releases/tag/v0.6.2);
it does not contain this new starter.

Run these Bash commands in a new working directory. Replace only the DSH path:
`DUO_DSH_PACKAGE` is the installed directory containing `lib/bin.js`, not a
private profile or an API key. The remaining paths are created under this directory.
If the registry is unreachable, review the [existing-host option](#install-with-existing-host-dependencies)
below before running the install command.

```sh
export DUO_DSH_PACKAGE=/absolute/path/to/node_modules/@deepseek-ai/dsh
export DSH_HOME="$PWD/duo-install-home"
export DSH_TELEMETRY_DISABLED=1
export npm_config_cache="$PWD/npm-cache"
git clone --depth 1 https://github.com/CZ-ZL/duo.git duo-source
git -C duo-source rev-parse HEAD > DUO_SOURCE_COMMIT
npm pack ./duo-source/dsh-plugin --offline --ignore-scripts --pack-destination "$PWD"
sha256sum dual-loop-dsh-plugin-0.6.3.tgz > SHA256SUMS
sha256sum -c SHA256SUMS
mkdir -p "$DSH_HOME/profiles/starter"
node --input-type=module -e 'import{writeFileSync}from"node:fs";writeFileSync(process.env.DSH_HOME+"/profiles/starter/package.json",JSON.stringify({name:"duo-starter-profile",version:"1.0.0",private:true,type:"module",dsh:{profile:{bundles:[],patchReload:"startup"}}}),{flag:"wx"})'
node "$DUO_DSH_PACKAGE/lib/bin.js" plugin --profile starter add "$PWD/dual-loop-dsh-plugin-0.6.3.tgz" --ignore-scripts --store-dir "$PWD/pnpm-store" --fetch-retries=0 --fetch-timeout=15000
node "$DUO_DSH_PACKAGE/lib/bin.js" --profile starter --dump-config
export DUO_PACKAGE="$DSH_HOME/profiles/starter/node_modules/@dual-loop/dsh-plugin"
node "$DUO_PACKAGE/bin/duo.mjs" --help
```

Stop if a command fails. Dependency installation can contact the package registry;
it makes no model requests. The npm cache and pnpm store stay in this working
directory, avoiding writes to a global cache.
On ERR_PNPM_META_FETCH_FAIL, retain the output and restore registry connectivity
before retrying; do not disable TLS verification. The archive is the plugin; the GitHub repository root
is not an installable DSH bundle. These commands create a separate profile and
do not read or modify your usual profile. Keep the archive and checksum for recovery.

### Install with existing host dependencies

For an already complete DSH 0.1.2-rc.1 installation, DUO can use the host's
installed peer dependencies. This is useful when the npm registry is unavailable.
It does not install DSH, fetch missing dependencies, or make model calls offline.

In the install block above, replace only the `plugin add` command with:

```sh
node "$DUO_DSH_PACKAGE/lib/bin.js" plugin --profile starter add "$PWD/dual-loop-dsh-plugin-0.6.3.tgz" --ignore-scripts --store-dir "$PWD/pnpm-store" --fetch-retries=0 --fetch-timeout=15000 --offline --config.auto-install-peers=false
```

Then continue with `--dump-config`, `--help` and the chosen task path below.
If an online install already failed, keep its logs and start these steps in a
new working directory. This option uses DSH's existing host dependency resolution;
it does not copy a private profile or require manual module links. pnpm may warn
that peers are absent from the isolated profile. Confirm discovery and planning
actually load them; if a component is missing or incompatible, stop and install
the required host dependencies before running. A successful pack alone is not
a load check. The standard registry installation remains available above.

## Free installation check

This example removes trailing spaces from a supplied text Target. It checks
installation and the full product flow, not an LLM's task ability. Choose a
directory that does not yet exist.

```sh
export DUO_WORK="$PWD/duo-local-check"
node "$DUO_PACKAGE/bin/duo.mjs" init --root "$DUO_WORK" --dsh-package "$DUO_DSH_PACKAGE" --example optimize
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_describe > "$DUO_WORK/describe.json"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_plan --args '{"view":"summary"}' > "$DUO_WORK/plan.json"
cat "$DUO_WORK/plan.json"
```

Inspect the plan: `optimize-basic`, local providers, `paid:false`,
`network:false`, CNY0. Then run and retrieve both the full and summary reports:

```sh
export DUO_PLAN_DIGEST="$(node -e 'const p=require(process.env.DUO_WORK+"/plan.json");if(p.isError)throw Error(JSON.stringify(p.error));process.stdout.write(p.value.planDigest)')"
export DUO_RUN_ID="$(node -e 'process.stdout.write(require(process.env.DUO_WORK+"/plan.json").value.runId)')"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_run --args "{\"planDigest\":\"$DUO_PLAN_DIGEST\"}" > "$DUO_WORK/run.json"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_report --args "{\"runId\":\"$DUO_RUN_ID\"}" > "$DUO_WORK/report.json"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_report --args "{\"runId\":\"$DUO_RUN_ID\",\"view\":\"summary\"}" > "$DUO_WORK/report-summary.json"
cat "$DUO_WORK/report-summary.json"
```

Expected: execution `completed`, `single_fidelity`, no Slow evidence, CNY0
inner model charges, and an unchanged `target.txt`. A candidate may be selected
on development measurements while the conclusion remains `insufficient_evidence`
because no independent final test was supplied. These are different statements.
Reading a report again starts no work.

For evaluate-only, use a fresh directory and `--example evaluate`; follow the
same describe/plan/run/report commands. No Generator runs in that mode.

## Real task starter

**Acceptance status:** an independent Caller completed the real starter using
this public guide, with evaluator v2. The original and generated candidate tied;
the original was retained. See the [recorded run](https://github.com/CZ-ZL/duo/blob/main/docs/product-foundation/first-use/STARTER_RESULT.json).
This validates the product path, without an independent Slow or final test.

The sample Agent answers questions about a fictional deployment runbook. DUO
measures the original prompt, asks the model for one prompt Delta, executes that
candidate, and measures its answers. The evaluator checks actual command and
endpoint answers, citations, and whether an unsupported SLA question is left
unanswered. It does not execute deployment commands.

The evaluator `starter-runbook-fast` v2 checks exact facts and citations, ignoring
surrounding whitespace and one complete inline-code wrapper. It does not extract
answers from prose or accept a different command/endpoint. Per-task `answerExact`
also records whether the original answer text matched literally.

The supplied setup is complete (generated paths are relative to `DUO_WORK`):

| Input | Shipped file / generated working copy |
|---|---|
| Editable prompt Target | [target.txt](./examples/model/target.txt) → `target.txt` |
| Public source document | [runbook.md](./examples/model/runbook.md) → `runbook.md` |
| Four questions and expected answers | [tasks.json](./examples/model/tasks.json) → `tasks.json` and executable `dataset.json` |
| Local content-and-citation evaluator | [evaluator.js](./examples/model/evaluator.js) |
| Model/pricing template | [model.example.json](./examples/model/model.example.json) |
| Provider composition and experiment | Generated `dsh-home/profiles/duo-product/cordis.patch.yml` and `experiment.json` |

This starter supports the existing `deepseek-official / deepseek-flash` route.
Use [Provider contracts](./PROVIDERS.md) for other compositions; installing another
Target does not adapt these persona-specific model providers.

### Supply your model configuration and authority

Copy the model template into a file you own. Verify its tariff against the
[official price page](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/);
record the current UTC `verifiedDate`. Do not copy today's date without checking
the rates and schedule. An out-of-date tariff is refused before paid execution.

```sh
cp "$DUO_PACKAGE/examples/model/model.example.json" "$PWD/duo-model.json"
export DUO_MODEL_CONFIG="$PWD/duo-model.json"
```

You supply: the existing DSH path, this model configuration reference, a new work
directory, an authorized `DEEPSEEK_API_KEY` in the process environment, and a CNY
budget. Do not put a key in JSON, shell arguments, a profile, a report or Git.
Use your existing credential injection mechanism.

Normal completion needs **at most three model requests**: original execution,
one candidate generation, one candidate execution. Each execution batches the
four questions. Local scoring makes no additional model requests. Retries are
disabled; malformed output is retained and can leave the path incomplete.
At the template tariff the three-request reservation envelope is CNY0.30; this
is a conservative admission bound, not an expected charge or a grant.

Without permission you can prepare safely:

```sh
export DUO_WORK="$PWD/duo-qa-preparation"
node "$DUO_PACKAGE/bin/duo.mjs" init --root "$DUO_WORK" --dsh-package "$DUO_DSH_PACKAGE" --example grounded-qa --model-config "$DUO_MODEL_CONFIG"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_describe
```

Planning/running paid work is blocked. A visible provider binding is not authority.

For an authorized run choose a new directory and set `DUO_AUTHORIZED_CNY` to the
amount the owner actually approved. The line below intentionally requires that
value rather than supplying a grant:

```sh
: "${DUO_AUTHORIZED_CNY:?Set this to the owner-approved CNY limit; do not invent a budget}"
export DUO_WORK="$PWD/duo-qa-run"
node "$DUO_PACKAGE/bin/duo.mjs" init --root "$DUO_WORK" --dsh-package "$DUO_DSH_PACKAGE" --example grounded-qa --model-config "$DUO_MODEL_CONFIG" --allow-paid --max-cost-cny "$DUO_AUTHORIZED_CNY"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_describe > "$DUO_WORK/describe.json"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_plan --args '{"view":"summary"}' > "$DUO_WORK/plan.json"
cat "$DUO_WORK/plan.json"
```

Before running, inspect the model, target path, evaluator, dataset, one generation,
one proposal, basic mode, no Slow/final, and the approved limit. The editable
working copies are yours. If changing the task after preparation, edit
`dataset.json` (the execution snapshot); editing only `tasks.json` or
`runbook.md` does not rebuild it. Keep expected answers consistent with the
document, bump the data/evaluator version when changing measurement, and re-plan.
Do not modify a dataset after its run starts.

### Execute and read the result

```sh
export DUO_PLAN_DIGEST="$(node -e 'const p=require(process.env.DUO_WORK+"/plan.json");if(p.isError)throw Error(JSON.stringify(p.error));process.stdout.write(p.value.planDigest)')"
export DUO_RUN_ID="$(node -e 'process.stdout.write(require(process.env.DUO_WORK+"/plan.json").value.runId)')"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_run --allow-paid --args "{\"planDigest\":\"$DUO_PLAN_DIGEST\"}" > "$DUO_WORK/run.json"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_status --args "{\"runId\":\"$DUO_RUN_ID\"}" > "$DUO_WORK/status.json"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_report --args "{\"runId\":\"$DUO_RUN_ID\"}" > "$DUO_WORK/report.json"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_report --args "{\"runId\":\"$DUO_RUN_ID\",\"view\":\"summary\"}" > "$DUO_WORK/report-summary.json"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_budget_status --args "{\"runId\":\"$DUO_RUN_ID\"}" > "$DUO_WORK/budget.json"
cat "$DUO_WORK/report-summary.json"
```

The report lists candidate identity, Delta, Fast measurements, selection reasons,
limitations and cumulative inner cost. `sessions/` retains execution artifacts
and usage; `journal/` retains the experiment and receipts; `calls/` retains
public requests, responses and host logs. These files may contain your later
private task content; do not publish raw work directories.

Completion, candidate selection and independent confirmation are separate.
Expect `single_fidelity / unavailable` and no independent final claim. Retaining
the original is valid. A generated but invalid/unexecuted candidate is not a
successful real starter run. The original `target.txt` is never adopted over.

Cost uses observed model usage and the frozen tariff, including failed calls
when usage is available. It is not an account invoice. Calling Agent inference
and local computing resources are outside the DUO ledger; CNY0 local-provider
charges do not mean zero total cost. Stop on unknown fees, an exhausted limit,
or incomplete candidate evaluation; inspect retained evidence before any separately
authorized retry. A fresh folder does not reset a spending grant.

## Errors, continuation and other components

| Outcome | Next action |
|---|---|
| No Evaluator | Use describe/design to identify the missing binding. Restore the shipped starter evaluator or connect a compatible function; do not invent scores. |
| `DUO_STARTER_MODEL_UNSUPPORTED` | Use the declared starter route/config, or follow Provider contracts for a different composition. No model work was dispatched by init. |
| `DUO_STARTER_AUTHORIZATION_REQUIRED` | Obtain authority. Then update working `experiment.json` permissions and budget and inspect a new plan. Keep zero allowance until approved. |
| `DUO_STARTER_CREDENTIAL_REQUIRED` | Supply the named credential through the environment. The refused call started no model work. |
| `DUO_PLAN_CHANGED` | Inspect a new plan after a target/provider/data change. Do not reuse the old digest. |
| Unknown cost, pending receipt, lock or interrupted request | Read retained status/ledger. No automatic replay, ledger reset, inferred zero fee or lock deletion. |

[Agent Guide](./AGENT_GUIDE.md) describes the public lifecycle.
[Local examples](./examples/product/README.md) cover BYO evaluators, a custom
Target, component replacement, warm start, cancellation and supported recovery.
[API reference](./AGENT_REFERENCE.md) defines those boundaries.

For upgrades, keep the previous verified archive and profile. Test the new version
in a new isolated workspace before using it. Re-plan after provider changes;
do not resume old checkpoints under a changed graph. Returning to an old version
does not undo charges or authorize replay.
