# Caller attachment, real inner providers and later warm start

Run `scripts/research/run_maturation_calling.py --help` from the project root. This entry
uses the existing DSH profile loader, native DUO controller, model generator,
Executor and persistent budget; it is an acceptance application, not a second
optimization engine. It does not alter user profiles or adopt candidates.

The initial profile includes the public DUO guide, an unchanged existing persona,
a proposed frozen objective/contract, and a caller-owned measurement resource.
The resource [schema-answer-evaluator.js](./schema-answer-evaluator.js) applies
the installed Schemastery validator to actual task answers. It checks required
task IDs, types, nonempty answers and citations from the supplied source paths.
It does not judge semantic correctness. Control samples distinguish malformed
and valid outputs; those controls are never counted as optimization gains.
The evaluator has a new identity/version; its scores are not old lexical or
semantic evaluator results.

The resource deliberately does not register `duoEvaluators`. A separately
created Caller session uses public `cordis_inspect_list/query` to inspect its
contract and supplied adapter source, then `cordis_define/run` to attach it.
The acceptance profile permits only that exact pre-reviewed bridge and rejects
arbitrary dynamic host code. The bridge delegates existing measurement methods;
it changes neither the metric nor core implementation. This tests Bring/Find
and adapter attachment, not unrestricted provider authoring.

`dualloop_describe.runtimeAvailability` reports the actual visible Generator,
Executor, Evaluator and Controller bindings before attachment. The separate
`Service.listService` coding catalog need not list these plugin services.
Use the resource's published contract; a missing catalog entry is not a runtime
absence. `executionReady:false` means the guide has not validated an experiment,
and `authorityGranted:false` means a description grants no additional authority.
Neither flag cancels the task's explicit authorization to attach the supplied
adapter. The offline control queries the uncatalogued resource, observes its
coding-catalog refusal, then still attaches the real existing host service.

DSH rejects unresolved required top-level plugins during boot. The optional
[`deferred-runtime`](./deferred-profile.patch.yml) composition keeps preparation
available before the Evaluator exists, then mounts the existing Controller,
Observer and tools once their dependencies are present. Unloading a dependency
retracts those consumers. `evaluationOnly: true` selects the existing evaluation
controller without requiring a Generator. It introduces no alternative core.

The Caller validates and writes the first contract into the isolated experiment
file using native `read/write`, inspects the plan and runs it. After reading the
report, it writes a second contract with the actual first run ID in `warmStart`,
then inspects and runs again. Both runs have two generations and one candidate
per generation. The profile rejects other contract changes, reads of private
data/receipts and writes to the original persona. Nonpromotion, duplicate skips,
unmeasured stages and no improvement remain valid outcomes.

All model calls share one native admission ledger, including the Caller and
inner generation/execution. The deterministic custom evaluator makes no model
requests and records CNY0. The proposed real batch cap is CNY4 and 40 requests,
subdivided into at most 20 Caller and 20 inner requests. No hidden retry plugin
or auxiliary model is loaded; the provider retry setting is zero. Each request
is reserved before dispatch and settled from usage. Missing usage stops further
work. Inner DUO ledgers overlap the total ledger; never add the same model
charges twice. Final accounting checks the two views against each other.

The Caller has a 327,680-byte assembled input cap by default, with a reservation
of at least CNY0.7 increased if the frozen price envelope requires it. Each inner
call has 32,768 bytes and CNY0.15. Reservations do not increase the total CNY4 cap.
Earlier 131,072-byte and 196,608-byte Caller caps have retained refusal evidence.

Terminal reports distinguish completed native runs (`innerRunIds`) from every
returned native attempt (`attemptedInnerRunIds`). A failed warm-start generation
can have actually consumed historical context and incurred settled charges;
both facts remain visible. Completing both two-generation experiments is still
required for combined acceptance. Accurate failure interpretation alone cannot
pass that gate. `conclusions` must copy exact `dualloop_report.conclusion` codes;
`innerLedgerCostsCny` must copy numeric `budget.costCny` values, with `null` for
unknown cost. Narrative belongs in `explanation`. Do not quote numbers or add
inner fees again to the admission ledger.

