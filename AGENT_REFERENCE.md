> Package-only readers: paths marked "source checkout" refer to files in the GitHub source distribution, outside this npm tarball. Historical run files require the separate research archive. The public tool and provider contracts below remain available without those files.

<!-- Canonical copy. dsh-plugin/AGENT_REFERENCE.md is the shipped duplicate; dsh-plugin/native/docs-sync.test.js enforces sync. -->
# DUO public reference

DUO optimizes an existing persona/system prompt under an explicit experiment
contract. It produces candidates and evidence, not automatic deployment. The
Calling Agent owns intent clarification and prepares the target, evaluation and
resources within the human owner's authorization.

Start with [the short Agent guide](AGENT_GUIDE.md). Read only the section needed for your current operation.

## Before configuration

Make the local package available to a setup profile through the host's authorized
package workflow. Use dsh-base and
onboarding-profile.patch.yml (source checkout: `examples/native/onboarding-profile.patch.yml`).
Do not activate the complete DUO execution bundle with its work-provider rows
removed until your own providers exist: DSH rejects unresolved required services
at startup. The default bundle already wires the bundled zero-cost offline
fixture providers (`native/offline-fixture.js`, row id `duo-offline-fixture`,
CNY accounting) as generator/executor/evaluator, so a fresh install boots and
completes a first run with no model or network; the package ships a matching
minimal contract and persona (source checkout: `dsh-plugin/examples/experiment.json`). For real
work, disable the `duo-offline-fixture` row (the shipped `cordis.patch.yml`
comments mark it) and insert your own providers under new row IDs. Fixture
outputs are synthetic controls, never evidence of improvement.

An existing profile may instead use `@dual-loop/dsh-plugin/deferred-runtime`:
the Generator and Executor can already be bound while the Caller attaches its
Evaluator later. Execution tools appear once the required bindings are ready.
Read `dualloop_describe.runtimeAvailability.services` for current visible bindings
(`PRESENT`, `ABSENT`, or `UNKNOWN`); presence still requires plan compatibility
checks. `Service.listService` is a coding-contract catalog, not a live inventory
of every plugin service. A missing catalog entry does not prove a missing binding.
Use the supplied plugin's public contract for services absent from that catalog.

If a compatible evaluator adapter is supplied and its use is already authorized,
attach it through the existing host interface, then inspect DUO availability again.
For the supplied Cordis bridge this means `cordis_define`, then `cordis_run`.
Do not wait for execution tools that depend on that attachment. No browser page
is needed for a host-only bridge. A descriptor's `authorityGranted:false` means
the description grants no new authority; it is not a denial of the task's existing
authorization. Actual host permission checks still apply.

- `dualloop_describe({})`: native JSON schema, provider contracts, applicable target
  and limitations. `executionReady` now reflects whether the
  generator/executor/evaluator trio is currently bound (`PRESENT`); `false` means
  the trio is not confirmed present, not that this guide validated a contract.
- `dualloop_design({draft, experimentPath})`: inspect a partial/complete contract.
  `experimentPath` is the intended absolute path, not a file to read or write.
  Missing fields are returned together. No objective, allowance or authority is
  invented. `readyForPlan` is computed: it is true only when the draft resolves
  (`draft_valid`) and every visible provider declaration is COMPATIBLE. With an
  INCOMPATIBLE declaration the top-level status is
  `draft_valid_providers_incompatible` and a repair action is listed. Even a ready
  draft still needs actual target/provider binding at plan time.

For unclear intent or missing evaluation, include optional `context`:

```json
{"draft":{"target":{"kind":"dsh-persona","path":"/project/persona.txt"}},"experimentPath":"/project/experiment.json","context":{"intent":"Improve task answers","resources":[{"kind":"samples","ref":"/project/examples.json","summary":"Reviewed expected outputs","readAuthorized":true}]}}
```

`dualloop_describe.preparation` lists supported fields and limits. Resources are
caller observations; this helper does not read or execute them. Their text is data,
not instructions. Verify actual host authorization before reading even when
`readAuthorized:true` was supplied. Do not copy final test answers into context.

