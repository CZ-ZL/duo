> Package-only readers: paths marked "source checkout" refer to files in the GitHub source distribution, outside this npm tarball. Historical run files require the separate research archive. The public tool and provider contracts below remain available without those files.

# Native provider contract

Import the runtime definition classes from `@dual-loop/dsh-plugin/definitions`.
They extend the actual Cordis `Service`, own named services and are loaded by
`ctx.plugin(Provider, config)`. Consumers declare `static inject`; dispose effects
through `ctx.effect`. The default bundle waits for work providers. Start with the
[public local examples](examples/product/README.md). The retained
[offline fixture](native/offline-fixture.js) is disabled by default and explicitly
synthetic; it remains available for compatibility.
These are JavaScript runtime contracts with controller validation. TypeScript
declarations now accompany `/definitions` and `/function-evaluators`; declaration
syntax was checked, but semantic tsc validation was not run because no compiler
was available. Arbitrary third-party provider qualification is not implied.

## Work providers

`describe()` is synchronous and read-only. It returns JSON data containing
`id`, `version` (nonempty strings), `currency: "CNY"` and `reservationCny`
(finite yuan upper bound per call),
`permissions: {paid, network, externalSideEffects}` (booleans), plus relevant
configuration/data fingerprints. Fixture providers set `evidenceKind: "fixture"`.
The controller freezes these descriptors into its plan. Never mutate behavior
under an unchanged descriptor. Declarations are trusted metadata, not a sandbox.

Plan binding also checks concrete method definitions without invoking work.
Inherited concrete methods are supported; inherited abstract defaults, missing
methods, accessors and non-functions return `DUO_PROVIDER_INTERFACE` before a
Journal or reservation is created. IDs and versions must contain non-whitespace
text. This checks the interface shape, not whether the implementation computes a
correct result, respects hidden request limits or actually uses warm history.

| Definition | Method and return |
|---|---|
| `GeneratorService` | `propose({champion, feedback, quotas, generation, nextId, signal})` → Promise of `{candidates, costCny}` |
| `ExecutorService` | `execute({candidate, applied, tier, signal})` → Promise of `{artifact, costCny}` |
| `EvaluatorsService` | `evaluate({candidate, artifact, tier, signal})` → Promise of an evaluation result including `costCny` |

CNY results also include `currency: "CNY"`. The budget uses `currency: "CNY"`
and `maxCostCny`; status exposes `costCny`, `knownCostCny`, `reservedCostCny`
and phase totals in yuan. Legacy v1 contracts/providers without a currency
retain USD semantics (`maxCostUsd`, `reservationUsd`, `costUsd`). All providers,
including free evaluators, must match their contract currency. Mixed fields or
currencies are rejected. Receipt currency is bound into its hash; an unexpected
returned currency leaves the reservation unresolved. Old USD records are not converted.

`EvaluatorsService.describe()` returns an array instead of one descriptor.
Each descriptor additionally has `tier` (`fast`, `slow`, `final`), `dataId`, and
`metrics` including every objective/constraint metric and `sample_size`. Exactly
one descriptor must match each configured evaluator ID/version/data/tier.
Final data identity must differ from the data used during search; the provider
is responsible for actually keeping that data separate.

Each call reserves before execution. The returned `costCny` covers that operation
alone, including its complete underlying usage. Use `null` for missing evidence.
Do not charge the same execution again as evaluator cost. A thrown call is treated
as uncertain even if the exception claims a cost. Finite late results can settle
an interrupted operation. Respect the supplied AbortSignal and finish cleanup;
DUO cannot forcibly terminate arbitrary in-process JavaScript.

Providers may additionally return `costEvidence` (retained in the bound budget
receipt) and a structured `error` containing `code`, `message`, `component`,
`retryable`, and `nextAction`. Return a known-cost refusal instead of throwing
when complete usage was received: settlement happens before that refusal stops
the controller. Missing cost still takes precedence and stops as unknown.

The optional `/model-executor` and `/model-generator` use the public DSH Agent
registry with scoped prompts, bounded requests and native cancellation. The
optional `/docs-evaluators` measures actual answers from frozen document tasks.
The optional `/json-output` registers `response_format` on the host DeepSeek
request-extension service for DUO sessions. It retains HTTP acceptance metadata
and does not replace strict evaluation or provide a new model adapter.
See NATIVE_MODEL_GUIDE.md (source checkout: `../NATIVE_MODEL_GUIDE.md`) for configuration, artifact
semantics, frozen pricing and the separate offline/live acceptance boundaries.

