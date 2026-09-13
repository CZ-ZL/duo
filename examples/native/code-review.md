# Public code-contract reviewer

Current C1 decision (2026-09-13): **NOT_QUALIFIED; model-reviewer tuning terminated**.
The last frozen run changed only the output cap from4096to8192. The model ended
normally but omitted task130 from the first known-good group; the existing exact
task-set rule rejected the response. One request cost CNY0.0274815, with no retry.
All five earlier request receipts and their costs are preserved (one v3 control
was valid, but no earlier full calibration passed). Historical replay instructions
below are retained for reproducibility, not authorization for more tuning.
See `runs/c1-final-calibration-20260913/model-reviewer-verdict.json` and the
[qualified bounded deterministic alternative](code-properties.md).

`code-contract-review.js` is a caller-owned native `EvaluatorsService` plugin.
It reviews the public task contract and the actual Executor's Python artifact,
using the existing DSH Agent and model-accounting services. It records explicit
pass/fail/uncertain rows, quoted contract/code evidence and CNY usage receipts.
Private tests, reference solutions, other candidates and previous scores are
excluded from the request. No tools or automatic retries are enabled.

Reviewer version `3` and policy `python-public-contract-review-v3` send an
`outputContract` in the actual model request. Its field set, verdicts, nonblank
fields, 600-character reason/quote bounds, 1000-character counterexample bound,
and quote-source mapping are also used by the validator. Lengths use UTF-16
code units after JSON decoding. This makes previously implicit field limits
visible without changing their values or the exact-quote acceptance rule.
The v1/v2 real replies remain rejected in offline replay. The first real v3 control was valid; the second stopped on missing fields and
contained two raw false-pass verdicts for known faults. Full qualification has
not passed. See `runs/code-review-v3-preparation-20260912/REPORT.zh.md`; this
reviewer remains unqualified for a new combined optimization objective.

This is a separate measurement mechanism, **not a qualified higher-fidelity
replacement** for the current unit evaluator. The existing code comparison keeps
its scoring and promotion rules. A model name or an offline fixture pass does not
establish reviewer quality. Final is excluded from this adapter.

## Calibrate through the public DSH entry

From `dualloop/`, first create and verify the fixed development controls:

```bash
python3 scripts/prepare_code_review_controls.py --benchmark-pack runs/code-method-goal-20260912/benchmark-v24-qualified --output /tmp/duo-review-controls-new
python3 scripts/prepare_code_review_controls.py --benchmark-pack runs/code-method-goal-20260912/benchmark-v24-qualified --verify-controls /tmp/duo-review-controls-new --output /tmp/duo-review-execution-new
python3 scripts/run_code_review.py --mode offline --controls /tmp/duo-review-controls-new --dsh-package "$DUO_DSH_PACKAGE" --output /tmp/duo-review-host-new
```

Every output directory must be new. These four batches use three fixed existing
development tasks: positional combinations, Unicode NFC and data/salt hash order.
Two legal implementations and two erroneous implementations, including a code
comment that tries to influence the reviewer, have predeclared labels. Local
Python execution checks the labels against the registered development tests.
This bounded check is not an all-input correctness oracle.

The offline host uses predefined model replies. It actually loads the native
control wrapper, performs public plan/run/status/budget/report operations and
retains the Journal and session receipts. Controlled artifacts are explicitly
marked calibration specimens; this is not a fresh Target execution or an
independent Calling Agent. `--fixture-scenario constant`, `uncertain`, or
`missing-usage` or `invalid-quote` exercises refusal/stopping. A completed host may still fail
qualification; the wrapper then returns a nonzero exit code.

Outputs include `qualification.json`, a readable `qualification.txt`, `run/result.json`, `run/journal.json`,
`run/sessions/`, `run/judgments/` and all actual model request inputs.
`engineeringControlsPassed` and `realControlsPassed` are separate fields.
`reviewDiagnostics` identifies the control, reviewer version, failing task,
field, rule and retained judgment path. These diagnostics also reach the native
evaluation evidence, Journal and product JSON report. Invalid rows remain
unusable for ranking; the evaluator does not salvage a partial score or retry.