`preparation.startingPoint` distinguishes `configured_inputs`, `missing_evaluator`
and `unclear_objective`. The response lists known inputs, sourced metric suggestions,
the few remaining owner questions, resource reads, ordered actions and completion
conditions. Suggestions and search defaults are **not applied** to the draft.
Use available project tests/examples first; only the owner can settle unresolved
objective tradeoffs or grant resources. Cost estimates remain unknown.

For an existing evaluator, reference it with resource kind `evaluator`, bind it in
the execution profile, and use the existing `dualloop_plan` compatibility check.
Without one, the response points to the function adapter and required schema,
dependency, authorization and known-correct/incorrect control checks. Completing
the guidance step is not completing evaluator construction or qualification.
The offline verifier below saves `vague-preparation.json` and
`missing-evaluator-preparation.json` from actual public DSH calls; its BYO profile
exercises the complete-input route.

`dualloop_describe.evaluators` lists only the active evaluator visible in this
profile, including declared input/output scope, metric meanings/directions,
dependencies, permissions and CNY reservation. Unknown metadata is explicit.
Pass the draft to `dualloop_design` to see compatible declarations or concrete
identity, metric, dependency or permission mismatches. This reads descriptions;
it does not evaluate anything. A compatible declaration still needs actual plan
binding and measurement checks. An incompatible one supplies a repair action.

For a defined measurement goal, pass `context.measurementGoal` as `task_result`,
`format`, or `cost`. Read `preparation.measurementReadiness` and
`preparation.recommendedOperation`: evaluate, optimize, prepare inputs, or prepare
measurement. Evaluator `metricDefinitions` can declare `purpose`, `construct`, and
numeric bounds. `DECLARED_MATCH` is not calibration; check fixed correct/incorrect
controls and baseline development errors. A format metric does not establish task
quality. Evaluation-only remains available for inspecting such a metric without
starting search. Reports identify measured values at explicitly declared bounds
without inventing a general quality ceiling or treating every tie as a defect.
See the fact/support example (source checkout: `examples/native/fact-task.md`) for a deterministic
task-result evaluator, separate validity checks, and labelled control evidence.

For a missing evaluator, use this minimal Build/Compose route:

1. Read authorized existing tests and expected outputs; select an existing
   measurement whose semantics match the owner's objective. Preserve separate
   quality, regression and cost facts unless explicit comparison weights are justified.
2. Copy the caller-owned control adapter (source checkout: `examples/native/evaluator-controls.js`)
   and profile patch (source checkout: `examples/native/evaluator-controls-profile.patch.yml`) into
   an authorized isolated profile. Replace `measure` with the existing function,
   declare dependencies, data/code identities, permissions and maximum all-inclusive
   CNY fees. No DUO core changes are required. Do not install missing dependencies
   without applicable authority.
3. Freeze known correct/incorrect `purpose:"control"` outputs and expected facts
   before checking them. The public `createControlEvaluation` wrapper bounds
   callbacks, preserves individual results/costs and never retries. Use its total
   reservation in the descriptor, then inspect/run the evaluation-only control
   contract (source checkout: `examples/native/evaluator-controls-experiment.json`) through the usual
   plan/run/report tools. Check `control_match_rate`, `controls_distinguish` and
   `measurementChecks`, not only the run's completion status.
4. Keep a failed control result as a preparation failure. Fix an evidenced defect
   and version the evaluator; do not relabel answers to make it pass. Passing
   controls establish only their stated functional scope. After authorized review,
   bind the actual measurement (without the control wrapper) to the desired task
   data and Executor. Use fresh baseline evaluation and separate search/final data.

The included adapter executes the installed Schemastery validator and an allowed
reference check. Its four outputs are controls; the surrounding Executor is a
fixture. They do not measure improvement of the persona or answer correctness.
The offline verifier below runs this path plus constant-score and missing-dependency
negative controls. No model or new dependency installation is needed. A callback
that makes model requests needs separately authorized, explicitly bounded nested
requests; the control wrapper does not create that authorization or bound hidden calls.

