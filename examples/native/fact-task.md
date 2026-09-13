# Fact extraction and source support

This is a synthetic task with real deterministic measurement. It is not business
validation, an LLM judge, or an evaluator returning preset candidate scores.
Keep the existing persona target unchanged. Data has 5 Fast, 10 Slow and 10 final
cases: approved versions, unit conversion, effective dates, unresolved conflicts,
and absent facts. Document groups and source identifiers are disjoint. Construction
rules are shared across splits, so this is within-family transfer only.

Use the existing cached DSH resolution for local preparation; no install occurs:

```sh
DUO_DSH_PACKAGE=/path/to/existing/node_modules/@deepseek-ai/dsh node --loader ./scripts/dsh_native_loader.mjs examples/native/fact-task.js --output /authorized/new-fact-task
```

This creates `dataset.json`, `answerKey.json`, and `manifest.json`. The dataset
contains task inputs and response instructions, with no `expected` answers.
Only the evaluator receives the separate answer-key path. Generation receives
Fast development inputs through the existing native generator projection. Final
inputs/keys and final feedback must not enter search, historical context, or
Caller task selection. Freeze inputs before real execution and audit these paths;
different data IDs alone do not prove independence.

The primary metric is `supported_accuracy`: each planned task earns 1 only when
the fact/abstention is correct AND the cited source/line set supports it.
`fact_accuracy` separately reports content correctness. `format_valid` is a hard
constraint, not the content score. A wrong, missing or malformed answer earns 0
in a fixed planned-task denominator; execution/receipt identity failures remain
failures. kg/t/g quantities normalize to kg with an absolute tolerance of 1e-8 kg;
dates use exact ISO strings; unsupported/contradictory facts require the explicit
abstention token and all keyed evidence spans. No weights are fitted to results.

Measurement version 2 accepts a quantity such as `1.5 t` with `unit: "t"`, as
well as a bare numeric string with its separate unit. Conflicting suffixes and
wrong magnitudes still fail. Version 1 incorrectly rejected matching suffixes;
retain its results and identify any remeasurement separately. Dataset/key schema
version 1 is unchanged. Nonquantity answers still require `unit: null`; a failure
of this convention is not evidence that the model selected the wrong source fact.

Slow adds twice as many development document groups and cases per error class.
It uses the same free deterministic evaluator; it is not artificially made costly.
Model execution over those extra tasks still incurs actual tokens, latency and
fees. Deterministic measurement has no model request and CNY0 callback cost.

Place `fact-evaluator.js` and `fact-task.js` together in an authorized isolated
DSH profile, with the existing local DUO package available. Bind the evaluator
through the existing Cordis patch interface:

```yaml
- insert:
  - id: fact-evaluator
    name: ./fact-evaluator.js
    config:
      datasetPath: /authorized/new-fact-task/dataset.json
      answerKeyPath: /authorized/new-fact-task/answerKey.json
```

Objectives reference `fact-support-fast`, `fact-support-slow`, and
`fact-support-final`, measurement version `2`, the matching dataset split ID, metric
`supported_accuracy`, direction `maximize`, and weights `{supported_accuracy: 1}`.
Use the existing ModelExecutor with **dataset.json only**. Select the existing
evaluation-only composition to measure without a generator. After binding, call
`dualloop_design` with `context.measurementGoal: task_result`, then inspect
`dualloop_plan` and execute its exact digest within the current authorization.
`@dual-loop/dsh-plugin/contract` exports `digest` for the native canonical identity;
providers need not copy hashing rules or import private storage paths.

Local control entry:

```sh
DUO_DSH_PACKAGE=/path/to/existing/node_modules/@deepseek-ai/dsh node --loader ./scripts/dsh_native_loader.mjs --test dsh-plugin/native/fact-task.test.js dsh-plugin/native/fact-evaluator.test.js
```

The public-tool controls run controlled outputs through real Cordis services,
the evaluation-only controller, evaluator, SQLite Journal and report tools. They
are zero-request engineering tests. Correct answers score 1; one wrong fact or
one allowed-but-unsupported citation scores .8 with identical valid format;
malformed output scores 0; a missing task stays in the denominator. These numbers
are measurement controls, never an optimization benefit. Baseline headroom and
real model use remain separate live acceptance.