`--fixture-invalid-warm-proposal` reproduces a missing `persona` field using
scripted transport. Its failed combination must retain history consumption and
reconcile both native ledgers. It is an offline control (zero real fees), and
real preparation rejects this flag. Generator version 5 adds structured invalid
candidate diagnostics; schema, generation prompt, score rules and no-retry
behavior are unchanged. A rejected model response retains its original output
and usage; no replacement persona is fabricated.

If both native experiments completed and only Caller report delivery hit its
request cap, `scripts/research/run_maturation_delivery.py --help` exposes a bounded
result-delivery continuation. It validates the retained journals, seeds the
original Caller event history through DSH `agents.create({sessionId, seed})`,
and exposes only `dualloop_report`. A read-only Observer provider reconstructs
reports from those verified artifacts; no Generator, Executor, Evaluators or
Controller is mounted. It never replays a terminal experiment or changes its
failed aggregate record. One recorded recovery instruction permits reporting
only and retains the original final-response contract.

`--mode offline` tests this path with scripted transport and zero real fees.
`--mode prepare-live` seals the source history, pricing, profile and a proposed
transfer of four unused inner request slots to Caller, with an attempt cap of
CNY1. This does not authorize or apply the transfer. `--mode execute` requires
an explicit receipt matching the unchanged cumulative consumption, total caps
and sealed proposal. The final ledger includes the retained batch's prior
consumption; unknown usage stops further requests. A successful offline
continuation is not real Caller delivery or an uninterrupted combined run.

```sh
# New output directory; existing cached DSH only. No model calls or fees.
python3 scripts/research/run_maturation_calling.py --mode offline --dsh-package /absolute/path/to/installed/@deepseek-ai/dsh --output runs/my-new-combination

# Separately stage real adapters and a sealed manifest; still no model calls.
python3 scripts/research/run_maturation_calling.py --mode prepare-live --dsh-package /absolute/path/to/installed/@deepseek-ai/dsh --pricing /path/to/fresh-official-cny.json --output runs/my-new-preparation

# Only after the user authorizes this exact new scope, plan, manifest and caps:
python3 scripts/research/run_maturation_calling.py --mode execute --output runs/my-new-preparation --authorization /path/to/approved-allocation.json
```

`authorization-template.json` is blank authority, not a grant. The shared launch
validator refuses other scopes, stale manifests, modified inputs, existing
claims or journals, and absent credentials. It reads an existing terminal result
without rerunning it. An interrupted attempt must be inspected and reconciled;
preparing another directory never creates a new allocation.

To continue the same maturation batch after its settled original attempt and
format diagnostic, supply `--continuation /path/to/consumption-inputs.json` when
running `offline` or `prepare-live`. The JSON object names `parentRun`,
`parentAuthorization`, `parentSummary`, `probeRun`, `probeAuthorization` and
`batchSummary`; paths resolve relative to that file. These are existing receipts,
not new authority. The cumulative summary must include both runs and their
source hashes. Unknown usage, unpaid reservations, changed receipts, another
batch or a summary omitting the diagnostic are rejected before preparation.

The entry deducts prior requests and cost, including the Caller/inner subcaps,
from the original batch. Those remaining limits reach the public resources,
native request admission and frozen authorization template. The shared execute
entry rechecks the same consumption even when invoked directly. A follow-up
authorization must bind this plan, manifest, batch and remaining caps; the old
approval cannot authorize a newly prepared run. No automatic replay is added.
An explicit purpose approval lasting through the Goal may cover later reviewed
launches within its resource limits; it need not be requested again for each
attempt. Record that approval when binding a new plan. It does not reset fees,
request counts or Caller/inner subcaps.
`batchAccounting` in the terminal result combines prior real use and this
attempt; offline scripted responses never consume the real remainder. Native
inner ledgers still overlap the attempt total and must not be charged twice.

