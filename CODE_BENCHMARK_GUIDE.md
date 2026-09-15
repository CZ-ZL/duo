# Python code benchmark evaluation

Historical research guide, retained for traceability. Version/active-Goal wording
below belongs to the original research phase, not the current product release.
Referenced `runs/` paths require the private local archive and are not part of
this repository distribution. Use [EXPERIMENTS.md](EXPERIMENTS.md) for the retained
conclusions and [CURRENT_STATUS.md](CURRENT_STATUS.md) for supported product use.
Research is paused; this guide does not authorize paid execution.

The current reviewer/control version is **2**. It clarifies short continuous
quotations and exports task/field errors in `qualification.json` and
`qualification.txt`; see [local repair evidence](runs/code-review-protocol-20260912/REPORT.zh.md).
Real v2 adherence is not yet verified.

The first real code-review calibration stopped on invalid contract quotations;
the reviewer remains unqualified. See the [actual run and limits](runs/code-slow-review-20260912/real-calibration/REPORT.zh.md).

The optional [public code-contract reviewer](examples/native/code-review.md)
adds a separate native measurement and a bounded calibration entry. Its local
controls are engineering verified; real reviewer qualification and integration
into a new optimization objective remain pending. Existing unittest scores and
the method-comparison objective are unchanged.

This task adapter loads as a DSH/Cordis plugin through the existing public
`@dual-loop/dsh-plugin/function-evaluators` provider. The optimized Target remains
a persona/system prompt. No DUO controller, loop or scheduler was added.

Current active experiment Goal and latest partial repairs are in
`runs/code-method-goal-20260912/`; the preceding full diagnostic is in
`runs/code-contract-audit-20260912/`. The original measured baseline uses
`benchmark-v2/` with evaluator version **3**. New opt-in complete-input and
development-contract packs are described below. Previous versions and their
failures are retained; their measurements are not pooled.

## Run the local acceptance

From `dualloop/`, using the already cached DSH installation:

```bash
python3 scripts/verify_code_benchmark.py --benchmark-pack runs/code-benchmark-readiness-20260911/benchmark-v2 --dsh-package "$DUO_DSH_PACKAGE" --output /tmp/duo-code-controls-new
```

Choose a new output directory. The entry packages current native code offline,
boots a new named `duo-code-readiness` profile, and uses public discover, plan,
run, status, budget and report tools. It checks six predefined output controls
and terminal replay. It writes the exact profile, code, calls, Journal, test
receipts and report. No model adapter is loaded, no dependencies installed, and
no original user profile changed. This is an implementer-driven engineering
acceptance, not independent Calling Agent or optimization evidence.

To validate development references and an intentionally wrong constant output:

```bash
python3 scripts/check_code_benchmark.py --pack runs/code-benchmark-readiness-20260911/benchmark-v2 --output /tmp/duo-code-development-new
```

This executes Fast/Slow reference and control programs only. It never evaluates
final. The reference programs are supplied by the benchmark, not model outputs.

## Attach the evaluator to another native profile

Copy `scripts/dsh_code_evaluator.js`, `scripts/code_evaluation.py` and
`scripts/code_worker.py` together into the caller-owned profile. Add:

```yaml
- insert:
  - id: code-evaluator
    name: ./dsh_code_evaluator.js
    config:
      pack: /absolute/path/to/benchmark-v2
      artifactRoot: /absolute/path/to/new-execution-receipts
```

Omit `controlsPath` for ordinary measurements. That option is exclusively for
predefined evaluator controls. The provider IDs are `code-unittest-fast`,
`code-unittest-slow`, `code-unittest-final`, version `3`. Data IDs are
`bigcodebench-stdlib-v2-fast`, `bigcodebench-stdlib-v2-slow`, and
`bigcodebench-stdlib-v2-final`.

Configure the existing ModelExecutor with this pack's `dataset.json` and normal
authorized model/pricing settings. `responseMode: python-code-v1` requests a
JSON object mapping task IDs to complete Python source strings. Only the public
inputs for the selected tier enter the request. Private tests and reference
solutions stay in `answer-key.json`. Default documents still use citation mode.

For retained outputs the evaluator also has a standalone entry:

```bash
python3 scripts/code_evaluation.py --pack /absolute/path/to/benchmark-v2 --tier fast --output /tmp/duo-code-retained-new < artifact.json
```

`artifact.json` must contain `text` (the JSON mapping encoded as a string).
When supplied, `status` must be `completed` and `tier` must match the request.
Source/data identities are bound by the native provider and checked before each
invocation. Missing or unknown execution evidence fails closed.

The generic `run_dsh_model.py` application rejects subprocesses by default.
`run_code_model.py` now composes it with this evaluator using an explicit process
declaration: only the staged Python evaluator, copied pack, Fast/Slow tiers,
receipt directory, clean environment and at most two executions are allowed.
This is a trusted-provider capability check; the Python worker supplies the
candidate containment. It is not a general security audit.

The separate code-method entry can explicitly declare final, limited to one or
two executions per arm. Its process policy also caps each Fast/Slow tier. The
baseline-only entry keeps its original two-call Fast/Slow policy and cannot use
final through that declaration.

## Model execution and code evaluation together

Run a real named DSH profile with predeclared offline model replies:

```bash
python3 scripts/run_code_model.py --mode offline --benchmark-pack runs/code-benchmark-readiness-20260911/benchmark-v2 --dsh-package /absolute/path/to/cached/@deepseek-ai/dsh --output /tmp/duo-code-model-reference-new --fixture-scenario reference
```

Use `--fixture-scenario wrong` in a different output directory to exercise a
constant wrong reply. Both paths use existing ModelExecutor, actual DSH Agent
sessions, local Python unittest execution, public DUO tools, Journal and report.
Model replies, usage and prices are synthetic: these runs establish functionality
only. Neither final nor an independent Calling Agent runs in this entry.

Prepare a finite real baseline without making API requests:

```bash
python3 scripts/run_code_model.py --mode prepare-live --benchmark-pack runs/code-benchmark-readiness-20260911/benchmark-v2 --dsh-package /absolute/path/to/cached/@deepseek-ai/dsh --output /tmp/duo-code-baseline-new --pricing /absolute/path/to/current-cny-pricing.json
```

This freezes a neutral coding persona before model answers, the same dataset and
version 3 evaluator, Fast/Slow only, two requests, zero retries, 65,536 input bytes,
16,384 output tokens per request, and a CNY0.80 cap. Each request reserves CNY0.40;
the peak tariff input+framing/output envelope must fit that reservation. The
model is explicitly `deepseek-flash`; preserve its dated served-version record
instead of assuming an old alias identifies an unchanged model. All private pack
files and the protocol are included in the sealed manifest. Original source pack
and persona are never deployed or overwritten.

Execution reuses the existing authorization-checked runner:

```bash
python3 scripts/run_dsh_model.py --mode execute --output /tmp/duo-code-baseline-new/run --authorization /absolute/path/to/approved-allocation.json
```

An allocation must cover the exact `planDigest`, `manifestDigest`, scope,
currency, amount and request count in `run/prepared.json`. Preparation creates
no authorization. Reconcile the current parent ledger before recording an
approved allocation; closed-batch balances are not automatically available.
There is no automatic repair/retry, generation, deployment or final evaluation.
Inspect `run/result.json`, `journal.json`, `cost-receipts.json`, `sessions/`,
`executions/`, and `product-report.json`. The protocol's development qualification
requires both a pass and a failure with valid format and no infrastructure error;
failure to qualify is retained and diagnosed without changing scoring or using
final to choose another task. This pilot is not method comparison evidence.

## Dataset and measurement

For new input calibration, use the explicitly versioned complete public prompt:

```bash
python3 scripts/prepare_code_benchmark.py --source runs/code-benchmark-readiness-20260911/upstream/BigCodeBench-v0.1.4.jsonl --output /tmp/duo-code-complete-new --prompt-format complete
```

This produces `code-readiness-v3-complete` and data IDs
`bigcodebench-stdlib-v3-complete-{fast,slow,final}`. All 36 task IDs, split
membership, reference solutions and original unittest text are unchanged.
Only the model input changes to the upstream `complete_prompt`, including its
public examples. Private tests and canonical implementations are never copied
into `dataset.json`. Missing complete prompts fail before output creation;
there is no silent fallback. Omitting the flag reproduces the old v2 pack.

