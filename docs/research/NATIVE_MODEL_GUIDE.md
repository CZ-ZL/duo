# Native minimum model optimization

This is the historical source-level model/research entry, not the default
installation path. Referenced `runs/` artifacts are retained in the private local
archive and are not distributed here. Current product instructions are in
[the Agent Guide](../../dsh-plugin/AGENT_GUIDE.md) and [CURRENT_STATUS.md](../../dsh-plugin/CURRENT_STATUS.md).
No old budget or example grants new paid authority.

The same entry also accepts an existing native contract via `--contract`, its
explicit `--dataset`, an ordinary `--profile-patch`, repeatable local
`--profile-file` modules and `--model-config`. A configured evaluation-only run
uses the selected provider and does not generate historical docs-demo inputs.
`--budget-groups` reserves each whole experiment against existing native CNY
ledgers, so independent attempts can share a bounded authorized batch. These
aggregate views must not be added to inner receipts as extra fees.

Inspect `prepare-plan.json` and the actual `*-config.stdout.txt` before execution.
Cordis `config` patches replace the entire config object; include all settings
that must survive replacement. This finite entry checks explicit DeepSeek
thinking mode, the planned token cap and zero retries in the composed provider
before sealing a live manifest. Preparation makes no model calls. Execute still
requires a current grant bound to the prepared plan and manifest. A broad user
grant may cover a recorded finite allocation; old batch balances are not grants.

The entry writes `product-report.json` and `product-report.txt` from the public deterministic report tool
even when no final Caller request is allocated. Failed runs and known fees remain
in their original directories. An earlier completed measurement now survives a
later-stage failure; this does not reconstruct missing historical Journal rows
or provide automatic continuation of unsettled work. `delivery-receipt.json`
records the saved file hashes, actual export request count and execution state.
The standalone entry records Caller as `NOT_USED_BY_THIS_ENTRY`; merely saving a
report is not independent Caller delivery. Inner budget limits exclude external
Caller preparation and optional explanation unless the host separately accounts
and bounds them. Export is attempted before outer settlement and on entry failure;
an export failure is retained separately without changing the original run result.

The public native tool supports explicit settled baseline/generation pause and
continuation within the original wall deadline and allowance. See
[checkpoint use and limitations](../../dsh-plugin/AGENT_GUIDE.md). This launcher performs complete
runs by default; it does not convert an interrupted paid attempt into a new budget
or automatically resume unknown work.

The existing native controller now has optional `/model-generator`,
`/model-executor`, and `/docs-evaluators` provider exports. The generator and
executor use the host's `ctx.agents.create()` lifecycle. The evaluator judges
model-produced answers and citations against frozen document facts. Native tools,
parent-bound persona overlays, SQLite Journal and budget accounting remain in use.

Current evidence is in [STATUS.md](../history/pre-organization/STATUS.md). Offline fixture completion is
functional verification; it is not a real model optimization or a real bill.

## Assign models to roles

The native `/model-generator` (or `/structured-generator`), `/model-executor`
and optional `/semantic-evaluators` each accept their own existing `provider`,
`model`, token/input limits, frozen pricing and CNY reservation. Configure these
in an authorized isolated Cordis profile; a shared launcher model config is only
a convenience for equal-model runs. The deterministic `/function-evaluators`
does not need a judge model. There is no additional model router to configure.

Inspect each selected descriptor under `dualloop_plan.providers`. Changing a
route changes that descriptor and requires a fresh plan. Each model operation
checks the actual provider/model/token cap against its declaration, allows one
request, and records the actual model and usage in its own retained receipt.
Retries introduced by another plugin are also subject to that request limit.
Role routing grants no access to additional providers or money, and different
model names do not establish higher measurement fidelity or savings.

The semantic provider accepts the optional `review` split for three-stage
engineering compositions and applies the same source checks and measurement
policy as other tiers. It sends only the requested split to the judge. The
measurement policy stays version 2; this support adds a tier, not a new score.

## Run with an existing DSH installation

