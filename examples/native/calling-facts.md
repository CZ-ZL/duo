# Clean Caller smoke with a supplied fact evaluator

This is the complete-input starting point: an authorized existing persona, a
frozen Fast-only evaluation contract, and the supplied deterministic fact/support
measurement. The Caller independently attaches the evaluator via DSH Cordis tools,
inspects the native plan, runs it, and explains a report. The host does not attach
`duoEvaluators` or invoke optimization for the Caller. It supplies public resources
and enforces the declared allowance. No file editing tools are needed in this
profile; incomplete-input preparation remains in the separate onboarding example.

Prerequisites: the current local package, an existing cached DSH, a persona you
can read, and a frozen [fact task/key](fact-task.md). The contract must use
`operation:"evaluate"`, Fast `fact-support-fast` version `2`, its matching data ID,
no Slow/final, zero generations/quotas/topK, CNY.10 inner limit and one Fast
execution. Use at least two inner operations for execution and deterministic
measurement. Permissions must explicitly match the chosen offline/live mode.
The supplied target is read without modification. Nothing generates or selects a
benchmark or weakens the persona in this entry.

```sh
python3 scripts/run_duo_caller.py --mode offline \
  --dsh-package /existing/node_modules/@deepseek-ai/dsh \
  --contract /authorized/evaluate.json \
  --dataset /authorized/facts/dataset.json \
  --answer-key /authorized/facts/answerKey.json \
  --output /authorized/new-caller-control
```

Offline uses scripted responses, actual DSH services, actual keyed measurement
and synthetic usage/fees. It verifies attachment and delivery mechanics only.
For live preparation use `--mode prepare-live --pricing /authorized/current-cny.json`
and a new output directory with explicit paid/network permission. Preparation
makes zero requests and writes a sealed manifest and authorization template.
Execution reuses the existing launcher:

```sh
python3 scripts/run_duo_caller.py --mode execute \
  --output /authorized/prepared-caller \
  --authorization /authorized/bound-approval.json
```

A template is not permission. Bind current user authorization and batch remainder,
manifest/plan digests, current official tariff and all nested request fees before
executing. Old batches do not fund this example. No automatic retries occur.
The current default envelope is at most7 Caller requests (53248 input bytes,
1536 output tokens, CNY.128 reservation each) and1 inner evaluation request
(CNY.10). Caller CNY.90 and inner CNY.10 cannot transfer; total cap CNY1. This
requires fresh prices to cover both envelopes. The request cap is an additional ceiling: if its maximum multiplied by the
reservation exceeds the role limit, monetary admission can stop earlier. It never
promises completion or spends the inner allowance. Fewer permitted Caller requests
are available for explicit exhaustion controls, not live quota renewal.

Retained artifacts include `tool-calls.json`, every request input/usage receipt,
Caller session events, the native Journal, `result.json`, `total-budget.json`,
`total-cost-receipts.json`, and deterministic per-run report JSON/text plus
`delivery-receipt.json`. The report is also exported when a Caller cannot spend
another request. Export does not satisfy the separate Caller-read/interpretation
checks. Native inner cost and the total request ledger overlap; do not add them.

The actual evaluator resource is [fact-evaluator-resource.js](fact-evaluator-resource.js).
It isolates and reuses [fact-evaluator.js](fact-evaluator.js), publishes its public
service contract/bridge, and keeps the dataset/key private. Only the Caller binds
that supplied bridge. This smoke does not test generating a new adapter, warm
start, optimization benefit, final quality, or real business deployment. Those
retain their own evidence and acceptance conditions.