Pass this pack to the same `run_code_model.py --benchmark-pack ...` entry.
The scoring implementation remains version 3. Input and scoring versions are
distinct: the earlier real v2 result of 12/18 must not be compared or pooled as
though it were a real baseline on v3-complete. A new real baseline is NOT_RUN.

Full prompts repair an input omission, not the original test suite's validity.
The development audit found API-specific mocks and demonstrated five flawed
controls that still pass their original tests. Initial separate semantic
checks were diagnostic artifacts. Three checks are now available in an explicit
opt-in suite through the same public evaluator:

```bash
python3 scripts/prepare_code_benchmark.py --source runs/code-benchmark-readiness-20260911/upstream/BigCodeBench-v0.1.4.jsonl --output /tmp/duo-code-contract-new --prompt-format complete --test-suite dev-contract-v1
```

This creates `code-readiness-v4-dev-contract1`, with evaluator version **4**,
key suite `bigcodebench-unittest-dev-contract-v1`, and data IDs
`bigcodebench-stdlib-v4-dev-contract1-{fast,slow,final}`. It preserves all original
tests and adds one assertion each for decomposed Unicode NFC, source deletion
after moving a file, and permitted shopping items. Only the three diagnosed
development tasks change. The same 36 complete public prompts and all final test
bytes remain unchanged. Original test hashes and development membership are
checked before writing; there is no fallback on drift. The manifest records
each addition's requirement and source/combined hashes.

Use this pack with `run_code_model.py --benchmark-pack ...` as above; it selects
the pack's declared evaluator version. For manual attachment, change contract
objective versions to `4` and data IDs to this pack. Provider IDs stay the same.
The metric is now all original tests **and** the applicable registered additions.
Retained artifact evaluation is allowed but is diagnostic replay, not a new
real baseline or optimization benefit. The original 12/18 is unchanged.

These are three bounded repairs. Randomness, ambiguous requirements and
implementation-coupled mocks still prevent full measurement qualification.
Do not call the current suite qualified for general code quality or freeze a
paid method comparison on that basis. The 18-task audit and retained probe
evidence are in [code-contract-audit](runs/code-contract-audit-20260912/REPORT.zh.md).

### Owner-selected salt contract and evaluator version 5

The owner resolved task130's contradiction in favor of the public specification:
**SHA256(data + salt)**. The upstream reference instead prepends salt. The opt-in
`--test-suite dev-contract-v2` creates `code-readiness-v5-dev-contract2`, data IDs
`bigcodebench-stdlib-v5-dev-contract2-{fast,slow,final}`, and evaluator version `5`.
It adds digest-recomputation and fresh-salt checks, appends an explicit public
clarification, and corrects only the reviewed reference's concatenation order.
All original tests and the prior three additions remain. Final is unchanged.
The manifest binds source/corrected reference and prompt hashes. Source drift
fails before output; original v2 and v4 packs still regenerate byte-identically.

```bash
python3 scripts/prepare_code_benchmark.py --source runs/code-benchmark-readiness-20260911/upstream/BigCodeBench-v0.1.4.jsonl --output /tmp/duo-code-salt-new --prompt-format complete --test-suite dev-contract-v2
```

Use the resulting pack with the same `run_code_model.py` entry; it selects
evaluator version5. This remains a partial instrument repair, with no new real
model baseline or method-effect result. A two-sample fresh-salt check does not
establish cryptographic randomness quality. See the owner decision and native
101-test receipt in `runs/code-method-goal-20260912/`.

### Published seeded examples and evaluator version 6

Task862's original five tests accepted all-a output, a fixed seed and mismatched
dictionary values. A separately recorded control accepts both the reference and
an independent local-RNG/Counter implementation, while rejecting those three
errors using the two complete public examples. The opt-in
`--test-suite dev-contract-v3` appends these two assertions and creates
`code-readiness-v6-dev-contract3`, evaluator `6`, with matching data IDs
`bigcodebench-stdlib-v6-dev-contract3-{fast,slow,final}`. Original tests, prior
repairs, all public inputs and references remain unchanged since v5. Final tests
are unchanged. Source test and public prompt hashes guard the addition.