After another terminal continuation, use a new consumption descriptor naming
`priorContinuation`, `settledRun`, `settledAuthorization` and `batchSummary`.
The first points to the previous descriptor; the other fields identify the
latest settled attempt and cumulative audit. Both successful and failed real
attempts are deducted. The bounded read-only receipt chain verifies the frozen
prior allowance, usage, distinct settlements and source hashes. It neither
resumes a session nor allocates funds. Never reuse a descriptor that omits a
later attempt from the same batch.

If the user explicitly amends request counts, a descriptor can instead name
`priorContinuation` and `requestCapAmendment`. The amendment must record actual
user approval, the same batch/CNY, the complete verified `priorAllocation`, and
`before`/`after` total and Caller/inner caps. This path allows integer request
increases only; it cannot increase the CNY cap or discard any prior charge.
The receipt and descriptor are frozen into the next plan and rechecked by the
shared execute entry. A purpose approval without a count amendment leaves the
original request limits in force.

The Caller input envelope is frozen by `--caller-max-input-bytes` (default and
maximum 327680). The entry computes a CNY reservation covering that envelope,
4096 bytes of overhead and the fixed output allowance; the total batch cap
still applies. The wider default addresses an observed 199405-byte discovery
transcript rejected by the former 196608-byte bound. It does not guarantee all
future transcripts fit. `DUO_REQUEST_INPUT_LIMIT` records measured and allowed
bytes; `DUO_REQUEST_ROUTE_MISMATCH` separately records route/output-limit drift.
These refusals occur before dispatch or reservation and are retained in
`request-refusal.json`. Original sealed runs and their limits remain unchanged;
there is no silent history trimming or automatic retry. For a zero-dispatch
offline boundary control, pass `--caller-max-input-bytes 1`.

If remaining Caller requests cannot finish the scripted or real workflow, the
entry stops and reports the unmet checks. It does not expand the allowance or
relax acceptance. Freeze the current official model routing and CNY tariff at
preparation: an unchanged API model alias need not mean an unchanged backend.
Provider changes must be recorded separately from DUO behavior or benefits.

Offline controls are available as `--fixture-missing-usage` and
`--fixture-request-limit 1`. They are expected to return nonzero and retain an
incomplete report after at most one scripted request. The normal offline
transport also attempts a denied original-file write and unapproved bridge;
both must be refused. These flags cannot be used in real preparation.

`--fixture-tool-text-stop` checks an early Caller stop with tool-shaped text:
no tool or inner work is dispatched and the result names the unmet acceptance
conditions with `DUO_CALLER_TOOL_TEXT`. Plain-text tool syntax is never executed.
Other incomplete outcomes retain `DUO_COMBINATION_INCOMPLETE`, while existing
provider/accounting errors take precedence. These codes identify recorded
symptoms, not the upstream model cause, and do not trigger an automatic retry.

For a separately approved, bounded diagnostic of this symptom, see the
[Caller response-format probe](./caller-format-probe.md). It records two model
responses without executing tools and retains the parent batch's consumption.

Artifacts include the sealed preparation, resource/target hashes, Caller session,
all tool calls and assembled model inputs, model usage receipts, custom
judgments, native Journals, per-candidate Fast/Slow/final reports, interpreted
result, and one reconciled total cost ledger. The Caller receives only public
guide/resources and tool results; it receives no implementation transcript or
private coaching during execution.

The existing question sets have been used in earlier experiments. They are not
new unseen final data, and warm-start results explicitly carry the independent
final limitation. A pass establishes only the recorded integration under these
resources. It does not establish semantic answer quality, optimizer superiority,
cheaper operation, deployment or general autonomous provider authoring.
Offline transport never counts as real Caller use. Real completion remains
pending until a separately authorized model run supplies those receipts.
