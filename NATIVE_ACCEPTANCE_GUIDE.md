# Native comparison and Calling Agent acceptance

Both entries reuse the existing packed DSH plugin and an already cached DSH CLI.
They stage new named profiles below the supplied output directory. No install,
global profile change, production persona modification or legacy loop is used.

## Original / single / dual comparison

```sh
python3 scripts/run_native_comparison.py --mode offline --dsh-package /path/to/cached/@deepseek-ai/dsh --output /tmp/duo-comparison-offline
python3 scripts/run_native_comparison.py --mode prepare-live --dsh-package /path/to/cached/@deepseek-ai/dsh --pricing /path/to/current-cny-pricing.json --output /tmp/duo-comparison-live
python3 scripts/run_native_comparison.py --mode execute --output /tmp/duo-comparison-live --authorization /path/to/user-approved-comparison.json
python3 scripts/run_native_comparison.py --mode inspect --output /tmp/duo-comparison-live
```

The protocol is frozen before any arm runs: identical original persona, search
splits, separately authored final split, model and evaluator, with two paired
repetitions. Single and dual search each generate one candidate per generation
for two generations. Baseline generates none but measures fast/slow calibration
and final. Single uses the existing `fast_only` branch, with no slow feedback;
its final assessment is separate from its unvalidated search conclusion.

Each of six arms has a CNY 0.5 ceiling, with no transfers between arms. Request
safety caps match maximum protocol work: baseline 3, single 7, dual 10 per repeat.
The entire proposal is **CNY 3 and 40 requests**. These are ceilings, not cost
predictions or a new authorization. Review the prepared protocol and manifest;
`authorization-template.json` deliberately leaves approval and approval text empty.
Approval must bind the exact prepared digest. An interrupted batch refuses automatic
replay, even if some arms completed; inspect partial accounting first.

Every model-profile launch manifest also seals the runtime location, profile,
scope, caps and all input fingerprints. Child authorization carries its
`manifestDigest` as well as the controller `planDigest`. Changed launch metadata
is rejected before credentials enter a child process. Older unsealed preparations
must be prepared anew; retained terminal results remain readable without calls.

The report contains each arm's final scores, regression versus its own baseline,
total cost, calls, wall time, repeat dispersion, and terminal resources when the
threshold is attained. Two repeats and four final questions support descriptive
results only. Supplied-context substring/citation scoring is not a qualified
semantic/retrieval benchmark. The final questions are shared by the frozen arms;
they are not fed to search and cannot be advertised as fresh in later tuning.

## Model Calling Agent

```sh
python3 scripts/run_native_calling.py --mode offline --dsh-package /path/to/cached/@deepseek-ai/dsh --output /tmp/duo-caller-offline
python3 scripts/run_native_calling.py --mode prepare-live --dsh-package /path/to/cached/@deepseek-ai/dsh --pricing /path/to/current-cny-pricing.json --output /tmp/duo-caller-live
python3 scripts/run_native_calling.py --mode execute --output /tmp/duo-caller-live --authorization /path/to/user-approved-caller.json
```

A fresh native DSH model Agent receives only the short public calling guide,
acceptance goal and the configured DUO tools. It must discover, inspect, recover
from a deliberately stale digest, run, inspect result/accounting, repeat without
more work, and correctly describe fixture limits. There are no shell/editor
tools or private implementation conversation in its context. Every outer model
request reserves and settles against the existing native CNY ledger; unknown
usage stops further admission. Proposed cap: **CNY 1 and 8 requests**, separate
from comparison and from the previous Q3 allocation.

The inner optimizer work is deliberately CNY0 static fixture work. Real execution
therefore qualifies model-driven use of an already configured plugin, not prompt
improvement or independent provider authoring. The previous independent Agent's
evaluator/strategy replacement acceptance remains separate evidence.

Receipts record time from trial start to first completed native run, total wall
time, supplied guide bytes, provider-reported aggregate input/cache/output tokens,
human interventions, error recovery, tool calls, full session events and costs.
Exact tokens attributable to the guide alone are not separable from provider
usage. Offline output and simulated tariffs are marked fixture, actual fees CNY0.

The Calling profile enables the existing native `/json-output` extension with
`includeCallerSessions: true`. It requests `response_format: {type: "json_object"}`
for owned `duo-caller-UUID` sessions and preserves a separate HTTP-acceptance
receipt per request in `json-output/`. Auxiliary requests are excluded. Default
single-operation JSON profiles keep their prior scope and receipt filenames.
The strict whole-response parser and fixture-evidence checks remain authoritative:
HTTP acceptance or JSON mode alone cannot qualify empty, truncated or inaccurate
output. See the [provider JSON-mode contract](https://api-docs.deepseek.com/guides/json_mode/).

The offline scripted caller records `fixture-json-output-probes.json` from the
actual registry's preparation hook. Those probes make no HTTP request and do not
claim HTTP acceptance or real model compliance. A model-driven complete trial
still needs a sufficient recorded allocation; every failed trial remains paid
according to its actual usage.

Both prepare modes make zero model requests. Both execute modes require explicit
recorded allocation and a present `DEEPSEEK_API_KEY`; credentials never enter
artifacts. Inspecting a terminal artifact does not rerun the model.