Run from this project directory with Node 24+, Python/PyYAML and an already
installed DSH package. Linux is required by the current native ledger owner check.
No dependency installation or existing profile change is performed. Each output
directory must be new; the launcher stages a local package into its isolated
`DSH_HOME` and starts the **actual `dsh --profile duo-model-minimum` CLI**.

```sh
python3 scripts/research/run_dsh_model.py --mode offline \
  --dsh-package /absolute/path/to/node_modules/@deepseek-ai/dsh \
  --output /new/absolute/offline-output
```

The default fixture retains the baseline. Add `--fixture-scenario improve` to
exercise promotion and a two-candidate final comparison. Both fixtures fabricate
answers/usage deliberately; `paidCalls=0`, real `costCny=0`, and a separately
labeled `syntheticCostCny` make that boundary explicit.

Prepare the real provider composition without a model request:

```sh
python3 scripts/research/run_dsh_model.py --mode prepare-live \
  --dsh-package /absolute/path/to/node_modules/@deepseek-ai/dsh \
  --output /new/absolute/live-output \
  --pricing /absolute/path/to/fresh-pricing.json
```

`--pricing` is a frozen copy of the official CNY price table whose
`verifiedDate` must equal the **current UTC date** (not local date); refresh it
on the day you prepare. All arguments are validated before the output directory
is created, so a rejected attempt leaves no directory behind and the same name
can be retried.

Read `prepare-plan.json`, `prepared.json`, `inputs/provenance.json` and
`prepare-receipt.json`. The batch uses `deepseek-flash` (the current official
model id; the retired `deepseek-v4-flash` alias now serves DeepSeek-V4.1-Flash),
thinking disabled,
two generations, three candidates per generation by default, one persona target, up to
14 model requests and 26 native provider operations. Each operation reserves
CNY 0.15; the batch cap is CNY 3. These limits describe a prepared
request, not an inferred authorization to spend.

For the smallest complete experiment use `--candidates-per-generation 1`.
This keeps two generations and the same fast/slow/final rules, with one proposed
candidate in each generation (at most ten model requests). A corrected attempt
must deduct every earlier known charge/request from the allocation; pass the
remainder with `--max-cost-cny` and `--max-model-requests`, and bind that reduced
plan in its authorization record. Preserve all prior failed attempts. Unknown
costs cannot be deducted as zero or bypassed with a new directory.

Use a monetary allocation already explicitly authorized for this batch. Where
that allocation is missing or historical scopes conflict, resolve that specific
amount before executing. Record the actual authorization, bound to this plan:

```json
{
  "scope": "native-minimum-two-generation",
  "approvedBy": "user",
  "authorizationText": "ACTUAL USER AUTHORIZATION, not this placeholder",
  "planDigest": "EXACT prepare-plan.json planDigest",
  "manifestDigest": "EXACT prepared.json manifestDigest",
  "currency": "CNY",
  "maxCostCny": 3,
  "maxModelRequests": 14
}
```

With the existing `DEEPSEEK_API_KEY` in the launching environment:

```sh
python3 scripts/research/run_dsh_model.py --mode execute \
  --output /absolute/live-output \
  --authorization /absolute/batch-authorization.json
```

Credentials are not copied into files or logs. Input/provider hashes, relevant
cached runtime code and the absence of extra launch `.env`/home patch files are
checked before execution. An exclusive execution claim prevents blind replay
after a crash. A terminal result is read without rewriting its original evidence.
Prepared directories are trusted local artifacts, not a sandbox for hostile code.
The manifest digest also binds runtime location, profile, scope and limits.
Older unsealed preparations cannot launch new work; prepare a fresh directory.

## Inputs, evaluation and evidence

`scripts/research/prepare_native_docs_mini.py` freezes a small **supplied-context** slice:
four fast and four slow questions from the existing docs-QA DEV set, plus four
fresh final questions. Every task includes excerpts from the pinned local DSH
mirror. It reuses the existing content/citation judging rules, with no paid LLM
judge. The generator receives the parent, conservative feedback and at most two
fast examples. Slow/final inputs and answer keys are not in its prompt. Candidate
agents receive only the public task inputs for their current tier, and have an
empty inherited-tool allow-list. Final evaluation occurs after generation ends.