The optional `/semantic-evaluators` provider registers the same `duoEvaluators`
service with IDs `native-docs-semantic-{fast,slow,final}`, **version `2`**. It uses
the existing bounded DSH Agent lifecycle for one semantic measurement request
per evaluation. Its configuration includes the existing model settings plus
`policyPath` (a frozen v2 policy JSON) and `judgmentRoot`. Use explicit CNY rates
and reservations; judging is a separate paid operation from candidate execution.

It measures `quality`, `grounded`, `sample_size`, `supported_ratio`,
`complete_ratio`, and `contradiction_rate`. `quality` combines semantic support
and completeness, absence of contradiction, and deterministic answer/citation
checks. The provider never decides promotion. Missing judge usage retains unknown
cost; malformed judge output retains known usage and returns `ok=false`.
Descriptors bind the policy and dataset digests. Changing scoring policy requires
a new contract/version and a separately frozen acceptance record.

Each judgment retains task-level measurements/reasons, the source artifact digest,
source and judge receipt paths, and the policy digest. Reasons are model-produced
claims to audit, not established causal explanations. They are reachable through
the evaluation evidence paths; the existing conservative Feedback provider still
passes aggregate statistics, not these per-task details, to the generator.

The v2 calibration (research archive: `../runs/native-evaluator-v2-20260909/REPORT.zh.md`) matched
19/20 frozen controls, failing its 20/20 gate. The export is implemented and host
tested, but is **not qualified for the next optimization acceptance**. An
`ok=true` measurement means the evaluation executed with a valid result shape;
it does not establish correctness of every model judgment or higher Slow fidelity.

## Candidate and evidence shapes

A generator must return exactly the requested counts for each quota, or an empty
list to stop. IDs must come from `nextId()`. The following Delta shape applies
to the built-in persona adapter. Config/custom adapters own their Delta shape;
see CURRENT_STATUS.md and the Target boundary section below:

```js
{
  id: nextId(), parentId: champion.id, parentVersion: champion.version,
  mode: 'exploit', // or explore / innovate
  family: 'specific-change-family', hypothesis: 'A falsifiable expectation',
  delta: {kind: 'cordis-overlay', target: 'system-prompt', persona: 'complete persona'}
}
```

Preserve any `{{model}}` / `{{cwd}}` placeholders present in the parent.
The persona adapter adds `persona` and its content `version` to the applied candidate.
No original persona file or permanent DSH profile is written.

An evaluator produces measurements, not comparison decisions:

```js
{
  candidateId: candidate.id, evaluatorId: 'my-evaluator', version: '1',
  dataId: 'independent-final-data', tier: 'final', ok: true,
  metrics: {quality: 0.8, safe: true, sample_size: 20},
  currency: 'CNY', costCny: 0, evidence: [{kind: 'benchmark', receipt: 'caller-owned-artifact'}]
}
```

Invalid identities fail the run. Failed/missing/nonfinite measurements and
constraint violations cannot promote a candidate. Incomparable slow evidence
is excluded from slow sample counts, correlations and family penalties.

## Policy and storage providers

`TargetService`, `ComparatorService`, `GateService`, `FeedbackService`,
`JournalService`, and `BudgetService` implement `describe()` returning at least
`{id, version, deterministic: true}`. Include relevant configuration fingerprints.

| Definition | Synchronous API |
|---|---|
| `TargetService` | `snapshot(path)`, `apply(candidate, parent)`, `identity(snapshot)`; warm history additionally needs `validateSnapshot(snapshot)` and `projectDelta(delta)` |
| `ComparatorService` | `compare(results, {weights,epsilon,minSamples,constraints}, incumbentId)` → `{ranking,verdicts,scores}` |
| `GateService` | `select(comparison, candidateIds, {topK,remaining,incumbentId,epsilon})` → selected candidate IDs; older providers may ignore the added context |
| `FeedbackService` | `summarize(latestCandidateRecords, quotas, options)` → family statistics and next quotas |
| `JournalService` | `root`, `open(runId,{create})` → journal or null; read-only by default |
| `BudgetService` | `open(runId,limits)`, `inspect(runId)`, `reconcile(runId,receiptHash)` |

