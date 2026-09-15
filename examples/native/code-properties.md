# Bounded deterministic Slow evaluator

Version `25-properties-v1` adds executable development checks for
BigCodeBench/358 and412 through the existing caller-owned
`scripts/research/dsh_code_evaluator.js` plugin and isolated Python worker. It changes no
DSH/DUO core or scoring rule. Each task still passes only if every registered
test passes. Scores from this version must not be pooled with evaluator24.

C1 qualification and native acceptance are recorded at
`runs/c1-deterministic-slow-20260913/`. Both source references and independent
legal alternatives pass. Two fixed errors pass all7previous tests per task but
fail the additional checks: returning `[]` for zero-length combinations, and
using Unicode NFKC in place of NFC. This is measured incremental discrimination
on two development tasks, not optimizer improvement or an all-input oracle.

The combinatorics addition covers668fixed array/r cases using independent index
subsets and translation by7 (1336test methods). The NFC addition covers14fixed
strings under4transformations, using literal expected compositions (56methods).
Existing tests remain. Failures include actual test identities and namespace
receipts. The finite corpus is evaluator-private development data, not final.

From `dualloop/`, with the existing cached DSH installation:

```bash
python3 scripts/research/prepare_code_properties.py --source-pack runs/code-method-goal-20260912/benchmark-v24-qualified --output /tmp/duo-properties-new
python3 scripts/research/prepare_code_properties.py --qualify-pack /tmp/duo-properties-new --output /tmp/duo-properties-check-new
python3 scripts/research/verify_code_benchmark.py --calibration-pack /tmp/duo-properties-new --dsh-package "$DUO_DSH_PACKAGE" --output /tmp/duo-properties-native-new
```

Each output directory must be new. Preparation validates the pinned source
manifest and copies only the six existing Fast tasks and the two chosen Slow
tasks into the production pack. No final split is created. The separate
`baseline-pack` and `calibration-pack` intentionally repeat fixed specimens
across tiers to verify wiring; never use those calibration splits as independent
search/final data or formal comparison data. Frozen identity drift fails before
execution. Local API expense is zero; CPU usage is measured but not priced.

The public host executes discover, plan, run, status, budget and report, checks
all six fixed groups in both Fast and Slow, and confirms repeated terminal runs
reuse artifacts. Its Executor is a declared control carrier. The candidate
programs really execute in the existing isolated worker. This establishes a
native plugin path, not independent Calling Agent or real-model optimization.

To attach the production measurement to a caller-owned native profile, use the
existing code evaluator entry, stage its Python adapter and worker alongside it,
and configure the production pack (omit `controlsPath`):

```yaml
- insert:
  - id: code-evaluator
    name: ./dsh_code_evaluator.js
    config:
      pack: /absolute/duo-properties-pack
      artifactRoot: /absolute/duo-evaluation-receipts
```

It registers `code-unittest-fast` and `code-unittest-slow`, version
`25-properties-v1`. The Slow data ID is `code-properties-slow-v1`; the production
Fast data ID is retained from the source. Use `task_pass_rate` as the existing
ranking metric; `test_pass_rate` remains diagnostic. The code answers must match
the task set of the requested tier. Keep one owner for `duoEvaluators` in scope.

The four-arm public entry supports an explicit `properties-structured-v3`
profile. Bind the accepted production pack and the already selected final pack
before preparing the study:

```bash
python3 scripts/research/prepare_code_property_study.py --properties runs/c1-deterministic-slow-20260913/pack --c1-acceptance runs/c1-deterministic-slow-20260913/acceptance.json --final-pack runs/code-measurement-readiness-20260912/new-final-pack --final-readiness runs/code-measurement-readiness-20260912/final-readiness.json --output /tmp/duo-property-study-new
python3 scripts/research/run_code_comparison.py --mode prepare-live --benchmark-pack /tmp/duo-property-study-new --target /absolute/original-persona.txt --search-profile properties-structured-v3 --pricing /absolute/current-cny-pricing.json --dsh-package /absolute/existing-dsh-package --output /tmp/duo-property-comparison-new
```

Preparation makes no model requests. It rejects changed qualification sources,
changed final data and unqualified packs. This profile keeps six Fast tasks,
the two qualified Slow tasks and the same eighteen final tasks. B1 receives all
eight development tasks and their complete executable tests at every Fast
measurement. B2 and B3 use the same measurements and promotion rule; only
explicit Slow evidence is removed from B3's generator input. All three search
arms plan three generations of three candidates. They start from the same
original persona without imported history. Existing profiles remain separate.

To keep thousands of check details inside the model input limit, this profile
retains all candidate history and measured task rows, but projects only the first
two failed test details per task (error text at most160characters). Scores and
passed/planned test counts are unchanged. Full receipts remain in the Journal's
linked execution artifacts. The projection version and its limit are recorded.

The finite live envelope is B0:1request/CNY0.4, B1:15/CNY2.8,
B2:19/CNY2.8, B3:19/CNY2.8; total54requests/CNY8.8. Each request reserves
CNY0.3. Verify the actual frozen plans, current tariff, execution window and
unspent parent allocation before execution; these configured caps are not
spending authorization. Follow the generated authorization template and execute
through `run_code_comparison.py --mode execute --output ... --authorization ...`.
No automatic replay is permitted. An explicit contract is required for the
native runner's larger19request cap; its default cap remains unchanged.

`--mode inspect` checks all planned generations against actual generator inputs.
It reports which later generations consumed candidate Slow evidence, checks B3
removal throughout, and reports distributions, promotions, measured evaluation
work, costs, failures and rejections. Promotion precision is not identifiable
when the fixed final policy covers only a subset of promoted candidates; missing
measurements are never treated as zero. Offline fixture runs establish wiring,
not model benefit. A real run must independently establish active treatment and
final isolation. Candidate tampering with its in-worker tests, general semantic
fidelity, benefit and cost effectiveness remain unproven. This document grants
no paid calls, deployment or new reviewer prompt tuning.
