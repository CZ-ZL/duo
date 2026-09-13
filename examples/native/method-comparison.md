# Fact-method preparation through existing native providers

These adapters prepare a method study. They do not establish efficacy, final-data
independence, or completed live ablation. Keep every frozen attempt and receipt.

The public plugin `method-feedback.js` supplies `duoFeedback` with
`{method: 'B1' | 'B2' | 'B3', datasetPath}`. Replace the existing `duo-feedback`
entry in an isolated profile; stage the module beside the profile. Use the existing
native contract, controller, model generator/executor and fact evaluator. Do not
attach a second feedback service alongside the first.

- B1 uses `singleLoopData(dataset, answerKey)` to combine the original Fast and
  Slow development cases into one Fast tier. The derived key is rebound to the
  derived dataset. Final documents and keys stay unchanged. Omit the Slow
  objective; retain independent final confirmation. Existing `fast_only` native
  search selects a `proxyLeaderId`; consult `independentFinal` afterward. The
  feedback reuses `HistoryFeedback` and adds every measured deterministic row,
  including failures. Missing rows are explicitly `NOT_PROVIDED`.
- B2 keeps conservative DUO feedback and its native Fast/Slow selection.
- B3 projects that same conservative feedback to computed quotas and Fast-only
  family averages. Slow scores, ranks, decisions, family failure counts,
  correlations, failed-region summaries and champion lineage are omitted.
  Parent selection and quota calculation remain identical indirect Slow effects;
  this is an explicit-content ablation, not removal of every Slow influence.

All three receive the same public union of development questions and source
documents, once per generation. They receive no final documents or answer keys
through this adapter. Candidate models already run with no tools; keep that
restriction and cold isolated Journals. Do not enable warm start in this study.

Freeze the actual gate provider, objective, model parameters, budgets, data and
code before comparison. A bounded tie gate is an existing optional provider for
deeper measurement; enabling it is a declared policy choice, not the package's
strict default and not permission to adopt tied candidates. The local operation
control uses it only to ensure candidate Slow evidence exists before generation 2.

Run the offline operation controls from `dualloop/`, supplying an already cached
DSH package without installing dependencies:

```bash
DUO_DSH_PACKAGE=/path/to/cached/@deepseek-ai/dsh node \
  --loader ./scripts/dsh_native_loader.mjs --test \
  dsh-plugin/native/method-feedback.test.js
```

These exercise the real native controller, supplied deterministic fact evaluator
and DSH Agent request construction with scripted transport. They prove engineering
behavior only. A future live audit must match actual generation request feedback
digests to the Journal, show B2 consumed candidate Slow evidence and show B3 did
not. If generation 2 or candidate Slow never happens, report the ablation inactive.
Do not merge these controls or old pilot scores into formal method results.

The fixed eight-run entry is `scripts/run_fact_comparison.py`. It delegates each
arm to `run_dsh_model.py`; it does not implement a separate optimizer. For a new
output directory, run:

```bash
python3 scripts/run_fact_comparison.py --mode offline --output /tmp/fact-control \
  --dsh-package /path/to/cached/@deepseek-ai/dsh \
  --dataset /path/to/dataset.json --answer-key /path/to/answerKey.json \
  --target examples/native/persona.txt
```

`--mode prepare-live` takes the same arguments plus `--pricing` and freezes all
eight profiles before any model call. Review `comparison-protocol.json`, the
prepared manifests and current budget ledger, then complete the generated
authorization template within an existing user grant. `--mode execute --output
PREPARED_DIRECTORY --authorization ALLOCATION_FILE` consumes that allocation once.
`--mode inspect --output PREPARED_DIRECTORY` derives a report without model calls.
Never replay a claimed study or change its code, data, policy or pricing in place.

The fixed protocol has two independently initialized runs per method, a CNY6.8
study ceiling and at most62model requests, with no retries. Each search has the
same CNY.9 optimization ceiling and at most two generations; actual resource use
can differ. B0 has zero search. A shared neutral working directory keeps the
original persona's `{{cwd}}` rendering identical across arms. Profiles and run
identities remain isolated. Offline controls use a smaller token/input envelope
under the runner's synthetic tariff; they do not certify the live price envelope.

The report retains every candidate's Fast/Slow/final state and cost receipts,
checks persona/version against actual assembled executor requests, and matches
generator feedback digests to the native Journal. Unknown settlement stops the
study. Missing candidate Slow or generation2 leaves the ablation unverified.
Two repeats on synthetic facts support a bounded descriptive comparison, not a
statistical or business efficacy claim. Keep preparation and Caller costs beside
the study total when reporting the overall authorized batch.