A replacement journal must implement the concrete durable handle contract used
in `native/store.js` and `native/controller.js`: ownership, transactions, metadata,
events, immutable completion, and leases that keep it alive for pending receipts.
The built-in budget currently uses the SQLite handle (`db`) directly; replacing
storage technology therefore requires replacing the budget provider as well.
Storage independence beyond that paired seam is not claimed.
# Native acceptance additions

`/model-accounting` exposes the existing `priceUsage` and `pricingForInterval`
helpers for a separately budgeted Calling Agent trial. It does not launch a model
or grant authorization. `/budget` remains the owner of reservations and receipts.

For `fast_only` contracts with a final objective, the controller reports final
evidence in `independentFinal`. The mode, null champion and unvalidated search
conclusion remain explicit. Final evidence never enters subsequent generation
feedback. A terminal artifact from older code is read as retained evidence and
is not automatically extended with newly supported final work.

## Native setup and Objective Designer

`/onboarding` injects only the existing `tools` service. `dualloop_describe` exposes
the native CNY authoring schema and implemented provider contracts;
`dualloop_design({draft,experimentPath})` lists missing inputs and reuses the same
`resolveNativeContract` function as the file-backed contract service. It does not
write a draft, resolve a baseline file, bind an execution plan or grant authorization.
`draft_valid` may set `readyForPlan:true`: the draft can proceed to planning,
not directly to execution. `bindingChecks:NOT_RUN` and `authorityGranted:false`
remain explicit; incompatible visible evaluator declarations reset readiness.
Use the independent setup profile before enabling the full execution bundle.

Both preparation tools inspect `describe()` on the active `duoEvaluators` visible
in their Cordis context. The `evaluators` field reports descriptor semantics,
dependencies, input/output scope, permissions and CNY reservations. Missing metadata
is listed in `unknownFields`; no unloaded package or plugin marketplace is scanned.
`dualloop_design` uses the same identity, metric coverage/direction, dependency,
currency and permission checks as runtime binding. A declared dependency must be
available; an absent dependency declaration remains explicitly unknown for legacy
providers. `COMPATIBLE_BY_DECLARATION` does not mean executable or qualified.
`provider_incompatible` includes repair actions; discovery does not invoke evaluation.

## Function-backed evaluation

Import `FunctionEvaluators` from `@dual-loop/dsh-plugin/function-evaluators` and
register it from a caller-owned plugin with `{descriptors, implementationDigest,
dataDigest, evaluate}`. `evaluate(args)` is your existing function or a thin
wrapper around it. It receives the native candidate, artifact, tier and AbortSignal.
It returns `{ok,metrics,currency:"CNY",costCny,evidence,costEvidence?}`. The adapter
adds immutable candidate/evaluator/version/data/tier identities. Forged identities,
missing required metrics and nonfinite values cannot be accepted measurements.

Each descriptor declares CNY reservation and permissions, metric names including
`sample_size`, `evidenceFamily` and `fidelityRationale`. Code/data identities are
caller declarations and must include behaviorally relevant closure data; hashing a
function body alone is insufficient. `qualification` is always
`CALLER_DECLARED_NOT_VERIFIED_BY_DUO`, even when the caller claims qualification.
A different evidence family or higher cost alone does not establish Slow fidelity.

A thrown function or missing/mixed-currency fee returns unknown cost; no internal
retry occurs. Invalid metrics with a known fee retain that fee and return `ok:false`.
The adapter does not sandbox a trusted in-process function or control arbitrary
nested requests: the caller must provide bounded work and full cost accounting.
No subprocess/network execution mechanism is introduced by this adapter.

byo-evaluator.js (source checkout: `../examples/native/byo-evaluator.js`) adapts an existing local
function and changes the search provider. byo-experiment.json (source checkout: `../examples/native/byo-experiment.json`)
and byo-profile.patch.yml (source checkout: `../examples/native/byo-profile.patch.yml`) are a complete
zero-cost functional composition. They do not claim real optimization benefit.