Native experiment `version:1` differs from tool `apiVersion:2`. For a new draft,
set `budget.currency:"CNY"` and explicit `maxCostCny`, operation/evaluation/time
limits. Use CNY descriptors/results on every provider, including free evaluators.
Runtime compatibility for old USD contracts does not make an omitted unit valid
for new authoring through the draft helper.

A contract may add the optional cross-run cap `maxCumulativeCostCny` (legacy USD
contracts: `maxCumulativeCostUsd`, always in the budget's own currency). At plan
time, retained settled cost across every native run under the same journal root
plus this run's full allowance exceeding that cap refuses admission with
`DUO_CUMULATIVE_BUDGET_EXCEEDED`, carrying a structured `cumulative` breakdown.
The per-run cap alone is renewed by any contract edit; the cumulative cap is not.
`dualloop_budget_status` exposes a read-only `cumulative` field (historical known
cost, cap, `excludedCurrencies`): runs kept in another currency are never
converted or summed but remain visible. Accounting stays single-currency.

A useful contract states what is measured, maximize/minimize directions, hard
constraints, named/versioned evaluators, separate search/validation/final data,
stop limits and allowed work. Without comparable objectives choose the explicit
Explore mode, without a Slow objective use fast-only; do not call either a fully
validated optimization. Final data must never feed candidate generation.

## Start a new experiment with native history

Use this when authorized prior runs concern the same persona. It is optional;
missing or empty history gives a cold start. In a **new, authorized contract copy**,
keep the current Target and set a new experiment ID, current objectives and limits.
Add, for example:

```json
"warmStart": {
  "runIds": ["the-prior-native-run-id"],
  "maxRecords": 6,
  "maxContextBytes": 8192,
  "fixturePolicy": "exclude"
}
```

Run `dualloop_design` on the draft, bind that contract in your authorized isolated
profile, then inspect `dualloop_plan`. `warmStart.sources` explains missing,
incompatible, oversized or excluded sources; `context.records` identifies the
source candidate, parent/version, hypothesis and overlay. `comparable_declared`
means matching declared conditions, not independently qualified evidence. Changed
baseline/objectives/providers, unknown configuration or environment give
`ideas_only`, with historical scores omitted. Different Target paths are excluded.
This implementation compares full provider declarations conservatively: an output
directory or pricing change can therefore downgrade history to ideas too.

Only explicitly named native Journals in the configured root are read; no external
notes, copied ledgers or archived Python import. Defaults exclude fixture/control
history. For a **functional test only**, opt into `fixturePolicy:"ideas_only"`;
this never makes fixture scores eligible for real ranking. At most eight unique
sources and 16 records are supported; byte limits are UTF-8 JSON bytes. A source
over 2048 events or 4 MiB is excluded before JSON loading. Whole records are skipped
with reasons. The default order cycles through baseline, good outcome, failure
and other direction. The optional `/history-feedback` configuration
`historyOrder:"recent_failures_first"` selects recent screened failures first;
`"balanced"` keeps the default order. Inspect `warmStart.selector` in the plan.
Changing this policy requires a fresh plan. See the bounded replacement
contract (source checkout: `examples/native/warm-start.md#replace-history-ordering`) for custom ordering.

Pass the inspected digest to `dualloop_run`. The current baseline is freshly
measured; historical scores, costs and allowances do not become current ones.
The default and structured generators receive `feedback.warmStart`, with
`warmStartDigest` in generation operations and model receipts. Inspect both the
completed receipt and retained request to verify consumption. Changing relevant
history invalidates the plan. Existing token/byte/cost caps can still refuse a
larger request; warm start does not increase them.

Final samples, answers, raw evaluation feedback and final-based selection are
excluded from history. Because unseen-data provenance is not independently audited,
a warm run reports `finalDataReview.independence:"NOT_ESTABLISHED"`, even if a data
ID is renamed. Its measured final comparison remains available as
`independentFinal.observedConclusion`; a positive observation alone returns
`insufficient_evidence`, not a newly qualified independent recommendation.
`dualloop_report` exposes the history reuse and this limit. Caller-provided text
and metadata remain declarations; DUO cannot detect secretly relabelled final data.

Warm start creates new work, **not new permission or money**. Resume keeps the old
run/ledger rules; read/report/replay performs no model work. Evaluation-only does
not accept warm-start search input. The executable offline example (source checkout: `examples/native/warm-start.md`)
uses public tools and an isolated contract copy, with zero-cost fixture providers;
independent real Caller use is a separate acceptance requirement.

## Configure the execution profile

Use the native DUO bundle plus three work services: `duoGenerator`, `duoExecutor`,
`duoEvaluators`. See provider reference (source checkout: `dsh-plugin/PROVIDERS.md`) and the runnable
BYO composition (source checkout: `examples/native/byo-profile.patch.yml`).

An existing evaluator function can use `/function-evaluators`; return `ok`,
`metrics`, `currency:"CNY"`, `costCny` and evidence refs. Supply versioned descriptor,
code/data identities and explain each tier's evidence family and limits. Metadata
is not evidence that the evaluator is correct or Slow is higher-fidelity.

The optional `/structured-generator` uses `/history-feedback`. It assigns append,
replace and compose slots before the model proposes changes, receives all Fast
examples and full ranked history, and uses one bounded model call. It refuses a
missing history contract or oversized input instead of silently truncating history.
The original `/model-generator` remains available for existing profiles.

Both current feedback providers send permitted Slow facts, comparator decisions
and the frozen constraints into the next generation. Inspect `slowFeedback` and
the Journal's generation-specific `feedbackDigest`; model receipts carry the same
source digest (structured generation also records its projected input digest).
`NOT_EVALUATED` means there is no Slow experience for that candidate. Constraint
failures remain visible without becoming causal claims or final-test feedback.
No raw Slow answers or final test results are included. These extra facts still
must fit the existing input and budget envelope; a stopped input is not proof that
the generator consumed it or that optimization improved.

Inspect the plan's `searchPolicy` for exact duplicate handling. Same persona content
under a new ID is recorded as `duplicate_skipped` and gets no new execution or
measurement; `duplicateOf` identifies its source. An all-duplicate batch stops
with `no_new_candidates`. The already-used generation cost remains in the ledger.
This prevents exact repeats and does not certify that other candidates are novel.

For a deliberate variance measurement, the frozen contract must explicitly enable
`allowNoiseRepeats:true`, and your Generator must supply an existing-content candidate
with `repeat:{purpose:"noise_measurement",reason:"predeclared reason"}`. It still
consumes the current operation/evaluation/time/CNY limits. The shipped model
generators do not invent this declaration. See the zero-cost repeat profile (source checkout: `examples/native/noise-repeat-profile.patch.yml`).
Keep each repeat's observation; do not treat a repeated sample as independent
evidence or a proven improvement without an appropriate evaluation design.

When replacing a configured provider, **disable its old row and insert the new
provider under a new row ID**. A different `name` on a patch targeting an existing
row is a match guard, not a rename, in the verified DSH snapshot. Config replaces
the entire row config; restate every required config field. Do not install unapproved
dependencies or alter the host's permission policy to make a composition load.

## Inspect, execute, read

To measure without optimizing, author `operation:"evaluate"`, `generations:0`
and zero exploit/explore/innovate quotas, with at least one measurement objective.
The existing plan/run/status/report tools execute only the baseline measurements;
no generator is invoked. Use `/evaluation-controller` in place of `/controller`
for a profile without a generator; it shares the same execution and accounting
implementation. See evaluation-profile.patch.yml (source checkout: `examples/native/evaluation-profile.patch.yml`)
and evaluation-experiment.json (source checkout: `examples/native/evaluation-experiment.json`).
`evaluations` contains measurements, `measurementChecks` contains their constraint
and admissibility results. `evaluation_complete` is completion of measurement,
not passing quality constraints. A retained original is not an improvement claim.
All existing input, permission, cost-unknown and replay checks still apply.

1. `dualloop_discover({})` reports currently configured providers and available tools.
2. `dualloop_plan({})` returns the actual baseline, editable scope, objectives,
   provider versions, permissions, limits, artifact location and `planDigest`.
   It checks actual bindings but creates no run.
3. Inspect the plan within existing authorization, then call
   `dualloop_run({planDigest})` once. Changed contract, target, provider identity or
   storage root invalidates an old digest.
4. `dualloop_report({runId})` returns the product report: candidate/parent/hypothesis/
   delta, Fast/Slow/final states, decisions, lineage, fidelity declarations and current
   cumulative cost. `includeEvents:true` adds a derived JSONL export.
5. Use `dualloop_status({runId})` for raw retained events/result and latest budget,
   or `dualloop_budget_status({runId})` for accounting alone. Its `receipts` view
   lists every staged receipt with `hash`, `receiptId`, `operationId`, `phase`,
   `tier`, `status` (`settled`, `unknown`, `reserved`, `staged`, `orphan`),
   `applied` and the cost/reserved amounts.

A completed run may recommend a candidate, retain baseline or have insufficient
evidence. `NOT_PROMOTED` and `NOT_SELECTED_FOR_FINAL` are not bad scores and must
not inherit the baseline's final score. A candidate accepted by a comparator is
not automatically proved useful; report actual evidence and its limits.

The report does not execute, replay, deploy or feed final results into generation.
Total cost includes generation, execution and evaluation. Null cost remains unknown,
not zero. A report may display a baseline known from the plan even if cancellation
prevented its first measurement; all unexecuted stages remain explicit.

## Failure and recovery

For an Agent that uses DUO as one step in a larger task, the optional caller-owned
`duo_task` example (source checkout: `examples/native/embedded-task.md`) accepts an already inspected
plan digest and returns the native run plus report. It uses the same plan/run/report
interfaces, child permissions, cancellation and ledger. A report delivery failure
preserves the run ID and does not retry work. Allow the required child tools in the
Agent's authorized scope; allowing the outer tool alone is not a permission grant.
The example's scripted Agent acceptance is engineering evidence, not a live
independent Caller result.

Errors through ToolRuntime render `{apiVersion:2,error:{code,message,component,
retryable,recoveryCondition,nextAction}}`; execution failures also live in the
stored run result. DSH owns canonical error and approval behavior. A failed
receipt or judgment write surfaces `DUO_RECEIPT_WRITE_FAILED`: the settled amount
in the same result remains authoritative and the evidence chain fails closed
rather than losing the record silently.

`dualloop_report` adds `diagnostics`: recorded facts and candidate references,
untested questions with the evidence needed to answer them, known/unknown cost
exposure, declared side-effect limits and safe next actions. A numeric Fast tie
within epsilon does not identify its cause, prove an evaluator is broken or prove
that `final=1` is a ceiling. A retained baseline does not mean its hard constraints
passed; inspect `CONSTRAINT_VIOLATION` and measurement/comparison facts.

For measured search, you may freeze optional stopping limits in the contract:

```json
"stopping": {
  "maxConsecutiveEvaluationFailures": 2,
  "maxNoProgressGenerations": 1
}
```

These values are examples, not automatically chosen experimental standards.
Omitting a limit preserves the earlier behavior. The failure counter counts
returned `ok:false` evaluations without a provider error; a successful evaluation
resets it. A provider exception/refusal or unknown cost already stops immediately.
The threshold-reaching failed observation is retained. No-progress counts completed
measured generations with no change in the selected champion version; progress
resets it. Reaching its limit stops generation, then attempts the already planned
final within the same budget. It does not change comparison thresholds, add retries
or increase allowance. No-progress configuration is invalid for evaluation-only
or unmeasured exploration. See the offline stopping contract (source checkout: `examples/native/stopping-experiment.json`).

Repeated terminal plans return existing artifacts and current accounting. An
interrupted active/nonterminal run refuses blind replay. Only an already-staged,
bound receipt may be reconciled with
`dualloop_budget_reconcile({runId,receiptHash})`; this never repeats external work.
It returns `{runId,outcome,receiptHash,operationId,status,overrun,reason,budget}`
with `outcome` one of `applied`, `already-settled`, `unknown-receipt` or
`rejected` (carrying the `DUO_*` code and reason); an unknown hash returns
`unknown-receipt` instead of failing the call. Cancellation uses the existing
DSH abort signal. Unknown costs block further work. `dualloop_status` and
`dualloop_budget_status` attach an `interrupted` field to a run whose owner
process is gone without a terminal result: `ownerActive:false`, `resumable`,
`checkpointDigest`, `nextStep` (`resume_from_checkpoint` or `start_a_new_run`)
and a short `guidance`.
Automatic resume of an interrupted optimization is not implemented: inspect the
original owner/state and settle supported receipts. Explicit continuation of the
clean boundaries described below is supported. Reading a failed or cancelled
terminal result does not restart it. A different experiment ID or warm-start
contract still requires current authorization; it is not a budget reset mechanism.

To stop at a settled boundary, inspect `plan.recovery`, then use
`dualloop_run({planDigest,pauseAfter:"baseline"})` or `pauseAfter:"generation"`.
The result is `paused`, with no final evaluation performed after the pause. This
is not a completed experiment or an adoption recommendation. Read
`dualloop_status({runId})` and its `checkpoint`: boundary, next generation, exact
digest, original deadline and current resumability. Reinspect `dualloop_plan`,
then continue with `dualloop_run({planDigest,resumeFrom:checkpoint.digest})`.
You can combine `resumeFrom` with another `pauseAfter`.

The baseline checkpoint follows every configured search tier; generation
checkpoints follow a completed generation, including an empty/exhausted search.
Continuation uses the same execution loop, IDs, champion, permitted feedback,
receipts and allowance. It can also reclaim a dead owner only when the latest
event is exactly this clean checkpoint and no work or receipt changed afterward.
An in-flight interruption, changed target/contract/provider/native build, altered
receipt, unknown cost, active owner or expired original wall deadline refuses.
Pause time counts toward that deadline. Final and partial provider boundaries
are not resumable, and terminal failures remain immutable. Custom storage without
the declared checkpoint capability keeps full-run behavior and cannot accept pause.
The native SQLite schema stays v1; no old ledger is migrated or given new money.

`dualloop_report.delivery` distinguishes execution state, a rendered report and
Caller delivery. The report alone leaves Caller delivery `NOT_OBSERVED` and file
persistence unverified. Its native budget covers inner work; Caller preparation
and optional explanation require separately bounded host resources. A report
does not prove that the whole calling chain has an enforced budget.
The standalone model entry saves `product-report.json`, `product-report.txt` and
`delivery-receipt.json` with observed file hashes and report request count, even
when its model request allowance is exhausted. This is deterministic export;
an independent Caller's receipt/interpretation remains a separate fact.

Run the existing offline public-tool control with a cached DSH installation:

```bash
python3 scripts/verify_dsh_native.py --dsh-package /path/to/node_modules/@deepseek-ai/dsh \
  --output /new/isolated/output --scenario resume
```

The control uses synthetic providers and zero model requests. Cross-process
checkpoint tests are also part of the native test suite. Neither demonstrates
optimization benefit or independent live Caller use.

Default action is to deliver candidate overlays and evidence. Adoption or rollback
uses the host's existing authorization and remains separate from search.

### Bounded deeper testing of Fast ties

The default gate selects only Fast improvements. To spend a predeclared part of
the existing Slow allowance on comparable ties, replace it in an isolated profile:

```yaml
- id: duo-gate
  disabled: true
- insert:
  - id: tie-gate
    name: '@dual-loop/dsh-plugin/bounded-tie-gate'
    config:
      maxTies: 1
```

`maxTies` is a maximum at each stage transition in each generation, still bounded by `topK`, the remaining Slow
allowance and ordinary monetary reservation. Improvements take slots first.
Only admissible scores within the frozen epsilon of the incumbent qualify;
invalid, incomparable, constraint-violating or worse scores do not qualify.
Gate selection records its policy, limits and reason in Journal. Changing the
provider/configuration invalidates the inspected plan. Deeper testing is not
adoption: the existing Slow/final comparison still decides the result. This is
an engineering capability; it does not establish the value of Slow feedback.

Each completed search-tier evaluation is now recorded before another provider
call begins. If a later baseline stage fails, status/report retains the earlier
measurement. This does not resume execution or reconstruct missing old records.

For an explicit ordered credibility ladder of one to five search stages with
caller-declared tier names, see the
ordered-stage contract and runnable example (source checkout: `examples/native/ordered-stages.md`).
Legacy Fast/Slow contracts use the same execution loop. Final is always separate.
Under such a custom `searchStages` contract the observer derives report
health/fidelity/diagnostic key names from the declared tiers (for example
`<terminal>Decision`, `<first>Family`/`<terminal>Family`,
`<first><Terminal>Correlation`, `<FIRST>_NOT_BETTER`); legacy fast/slow contracts
keep the historical fixed key names (`slowDecision`, `fastFamily`, `slowFamily`,
`fastSlowCorrelation`).

## Runnable example and limits

From dualloop, with an already-installed DSH package and a new output directory:

```sh
python3 scripts/verify_dsh_native.py --dsh-package /absolute/path/to/node_modules/@deepseek-ai/dsh --output /tmp/new-duo-product-check
```

This is actual DSH host integration with zero-cost functional fixtures, including
BYO evaluation and strategy replacement. It does not establish independent real
Calling Agent success, semantic qualification, quality improvement or cost savings.
Real model entries are in NATIVE_MODEL_GUIDE.md (source checkout: `NATIVE_MODEL_GUIDE.md`); latest
implementation/verification boundaries are in STATUS.md (source checkout: `STATUS.md`).

Legacy Python/YAML callers use the explicit `/legacy` bridge. Their field names,
contract versions and ledgers are separate; this guide describes the native product.

### Delivering, adopting and restoring a candidate

Optimization returns artifacts without adopting them. Use the public status and
report with the concrete host adoption/rollback recipe (source checkout: `examples/native/adoption.md`).
It preserves original/candidate hashes and complete lineage, verifies the current
isolated copy, and uses existing DSH read/write with same-session observation guards.
The read-only example helpers (source checkout: `examples/native/adoption.js`) never authorize or write.
Actual user profile loading is separate and requires explicit authority; file
adoption alone does not prove that a running Agent uses the candidate.

### Attaching an evaluator after DSH starts

If a Caller will attach its Evaluator at runtime, use the optional
deferred native composition (source checkout: `examples/native/deferred-profile.patch.yml`):
preparation stays available while existing runtime consumers wait for providers.
DSH rejects unresolved required top-level rows at boot, so do not leave those
rows active alongside the deferred composition. No controller algorithm changes.
The combined Caller example (source checkout: `examples/native/maturation-calling.md`) shows public
Cordis attachment, two native experiments and subsequent warm-start consumption,
with one total CNY/request ledger and explicit offline/live evidence boundaries.

## Compact report rendering

`dualloop_report({runId,view:"summary"})` renders the deterministic text, current budget and limits for the Caller. Full structured facts remain in the tool result; use `view:"full"` for detailed candidate/provider/diagnostic content. `includeEvents` independently controls JSONL export. No result, score or Journal is altered by rendering.

The clean complete-input Caller smoke (source checkout: `examples/native/calling-facts.md`) uses the supplied fact evaluator and separate Caller/inner caps. It does not replace the historical two-run warm-start acceptance.

## Compact plan rendering

`dualloop_plan({view:"summary"})` keeps the complete normalized spec, original
target/baseline, exact plan identities, policy declarations, recovery limits and
history selection metadata. It renders provider identities, data hashes, routes,
permissions and reservations without repeating full descriptions or historical
candidate bodies. Read `view:"full"` when those omitted details are needed for a
choice. Full structured ToolResult.value remains the authoritative plan in either
view. Rendering never changes its digest, budget or execution.