The entry loads `/json-output` through the existing DSH DeepSeek request-extension
registry to send `response_format: {type: "json_object"}`. This is an additive
provider field, not a replacement adapter. See the [official JSON Output guide](https://api-docs.deepseek.com/zh-cn/guides/json_mode/).
`request-formats/*.json` records HTTP acceptance of that field for owned DUO
sessions. Acceptance does not prove that the final output is valid or complete;
strict output evaluation still applies. Other sessions are unaffected.

Only one model call is admitted per generator/executor operation. Model route,
token cap and assembled input bytes must match the frozen request envelope.
Cancellation calls the published Agent's native cancellation API and drains its
owned lifecycle. Its durable Session events and final assembled answer are retained.

The four-task final set and substring/citation rubric have saturation, lexical
and correlation limits. A favorable result is a recommendation on this slice;
it does not prove general improvement. No improvement is a valid result. This
entry does not establish independent Calling Agent usability or an original /
single-loop / dual-loop comparison; those are separate subsequent acceptances.

### What the version 1 score measures

`quality` is the fraction of rows passing the frozen substring / refusal-regex /
citation-path rules. On a four-task split it can only be 0, .25, .5, .75 or 1.
The separate `grounded` constraint checks that citation paths belong to the
allowed set; it does not check that cited text entails the answer. `final=1`
therefore means four rule passes, not independently established factual accuracy.
Always check which candidate was actually evaluated. A candidate that ties Fast
and is not promoted has no candidate Slow/final result to report as a success.

The 2026-09-09 calibration (`runs/native-evaluator-diagnostic-20260909/REPORT.zh.md`, private workspace archive; not distributed)
replayed 24 historical judgments and traced all eight candidate overlays into
actual request headers. Twelve frozen controls exposed two false passes for
contradictory answers containing the required words, plus refusal wording limits.
A separate blind model diagnostic matched 10/12 control labels and failed its
predeclared 12/12 calibration gate. Neither result qualifies semantic evaluation
for a new optimization experiment. Historical evaluator version 1, datasets and
scores are unchanged; the diagnostic model rubric has its own identifier and is
not installed as an optimization evaluator.

Replay the local diagnosis with an already installed DSH package and a **new**
output file (no model request):

```sh
DUO_DSH_PACKAGE=/absolute/path/to/node_modules/@deepseek-ai/dsh \
node --experimental-loader ./scripts/product/dsh_native_loader.mjs \
  scripts/research/diagnose_native_evaluator.mjs \
  runs/native-completion-20260909/comparison-live-prepared \
  runs/native-evaluator-diagnostic-20260909/controls.frozen.json \
  /new/absolute/diagnostic.json
```

Before changing a rubric, define the truth boundary of its supplied evidence,
freeze positive and negative controls, and give any changed evaluation a new
version. Controls test evaluation behavior; they cannot count as optimization
gains. Do not combine rescored historical answers with the original results.

### Optional semantic evaluator and delta explanations

`/semantic-evaluators` is an optional version 2 provider through the existing
`EvaluatorsService` contract. See [provider configuration](../../dsh-plugin/PROVIDERS.md)
and the [v2 evidence policy](../../examples/native/semantic-policy-v2.json). It records
support, completeness, contradictions and reasons per task, with separate
deterministic citation/shape checks. The supplied policy scopes command-existence
claims to the shipped surface of the supplied snapshot; an exhaustive inventory
and a partial excerpt must not be treated as the same evidence.

Its actual 20-control calibration (`runs/native-evaluator-v2-20260909/REPORT.zh.md`, private workspace archive; not distributed)
returned 19/20 correct classifications: it wrongly accepted an absence claim from
a partial excerpt. The plugin is implemented and its native host/usage handling
are tested; semantic qualification failed. Do not use that technical completion
as authorization to start a new optimization or as evidence of improvement.

A delta records a proposed intervention. Audit its parent/hypothesis, applied
system prompt, candidate answers, per-task measurements, gate decision, and the
actual next-generation input before explaining a result. The current generator
receives only two Fast examples and aggregate feedback. In the historical eight
candidate trial the failed ab-01 question was absent from every generation prompt;
per-task reasons are not automatically returned to the generator by the new
evaluator. The delta trace (`runs/native-evaluator-v2-20260909/delta-explanation.json`, private workspace archive; not distributed)
distinguishes these observed information gaps from unproved causal hypotheses.

Output artifacts:

| Artifact | Meaning |
|---|---|
| `result.json`, `run-receipt.json` | Execution status, generations, conclusion, evidence category and request count |
| `candidates.json` | Complete parent-bound candidate overlays (two in minimum mode, six by default) |
| `journal/<runId>/duo.sqlite`, `journal.json` | Native durable Journal and exported transitions |
| `sessions/*.json` | Real DSH Session events, model result, observed usage and price calculation |
| `request-formats/*.json` | Native JSON-output field and HTTP acceptance, with session identity |
| `judgments/*.json` | Per-task content/citation judgments and evidence identities |
| `budget.json`, `cost-receipts.json` | Reservations, known/unknown costs, phase totals and bound usage receipts |
| `inputs/`, `pricing.json`, `prepared.json` | Frozen baseline/data provenance, tariff and plan/input bindings |

The [official price table](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)
currently distinguishes weekday UTC peak windows 01–04 and 06–10 from off-peak.
Price disjoint uncached input, cached input and output separately; reasoning is
already included in output. A request crossing a tariff boundary has unknown cost
until independently resolved. The calculation is usage at published tariffs,
not a separately retrieved provider invoice. Unknown usage is never zero.

New runs use `currency: "CNY"`, `maxCostCny`, `reservationCny` and `costCny`.
Peak rates are CNY 2 uncached input, CNY 0.04 cached input and CNY 8 output
per million tokens. No exchange-rate conversion is involved. Historical native
contracts that omit currency retain their original USD fields and amounts;
mixed currencies are rejected, and retained USD ledgers are never rewritten.

The bundled tariff was verified on 2026-09-10 (UTC). On a later UTC date, check the
official page and supply a fresh `--pricing /absolute/pricing.json` when preparing.
Use the same JSON shape as `pricing.json`; its three numerical rates are peak
CNY per million tokens, and `schedule: "deepseek-weekday-utc-v1"` applies the
documented half-price off-peak schedule. If the schedule changes, update its
implementation and tests before using it. Preparation and execution refuse stale
tariffs. Never reuse old pricing as a verified current bill.

## Failures and provider replacement

Inspect `error.code`, `component`, `retryable` and `nextAction`, the session
receipt, and `dualloop_budget_status`. Known-cost failures settle first and retain
their original code. `DUO_COST_UNKNOWN` stops all further work; reconcile only
an independently supported staged receipt. A crash without a terminal result
keeps its execution claim. Do not delete a claim/ledger to replay a paid request.

The native profile rows can replace `/docs-evaluators`, `/model-generator`,
`/gate` or `/comparator` using their public definitions without changing the
controller. Update descriptors and inspect the new plan digest. Definitions and
required shapes are in [dsh-plugin/PROVIDERS.md](../../dsh-plugin/PROVIDERS.md).

### Optional structured generator (design-completion path)

The original minimum entry remains on `/model-generator`. The new
`/structured-generator` is an optional provider, version 6, using the same model
configuration and CNY accounting. Compose it with `/history-feedback`; retain the
existing `/model-executor` and your frozen evaluators. To replace a provider row,
disable the original entry and insert the new provider with its full configuration;
a new `name` on an existing-ID patch does not rename it in the verified DSH loader.

Structured generation assigns append, replacement and two-component composition
operators from the controller quotas. It validates the model's hypothesis-before-
change order, binds mode/family in code, and includes all Fast examples and ranked
history. It makes one bounded model call and never automatically retries or
truncates history. Oversized input and missing-history refusals remain explicit.

The existing semantic Evaluator version 2 is unchanged and still unqualified by
its previous calibration. New product mechanisms do not clear that result or
provide authorization to resume a paid experiment. The design-completion checks
use actual DSH lifecycle with fixture adapters/functions; real efficacy and new
independent Calling Agent acceptance remain separately unexecuted.