`--mode prepare-live --pricing /absolute/current-cny-pricing.json --judge-model
deepseek-v4-pro` freezes a live package without making requests. Its tariff must
bind that exact model and the current UTC date. The plan allows four total
requests, CNY0.30 reservation each, CNY1.20 total, no retries or optimization.
Execution uses existing `scripts/run_dsh_model.py --mode execute --output
/absolute/review-output/run --authorization /absolute/approved-allocation.json`.
The authorization must bind the prepared plan and manifest and cover this
purpose within the current parent ledger. Preparation itself grants no spending.

The preparation protocol is version `5`; reviewer, policy and strict output
validation remain version `3`. `--judge-thinking enabled` selects the existing
DeepSeek thinking mode in this isolated profile. `--judge-max-tokens 4096`
sets the total output cap including reasoning. Defaults remain disabled/2048.
Both settings are recorded in `protocol.json` and bound into the actual composed
provider and the native reviewer plan. Defaults remain CNY0.30 per request/CNY1.20 total. The explicit
`--judge-reservation-cny` option accepts a finite positive amount and derives
the four-request total; it does not grant paid authority. The last8192 run froze
CNY0.45 per request/CNY1.80 total. A cap that exceeds its reservation is refused
before output preparation. Provider configuration retains
the API-key environment reference and zero retries. No user profile is edited.

Changing thinking and the output cap tests that explicit configuration; it does
not demonstrate the cause of earlier misjudgments or qualify the reviewer.
Reused controls remain instrument-development evidence. A different configuration
must have a new frozen run and allocation; prior stopped slots are not reused.

The real enabled/4096 calibration stopped on its first request at the total
output cap: 3894 of 4096 output tokens were reasoning, and the final JSON was
incomplete. No quality score was accepted and the other three groups were not
run. This is evidence of truncation for this configuration, not an answer about
its error discrimination. Its receipt and settlement are in
`runs/code-measurement-readiness-20260912/`; no retries remain under that stopped
package. The subsequent final8192 attempt is now settled and unqualified,
as recorded above; tuning has ended.

After execution, inspect retained results with the same entry's `--mode inspect`,
`--output`, `--controls` and `--dsh-package` arguments. All four batches must match
the frozen labels with complete known usage. Unknown usage or uncertainty stops
the wrapper. Failing controls do not authorize changing labels or retries.
Even a real pass qualifies only these fixed specimens, not broad reliability,
optimization gain or prompt-injection robustness in general.

## Attach the component to a caller-owned profile

Copy `code-contract-review.js` into an existing DUO-capable native profile and
provide a frozen model settings JSON via `modelConfigPath`:

```yaml
- insert:
  - id: code-contract-review
    name: ./code-contract-review.js
    config:
      modelConfigPath: /absolute/reviewer-settings.json
```

The settings reuse the ordinary ModelExecutor accounting schema: `provider`,
`model`, `datasetPath`, `artifactRoot`, `currency: CNY`, current `pricing`,
`reservationCny`, `maxInputBytes`, `maxTokens` and `timeoutMs`. Add
`judgmentRoot`, `policyPath` pointing to `code-contract-review-policy.json`,
`evidenceKind: model`, and `tiers: [slow]`. The dataset must use
`responseMode: python-code-v1`. Data and artifact identities must match the
actual Executor; missing identity is rejected before a request. The plugin
requires existing `agents`, `llm`, `systemPrompt` and `tools` services.

The descriptor ID is `code-contract-review-slow`, version `3`. The calibration
wrapper is `code-review-controls`, version `3`, with contract ID
`code-review-calibration-v3`. Keep v1/v2/v3 measurements separate. The reviewer's
`contract_pass_rate` ranges from zero to one; `contract_fail_rate` and
`uncertain_rate` remain separate. Ranking requires `ok` and `review_complete`.
A valid all-fail review is a completed measurement; an uncertain or malformed
review is not a usable ranking measurement. Failed/malformed paid responses keep
their actual cost, and missing usage remains unknown.

Only one provider should own a given `duoEvaluators` service scope. For composing
with another evaluator, use existing Cordis isolation and public composition
mechanisms; `code-review-controls.js` demonstrates this for calibration. This
increment does not ship a combined unittest/reviewer optimization objective.
Qualify the reviewer and freeze a separate scoring/validation contract before
using it to select candidates. Do not pool such future results with the old run.