`createControlEvaluation({evaluate, controls, discriminationMetric,
reservationCnyPerCase})` from the same public export adapts an existing measurement
to a bounded control check. Supply 2–32 unique `{id,purpose:"control",artifact,
expectedMetrics}` cases (at most 64 KiB total) with different frozen expected
outcomes. It copies inputs before any work and calls the measurement sequentially
without expected labels or retries. It returns `evaluate`, `controlsDigest`,
`maxInvocations` and aggregate `reservationCny`. Bind that function through
`FunctionEvaluators` in an evaluation-only contract with constraints
`control_match_rate == 1` and `controls_distinguish == true`.

The wrapper preserves each measurement, expected result and CNY fee. Unknown
fees, invalid results, per-case overruns or cancellation stop remaining callbacks;
known consumed costs remain charged. `costEvidence.controlProgress` also survives
an unknown-cost adapter response into native settlement. `maxInvocations` bounds
callbacks, not hidden provider-internal model requests: those still require an
explicit callback request cap and all-inclusive fee reservation. Zero-cost local
callbacks require no model allowance. Data purpose is caller-declared; DUO cannot
identify secretly relabelled final answers. Do not use final data as controls.

The runnable control adapter (source checkout: `../examples/native/evaluator-controls.js`) uses the
existing `@deepseek-ai/schemastery` Standard Schema validation function (MIT;
verified installed version 3.18.2) and separately checks allowed references. There
is no downloaded dependency or copied library implementation. Its source/config,
dependency version and fixed labels participate in descriptor identities. See
contract (source checkout: `../examples/native/evaluator-controls-experiment.json`) and
profile patch (source checkout: `../examples/native/evaluator-controls-profile.patch.yml`).
The executor is an explicit fixture for this control experiment: fixed outputs,
not the Target's generated answers, are measured. Scope is format/reference
measurement, not answer correctness, independent final data or Slow fidelity.

The host verifier includes the passing controls, an explicitly constant evaluator
negative control (match rate 0.25, discrimination false), and a missing dependency
that must refuse at plan time without creating a run. `evaluation_complete` does
not certify control success: inspect the frozen constraints in `measurementChecks`.
Freeze a task evaluator only after the declared checks pass and the owner accepts
its scope. A passing four-case control set never automatically certifies a benchmark.

## Structural generation and full history

Provider authors can reuse the native plan's exact binding checks in their existing
host test, without running an experiment:

```js
import {resolveNativeContract} from '@dual-loop/dsh-plugin/contract'
import {inspectProviderContracts, providerContractDependencies} from '@dual-loop/dsh-plugin/provider-contract'
// ctx is your isolated Cordis test context with the intended providers loaded.
const {spec} = resolveNativeContract(reviewedDraft, absoluteContractPath)
const inspection = await ctx.inject(providerContractDependencies(spec), child => {
  const bindings = inspectProviderContracts(child, spec)
  // Assert the declared bindings expected by this test.
})
await inspection.dispose()
```

This synchronous entry returns the same frozen `providers` object as
`dualloop_plan` or throws the same structured binding error. It checks concrete
methods, declared versions, evaluator/metric/data compatibility, dependencies,
permissions and currency/reservations. It does not snapshot the Target, create a
Journal, execute work or qualify measurement quality. Trusted `describe()` methods
must be free of side effects. Use the existing control-evaluation adapter to test
actual correct/incorrect outputs separately. The native packaged-host verifier
also calls this export and compares it with the public plan before any work.
The injected scope is required by DSH service access rules; merely having loaded
providers in a parent context does not declare the consumer's dependencies. The
dependency helper omits the Generator for evaluation-only contracts and grants
no capability that the existing host has not supplied.

Objective fields, directions, stage names and purposes have one runtime definition
in `/stages`; the public authoring schema is built from it. Cross-field, byte,
identity and result-boundary validation remains in the native resolver and work
adapters. TypeScript declarations remain separately maintained; runtime checks
and executable examples do not substitute for semantic TypeScript compilation.

The optional `/structured-generator` implements `GeneratorService`, version `6`.
It reuses `modelSettings`, `modelDescriptor` and `runModelAgent` with one bounded
request per nonempty generation. It does not wrap or alter the original generator.

The supplied quotas create ordered operator slots: exploit appends a focused
suffix, explore replaces the persona, innovate composes two additions after the
parent. The model returns only slot, hypothesis, change; it cannot choose mode or
family. Code binds slot/operator IDs, verifies exact shapes, rejects duplicate JSON
keys, checks hypothesis-before-change order and preserves parent placeholders.
Only after the whole batch passes are controller candidate IDs issued.