```bash
python3 scripts/prepare_code_benchmark.py --source runs/code-benchmark-readiness-20260911/upstream/BigCodeBench-v0.1.4.jsonl --output /tmp/duo-code-seed-new --prompt-format complete --test-suite dev-contract-v3
```

Use the new pack with the same evaluator and `run_code_model.py` entries. This
checks published seeded examples, not randomness quality or arbitrary unseen
seeds. Other contract gaps remain; no new real model score or method advantage
has been measured. The first diagnostic miscopied one count; original failure,
source-based correction and final control receipts are preserved in the Goal
directory. The benchmark's public example itself needed no correction.

### Single-loop comparison preparation

The public `singleLoopCodeData(datasetBytes, answerKey)` adapter in
`examples/native/method-feedback.js` handles code keys' exact byte hashes and
flat task rows separately from the fact benchmark. Its CLI derives all18
development tasks into one Fast split while retaining final and every test:

```bash
DUO_DSH_PACKAGE=/absolute/path/to/cached/@deepseek-ai/dsh node --experimental-loader ./scripts/dsh_native_loader.mjs scripts/prepare_code_single_loop.mjs /absolute/path/to/source-pack /tmp/duo-code-single-loop-new
```

The output has dataset, answer key, manifest and derivation receipts. Source
identity/overlap failures are refused; write the supplied serialized bytes to
preserve the key hash. This command makes no model requests and performs no
final evaluation. The standalone Python evaluator can consume the derived
Fast pack; the existing baseline-only `run_code_model.py` deliberately requires
both Fast and Slow. The separate bounded method entry below handles the union.

MethodFeedback version2 recognizes `executed_python_unittest` for code B1 and
preserves per-task success/failure, counts, timing and test errors. It filters
out private row fields and rows outside public development IDs. Fact feedback
continues to use its original evidence kind. All18 development inputs and
retained local failure rows have reached an actual DSH Agent generator request
with synthetic transport; this is component evidence, not a real optimization
run or independent Calling Agent acceptance.

### Bounded code-method entry

`scripts/run_code_comparison.py` composes the existing native comparison
lifecycle, StructuredGenerator, ModelExecutor, Python evaluator, Feedback and gate.
It runs B0 (original/final only), B1 (all18 development tasks), B2 (Fast/Slow),
and B3 (explicit Slow feedback removed). The default `history-structured-v2`
profile plans two generations and three candidates per generation: one local
append, one strategy replacement and one two-strategy composition. Optimizing
arms have equal total CNY2.40 ceilings; B0 is CNY0.40. Request maxima are
1/11/14/14, including generation and independent final.
The aggregate ceiling is CNY7.60/40 requests. These are bounded plan
settings, not new spending authorization or a promise of completed search at
maximum-length responses. A monetary stop can bind before the request cap.

The engineering corpus is separate from BigCodeBench and uses artificial final
tasks. Its fixture intentionally gives the original one wrong answer and the
candidate a correct answer to exercise adoption/final wiring. It cannot prove
optimization benefit, and cannot execute the held-out BigCodeBench final:

```bash
python3 scripts/run_code_comparison.py --mode offline --benchmark-pack runs/code-method-goal-20260912/engineering-pack --target runs/code-method-goal-20260912/engineering-persona.txt --dsh-package /absolute/path/to/cached/@deepseek-ai/dsh --output /tmp/duo-code-method-controls-new
```

Inspect `comparison-protocol.json`, `comparison-result.json` and each arm's
Journal, candidates, model request/session receipts, Python execution receipts
and product report. All per-candidate Fast/Slow/final states remain explicit.
The reporter checks actual feedback/Journal identity, full method coverage and
receipt transport kind; removing an arm or relabeling fixture transport cannot
produce a complete real-method claim or invent paid charges.

MethodFeedback history mode version3 retains all ranked candidate deltas,
hypotheses and Fast measurements, including rejected and duplicate candidates.
StructuredGenerator version6 carries sanitized measured failure rows into the
actual request and assigns structural operators. Examples illustrate proposal
syntax only. Existing exact-persona duplicate detection skips redundant
execution; semantic novelty is not guaranteed. Input limits fail explicitly;
history is not silently truncated. B1 sees all18 measured development tasks;
B2/B3 see the same18 public inputs and measured Fast rows only.

