# Real task starter

[English](MODEL_STARTER.md) · [简体中文](MODEL_STARTER.zh-CN.md)

Complete [installation and the free check](../QUICKSTART.md) first. Keep `DUO_PACKAGE` and `DUO_DSH_PACKAGE` set in this shell. This path uses your explicitly authorized model configuration and budget.

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
| Editable prompt Target | [target.txt](../examples/model/target.txt) → `target.txt` |
| Public source document | [runbook.md](../examples/model/runbook.md) → `runbook.md` |
| Four questions and expected answers | [tasks.json](../examples/model/tasks.json) → `tasks.json` and executable `dataset.json` |
| Local content-and-citation evaluator | [evaluator.js](../examples/model/evaluator.js) |
| Model/pricing template | [model.example.json](../examples/model/model.example.json) |
| Provider composition and experiment | Generated `dsh-home/profiles/duo-product/cordis.patch.yml` and `experiment.json` |

This starter supports the existing `deepseek-official / deepseek-flash` route.
Use [Provider contracts](../PROVIDERS.md) for other compositions; installing another
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