`/history-feedback` supplies `historyCompleteness:all_latest_candidates` plus the
full ranked candidate history. It retains parent/version/generation/hypothesis/
delta and numerical/boolean Fast/Slow measurements with their identities. Raw Slow
evidence and all final results are absent. Conservative family thresholds and
bounded quota shifts are inherited from the original provider. A single Slow
failure does not become a family penalty.

Default `/feedback` version 2 and `/history-feedback` version 4 also expose
`slowFeedback`: per-candidate Slow measurement identities, numeric/boolean facts,
recorded `slowVerdict`/`slowDecision`, generation and the frozen constraint rules.
Availability distinguishes observed, absent and unusable/excluded evidence. A
constraint violation is retained even when it is excluded from family statistics;
the penalty thresholds and comparator rules are unchanged. Raw Slow answers and
final evidence remain excluded. Observations are not causal explanations.

The supplied model generator (version `5`, or `6` under the `python-code-v1`
dataset mode) includes this feedback in its request; the
structured generator projects the same allowed fields. Journal feedback events
name the intended consumer and include `feedbackDigest`, which is also bound to
the native generation operation and model receipt. Operation status determines
whether generation actually ran; a feedback event alone is not consumption proof.
Structured receipts additionally bind `searchInputDigest` after projection.
Existing request byte, token and monetary limits remain in force: larger feedback
can be refused, and does not silently increase a model reservation.

Both generators also consume the optional, separately frozen `feedback.warmStart`
native history context. They project only typed search records and retain its
`warmStartDigest` in the actual DSH request artifact/receipt. A custom Generator
must explicitly consume this field to support warm start; a plan/feedback event
alone is not proof that a replacement used it. Historical text is untrusted data;
it does not alter current quotas, objectives, permissions or provider settings.

The existing controller selects history through `duoJournal.open(runId,{create:false})`.
An optional synchronous `FeedbackService.orderHistory(screenedRecords)` returns
unique indices (or a subset) after compatibility and data screening. It only sees
copies of projected search records. The selector cannot replace records or bypass
record/byte caps; malformed selections refuse the plan. `/history-feedback` supports
`historyOrder:balanced` (default) and `recent_failures_first`, with the policy bound
in the provider descriptor and `warmStart.selector`. A custom Feedback subclass can
override only this method and describe its own versioned identity. The default
Feedback without this method retains balanced ordering. No new service or registry
is required. See the [shipped warm-start example](examples/product/README.md); the additional
model guide is source-only (`../examples/native/warm-start.md`).

The native Journal supports `events({maxEvents,maxBytes})` as a bounded read-only
accessor; ordinary `events()` remains unchanged. Source caps are 2048 events and
4 MiB before parsing. New generation still uses a fresh baseline and its current
immutable ledger. No old operations or receipts are imported.

Comparability requires same Target path, verified parent/content lineage, matching
search objectives/constraints, full provider declarations including configuration
digests and recorded host environment. Missing configuration or old environment
metadata means ideas only. Equality is declared compatibility, not attestation of
a provider's hidden state. Final evaluator values never participate in candidate
selection; final-data identity is retained outside model context solely to qualify
results. See the public guide for conservative final independence and fixture rules.

The public plan's `searchPolicy` specifies same-run Target-owned content identity.
The Controller first validates parent/scope/quotas, then skips content already
present under another candidate or baseline. `duplicate_skipped` rows retain
`duplicateOf`, content digest, Delta and hypothesis; skipped measurements remain
`NOT_EVALUATED` with no copied source score. Generation was already performed and
is still charged. An all-duplicate batch stops as `no_new_candidates`; no replacement
generation or retry is hidden. Persona uses exact text identity; config uses
locked persona plus configuration. Custom adapters define stable identity. None
of these declarations independently establishes semantic novelty.

An owner-reviewed contract may set optional `allowNoiseRepeats:true` (default false).
A caller-owned Generator can then return a duplicate with
`repeat:{purpose:"noise_measurement",reason:"predeclared reason"}`. The reason must
be nonempty and at most 1024 bytes, and the exact content must already exist in this
run. The repeat retains `duplicateOf` and runs through ordinary execution/evaluation
accounting. Invalid or unapproved repeat declarations refuse before any candidate
in that batch executes; already measured baseline/generation costs remain settled.
No automatic aggregation, statistical qualification or additional allowance is implied.
The supplied model generators seek distinct hypotheses and do not declare repeats.
The noise-repeat fixture (source checkout: `../examples/native/noise-repeat-profile.patch.yml`) and
contract (source checkout: `../examples/native/noise-repeat-experiment.json`) demonstrate the explicit
public opt-in at CNY zero. Synthetic-fee unit tests are accounting tests, not savings.