B3 removes explicit Slow measurements, decisions and derived status from both
same-run history and warm context. Parent/history selection and computed quotas
remain declared indirect effects. The inspector binds original Journal feedback,
projected input, complete candidate identities, operator slots and warm digests.
It requires actual prior-candidate Slow consumption in B2 before declaring the
mechanism active. Fixture activation still never sets `realAblationActivated`.

Use `--search-profile legacy-v1` to compose the previous one-candidate profile
(CNY7.60/28 requests). Its ModelGenerator behavior and the fact entry remain
available. This is a historical composition, not a claim that current source
hashes reproduce the original freeze. Never pool v1 and v2 results.

For warm start, add `--warm-start-config /absolute/path/to/warm.json`
and `--journal-root /absolute/path/to/existing/native-journal` to a new v2 run.
The JSON follows the existing native schema, for example:

```json
{"runIds":["SOURCE_RUN_ID"],"maxRecords":6,"maxContextBytes":8192,"fixturePolicy":"exclude"}
```

Read source IDs from `result.json`. Keep the same original `--target` path;
the entry freezes it and saves a separate snapshot without editing it. History
is screened by the existing Journal compatibility rules. Empty/incompatible
history becomes a reported cold start. To test with engineering artifacts,
explicitly use `fixturePolicy: "ideas_only"`; these records carry no historical
scores. Inspect each `run-plan.json`'s `warmStart.mode`, selected records,
omission reasons and `finalDataReview`. The protocol's warm flag means configured,
not successfully selected. Baseline is measured afresh; no historical costs,
permissions or budget are imported. Each new study requires its own allocation.
Reused history does not establish an independent final, even with a new data ID.

Fast/Slow still use the same unittest family. More Slow tasks do not establish
higher fidelity, and the previous real Slow baseline saturated at12/12. V2 records
`slowHigherFidelity: NOT_ESTABLISHED`; this repair changes neither scoring nor
promotion thresholds and does not promise that real feedback will activate.

Live preparation takes `--mode prepare-live`, a matching `--benchmark-pack`,
the original `--target` and fresh `--pricing`. It requires completed G0
measurement qualification; unqualified packs are refused before output.
Qualification must come from task-contract acceptance, not editing a manifest
label to bypass it. The accepted prior pack is `benchmark-v24-qualified` under
the code-method Goal. After qualification, G2
must inspect and freeze the real task/plan and exact allowance, including all
private pack files in both child and aggregate manifests. This live preparation
and real code comparison passed for the historical v1 package; v2 has local
engineering evidence only. Execute uses the existing sealed
authorization check; no implicit allocation, retries, deployment or Caller.

Source: [BigCodeBench](https://huggingface.co/datasets/bigcode/bigcodebench),
split `v0.1.4`, HF revision `b74c0d0bf70d2c0bc459be537895cca163007f1a`,
Apache-2.0. The frozen source has 1,140 rows. Raw API pages, revision headers,
content hashes and the failed release-asset fetch are preserved under `upstream/`.

Selection uses fixed SHA256 ordering and documented environment requirements,
not model scores. Previously inspected/control IDs 0–19 and unsupported library,
network, process or thread capabilities are excluded. Fast has 6 tasks, Slow 12,
and final 18, with disjoint IDs and inputs. `manifest.json` records all exclusions.
Rebuild with `scripts/prepare_code_benchmark.py --source <frozen-jsonl> --output <new-dir>`.
This is a restricted subset; do not label its score a full official leaderboard
result or claim public tasks are absent from model training.

Primary metric: `task_pass_rate`, the fraction of PLANNED tasks passing EVERY
original unittest. Diagnostic `test_pass_rate` averages the within-task fractions;
it does not replace the primary objective. Syntax, format, timeouts, per-test
failures and wall time remain separate. Final only runs at a preregistered
confirmation point; do not feed its results back into optimization.

Versions: evaluator v1 exposed a unittest failure-rendering timeout; v2 bounds
dictionary failure messages without changing the type/equality predicates; v3
registers the executed module so original `unittest.mock.patch(__name__ + ...)`
works. No benchmark assertions were removed. Dataset v1 admitted a threading task
the sandbox cannot support; v2 applies a general capability filter and retains
the original rejected split and reference failure.

## Real-file hash contract revision (evaluator 7)

Task565's original mocks reject a valid streamed `hexdigest()` implementation:
it passes 3/5 original tests while both it and the reference pass six real-file
behavior checks. Constant hashes and skipping the library load fail the new
checks. These are measurement controls, not optimization gains.

`--test-suite dev-contract-v4 --prompt-format complete` creates
`code-readiness-v7-dev-contract4`, evaluator `7`. It replaces only task565's
tests; the previous tests are archived verbatim as `original_test` in its private
answer-key row. Public prompts, reference implementations, split membership and
all other tests including final stay unchanged from v6. Older suite outputs and
results remain separate. For v7 the primary metric counts all **registered tests
in that version**, rather than claiming that every original mock still runs.

The fixture in `scripts/fixtures/code-library-v1.json` contains a tiny shared
library built from the included C source with the existing compiler. Its bytes,
source and test template are hash-bound at preparation; no compiler is needed
at evaluation time. The library loads only inside the existing namespace
worker. Tests cover file bytes, printed hashes, returned name, explicit relative
paths, a filename containing spaces, invalid/missing libraries, and the exact
published `libc.so.6` example. Linux x86_64 is an explicit pack requirement;
incompatible platforms return an environment refusal with no candidate score.

```bash
python3 scripts/prepare_code_benchmark.py --source runs/code-benchmark-readiness-20260911/upstream/BigCodeBench-v0.1.4.jsonl --output /tmp/duo-code-file-hash-new --prompt-format complete --test-suite dev-contract-v4
```

Use this pack with the existing `run_code_model.py --benchmark-pack` or local
evaluation entry. Other contract gaps still prevent full measurement
qualification and live comparison preparation. The repair does not establish
Windows DLL support, exhaustive loader behavior or resistance to malicious
judge tampering. New real baseline, final and method effects remain unmeasured.

## Runtime and evidence limits

Requires existing Linux `unshare`, mount, system Python 3 and libseccomp. The
worker uses user/mount/network/PID namespaces, a disposable chroot with read-only
runtime libraries, drops namespace capabilities and blocks network/process
creation. It has a 6-second parent wall limit per task, 10-second CPU backstop,
256 MiB address-space limit, 32 MiB temporary filesystem, 1 MiB file limit and
64 descriptors. There is no unsandboxed fallback. Changing these conditions
requires a separately identified evaluation version/experiment.

Tests cover selected containment failures, not an independent security audit.
Candidate code and Python unittest assertions share a worker process, as in many
code benchmarks; resistance to deliberate evaluator tampering is NOT established.
Runtime speed, cross-language support and parallel/network tasks are not measured.

Provider API expense is CNY 0 for local evaluation; local CPU time is recorded
but unpriced. Do not advertise zero total compute cost. A future experiment must
include Caller, generation, model execution, evaluation and failed attempts in
its total CNY accounting. The previous CNY10 batch remains unchanged and scoped
to its recorded authorization; this local readiness work issues no paid requests.

## Copy postcondition revision (evaluator 8)

Task665's original five tests accept programs that produce empty copies, return
`None`, or alter the source after copying. Two additional public-contract checks
reject those programs while accepting both `copy2` and `copyfile` implementations.
`--test-suite dev-contract-v5 --prompt-format complete` creates
`code-readiness-v8-dev-contract5` / evaluator `8`. Only task665 gains assertions;
all version7 tests and its archived565 mocks, public inputs, references and final
remain unchanged. Prepare it with the same command above, changing the suite and
using a new output path, then pass it to the existing native code entry.

This checks bytes, source preservation and the destination return string on the
ordinary flat-file domain; it does not add recursion, file metadata preservation,
or new failure semantics. It remains a partial development instrument repair,
with no new real model baseline or method advantage measured.

## Real-path disk usage revision (evaluator 9)

Task973's original `shutil.disk_usage` mocks reject a valid `statvfs` alternative
(3/7), while both it and the reference pass five real absolute-path checks.
A separate execution of the public `Docs/src` example exposes a reference bug:
it verifies the relative path exists, then incorrectly queries `/Docs`.

`--test-suite dev-contract-v6 --prompt-format complete` creates
`code-readiness-v9-dev-contract6` / evaluator `9`. It replaces only task973's
tests with six real-path checks and corrects the reference's unconditional root
prefix. The original tests and reference are archived as `original_test` and
`original_canonical_solution`; the manifest binds both old and new identities.
All public inputs, other tasks, prior repairs and final stay unchanged since v8.
Use the same preparation/native code commands with this suite and a new output.

The control domain covers absolute and public relative slash paths, trailing
slashes, missing paths, invalid inputs and empty components. Zero usage values,
missing intermediate components and silently dropping empty components are
rejected. Non-slash delimiters, root-only paths, cross-mount variation and
simultaneous disk usage changes are not qualified by these finite controls.
The full development instrument remains partially qualified; no real baseline
or method effect is established by the reference/fixture run.

## Defaultdict return revision (evaluator 10)

Task931 explicitly returns a `defaultdict` with integer-zero defaults in its
public examples. Original equality-only tests accept a plain `dict` or a
`defaultdict` whose missing values are lists. Predeclared controls reproduce
both gaps, while the reference and an equivalent `lambda: 0` factory pass.
`--test-suite dev-contract-v7 --prompt-format complete` creates
`code-readiness-v10-dev-contract7` / evaluator `10` and appends two checks only
to931. The checks require the documented subtype and missing-value behavior;
they do not require the factory callable to be the literal `int` object.
All previous registered tests, archives, public inputs, references and final
remain unchanged since v9. Use the same preparation/native code commands with
this suite and a new output. Unicode sanitization remains a declared coverage
limit; these controls establish no real model improvement or whole-instrument
qualification.

## Real JSON file revision (evaluator 11)

Task412's correct `Path.read_text()` implementation passed all seven real-file
checks but only two of the seven old mock-dependent tests. The reference passes
both suites. Omitting NFC passes six real checks; decoding as Latin-1 passes five.
These are predeclared functionality controls, not optimization improvements.

`--test-suite dev-contract-v8 --prompt-format complete` creates
`code-readiness-v11-dev-contract8` / evaluator `11`. It replaces only task412's
seven tests with seven real-file checks, retaining the existing UTF-8/NFC and
error-class requirements. The old combined tests are archived as `original_test`;
the earlier NFC addition metadata is archived under `supersededTestAdditions`
and removed from the list of active additions. The replacement itself checks NFC.
All public inputs, references, other tasks and final stay unchanged since v10.

The revised pack accepts equivalent reading APIs. It does not establish a new
strict-base64, invalid-UTF8 or malformed-value policy, qualify the entire benchmark,
or establish real model improvement. Controls and acceptance receipts are under
`runs/code-method-goal-20260912/412-*` and `checkpoint8-*`.

## Move preservation revision (evaluator 12)

Task756's prior tests accepted three wrong programs: corrupted JPG bytes, removal
of unselected source files, and a RuntimeError instead of the documented ValueError.
Each passes the prior seven checks but fails one of two predeclared behavior checks.
The reference and a Path.rename alternative pass both behavior checks.

`--test-suite dev-contract-v9 --prompt-format complete` creates
`code-readiness-v12-dev-contract9` / evaluator `12`, appending those two checks
to task756. All previous tests and archives remain; public inputs, references,
other tasks and final are unchanged. The active addition metadata includes the
original source-removal check plus the new assertions and their combined hash.
The qualified control domain is flat ordinary files without destination collisions
on the namespace filesystem. This adds no recursive, cross-filesystem or overwrite
policy and is not a new real baseline or complete benchmark qualification.
See `756-control-result.json` and `checkpoint9-acceptance.json` in the Goal run directory.

## Five behavior repairs (evaluator 13)

The remaining five reviewed tasks had concrete missed behavior. Wrong programs
deduplicated repeated letters (911), returned the first menu item (769), read
non-JSON files (288), deduplicated combination inputs (358), or wrote corrupt
Latin-1 archive members (762). Each passed its old five tests. Predeclared behavior
checks reject each wrong program while accepting the reference and an alternative.

`--test-suite dev-contract-v10 --prompt-format complete` creates
`code-readiness-v13-dev-contract10` / evaluator `13`. Six assertions are appended
across these five tasks; all old tests, complete public inputs, references, other
tasks, archives and final remain unchanged since v12. Task358 also checks the
already documented invalid-JSON/missing-key exception requirement.

This introduces no general tie-breaking rule, empty-menu behavior, malformed-JSON
file policy, or ZIP member path convention. It is finite functional qualification,
not an official leaderboard score, real model baseline or optimization benefit.
Control plan, actual outputs and production receipts are in the Goal run directory
as `remaining-five-control-*`, `remaining-five-controls/`, and `checkpoint10-*`.

## Salt API and basket structure (evaluator 14)

A correct `from os import urandom as random_bytes` implementation passes the
public salt behavior but fails the old `os.urandom` mock call counter.
`--test-suite dev-contract-v11 --prompt-format complete` creates input
`code-readiness-v14-dev-contract11` / evaluator `14`. Only that method becomes
a returned-byte-size check; every other salt method remains unchanged, including
the unresolved escaped-hex requirement. The prior combined tests and salt-addition
metadata are archived. SHA256(data + salt) and fresh-salt checks remain active.

Task861 appends checks for the public Counter type and one basket per input,
including empty baskets. Correct local Random.choices is accepted; plain dicts
and omitted empty baskets fail. An always-apple implementation still passes: this
is retained evidence that structural checks do not establish random sampling.
No distribution, seed or statistical threshold was silently added.

One initial salt control mixed alias-import and plain-only format changes, scoring
5/7 rather than the planned6/7. Its failed expectation remains in
`salt-basket-control-result.json`. A separate direct-os.urandom control isolates
the undocumented escaped-format check (6/7 current,3/3 public behavior).
`pending-contract-decisions.json` records the six unresolved owner decisions.
There is no new model baseline, statistical randomness claim or optimization benefit.

## Explicit delimiter check (evaluator 15)

Task973 exposes a `delimiter` parameter. An implementation that always overwrites
it with `/` passed all six current tests. The reference and a statvfs alternative
pass the separate underscore-path control; the ignored-argument program fails.
`--test-suite dev-contract-v12 --prompt-format complete` creates input
`code-readiness-v15-dev-contract12` / evaluator `15`, appending this one check.
All prior tests, references, archives, public inputs, other rows and final remain.

The remaining boundary probes revealed actual unannounced menu tie and ZIP prefix
requirements. ASCII/Unicode alternatives both pass current pair tests while giving
different answers; their two contradictory hypothesis probes are deliberately not
quality scores. Nine public-contract decisions remain pending. The delimiter fix
does not choose any of them or establish whole-instrument qualification.
See `public-boundary-control-plan/result.json` and `checkpoint12-acceptance.json`.


## Owner-selected contracts (evaluator 24)

`--prompt-format complete --test-suite dev-contract-v21` prepares the nine owner-approved development revisions. Earlier suites remain reproducible. This generation command alone does not grant measurement qualification or paid authority. The accepted bounded qualification, positive/negative controls, unchanged-final audit and ready-to-run frozen package are linked in [checkpoint13](runs/code-method-goal-20260912/CHECKPOINT13_REPORT.zh.md) and [the runbook](runs/code-method-goal-20260912/real-package-v1/RUNBOOK.zh.md). Use the accepted `benchmark-v24-qualified` pack for this experiment; never relabel a different pack qualified.

The new references and behavioral checks cover recursive moves, CSV first-column/custom regex, observable sorted insertion, repeatable backups, explicit hex/tie/ZIP/alphabet rules, and a preregistered finite basket marginal-distribution check. Prior reviewed fields are archived in `owner_contract_original`. Reference/control results are engineering evidence, not model optimization or official leaderboard results.


## Preparing another final after earlier results were viewed

The public [new-final entry](examples/native/code-final.md) preserves qualified development data and derives 18 new final tasks using pinned source, recorded exposure and a preregistered hash order. Its data/provenance checks are local; model execution remains separately frozen and budgeted. The [current readiness receipt](runs/code-measurement-readiness-20260912/final-readiness.json) records 18 reference and 18 wrong-program controls, with no model final or optimization gain.