The controller records its already-computed Fast score/verdict/rank and parent
identities for this view; no second scoring policy is invented. The generator
receives every Fast example, not only two examples. Oversized inputs are refused
by existing model input limits; history is not silently truncated. Freeze a
realistic input/response reservation in the plan, and do not expand it automatically.

## Frozen contamination exclusions

`/exclusion-comparator` implements the existing comparison service. Configure:

```js
{exclusions:[{candidateId:'dl-0001',evaluatorId:'my-fast',version:'1',
  dataId:'dev-v1',tier:'fast',reason:'Owner-confirmed contaminated input'}]}
```

Every identity and the reason are required. Exclusion sets are frozen and hashed
into the provider descriptor, so changed configuration requires a new plan. An
excluded incumbent cannot justify promotion of another candidate. Raw metrics
remain untouched; the comparison labels the evidence incomparable and retains
the exclusion reason. Apply the same list to `/history-feedback` when composing
these providers. This is not permission for the optimizer to edit criteria or
retroactively rewrite an existing run.

## Native Observer

`ObserverService` owns `duoObserver`; `/observer` reads the existing controller
status, and `/observer-tools` exposes `dualloop_report`. Reports join candidate
transitions, comparison results, final receipts and the latest budget. Unknown
cost remains null. Unconfigured/unexecuted/unpromoted/unselected tiers are distinct.
The report includes lineage, hypotheses/deltas, declared evidence families and
health summaries; cost per Slow-accepted candidate is not cost per proven benefit.

`includeEvents:true` exports existing events as JSONL without writing a second
journal. The output may be saved through ordinary authorized host tools. Reading
reports does not execute providers, resume a run, modify final results or deploy.
<!-- Current v2 increment; existing contracts below remain applicable. -->

Evaluation-only composition uses `/evaluation-controller`, which inherits the
native controller's execution, cancellation, Journal and settlement methods and
removes only its unused Generator dependency. It requires an explicit
`operation:"evaluate"` contract, zero generations/quotas and measurement objectives.
Existing `dualloop_plan/run/status/report` are the public entry. `providers.generator`
is null in this plan, and discovery does not declare an active generator.
The result exposes `evaluations` and `measurementChecks`. A completed measurement
can violate quality constraints; retaining the original does not mean it passed.
It is not a separate evaluation engine, and it cannot run an optimize contract.
# Product foundation Target boundary (0.5.0)

The runtime accepts a syntactically valid target kind, then checks the active
adapter's `describe().targetKinds`. Built-in catalog and partial support are in
CURRENT_STATUS.md and `/capabilities`; discovery also shows custom descriptors.
Core does not inspect persona/config fields. A Target snapshot has `id`,
`version`, optional `path`, and adapter-owned content. `identity(snapshot)` must
be a stable content identity; the compatibility fallback is snapshot.version.
Candidate ids/parent versions, Delta, execution and measurements retain their
existing meanings.

For warm start implement pure `validateSnapshot(snapshot)` and
`projectDelta(delta)` plus `apply(candidate,parent)`. History validates the full
lineage using those methods; projection must return only documented Delta data,
never raw outputs, final evidence or arbitrary metadata. Target methods must not
execute models or side effects. Older adapters still run using their versions
but do not gain history support automatically. `/target-protocol` publishes the
identity/history checks; `/warm-start` publishes bounded projection helpers.
Generators using projected history must supply their Target-specific projector
to `projectWarmContext(context, projectDelta)`.

To replace measurement, attach `/function-evaluators` with an existing function,
versioned descriptors and data/implementation digests. The complete shipped
`examples/product/byo-evaluator.js` does this. Replace ComparatorService for
evidence aggregation or GateService for promotion; reuse FeedbackService's
optional `orderHistory` for history selection. No new registry is needed.
Changing a provider requires a newly inspected plan. Public text examples are
local formatting measurements, not qualification for arbitrary Agent tasks.
