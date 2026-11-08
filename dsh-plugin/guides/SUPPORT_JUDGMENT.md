# Optional support judgment in shadow mode

`/quick-judgment` exports `createSupportShadow({primary, judge, project,
projectionId})`. It composes one existing **Fast** `FunctionEvaluatorConfig`
with an optional source-support judgment. Load the returned configuration using
the existing `/function-evaluators` provider. This is an experimental diagnostic
composition, disabled on the default path; it is not a qualified fast model,
independent Slow evidence, or an automatic rejection rule.

The three labels mean: the supplied source supports the entire claim
(`supported`), explicitly contradicts it (`contradicted`), or establishes neither
(`insufficient_evidence`). Invalid output and provider failure are separate
execution statuses, never an `insufficient_evidence` answer. The implementation
does not depend on Jev or reproduce its model; only the narrow typed-judgment
idea is shared. No accuracy, latency or savings claim has been established.

The primary evaluator keeps its original metric values, evidence family and
coverage. Shadow rows are appended to `evidence` as `quick_support_shadow` with
`affectsSelection:false` and `qualification:NOT_QUALIFIED`. The default comparator
and feedback policy ignore those rows. Extra work still consumes time and budget
and can cause a safety stop; this is not a guarantee of identical run trajectories.
Custom callbacks and policies remain trusted code.

**Bring a judge:** supply `judge.descriptor` with `id`, `version`, `configDigest`,
`currency:'CNY'`, `reservationCny`, and explicit `paid`, `network`, and
`externalSideEffects` permission booleans. Its `judge({cases, signal, identity})`
returns `{status:'measured', judgments:[{id, verdict}], currency:'CNY', costCny,
costEvidence?, receiptPath?}`. A missing fee is unknown, not zero. For each call,
`project({candidate, artifact, tier})` must synchronously select 1–16 cases with
exactly `{id, source, claim}`, unique nonempty IDs, nonempty strings and a total
JSON size at most 65,536 bytes. Give the projection a versioned `projectionId`.
The judge receives these cases, not the entire candidate or artifact. Do not put
answer keys, final data or unrelated private inputs into the projection.
Optional descriptor booleans `requiresModel`, `deterministic` and `realTools`
describe the judge's actual behavior; omitted values remain unknown in the
combined source metadata.

**Existing DSH model backend:** `/support-judge` exports
`createModelSupportJudge(ctx, config)`, using the existing model-accounting
configuration (provider, model, datasetPath, artifactRoot, CNY tariff/reservation,
token/input-byte/time limits and evidenceKind). It uses one bounded native DSH
request for the batch, with no tools or automatic retries. `datasetPath` is required
by that existing configuration contract; the judgment prompt contains only the
projected cases. The backend has not been calibrated on real semantic judgments.
Calling these functions directly bypasses controller reservation; load them
through `FunctionEvaluators` for the normal planned and authorized run path.

**Optional public sample:** after preparing the [real task starter](../QUICKSTART.md#real-task-starter)
in a fresh working directory, advanced callers can opt into the shipped
[`shadow-evaluator.js`](../examples/model/shadow-evaluator.js) composition:

1. In the generated `dsh-home/profiles/duo-product/cordis.patch.yml`, replace the
   `starter-evaluator` row's name with
   `@dual-loop/dsh-plugin/examples/grounded-qa-shadow-evaluator`. Keep its existing
   model config; the sample uses the same model route for its optional judge.
2. In `experiment.json`, change `fast.evaluatorId` to
   `starter-runbook-fast-support-shadow` and `fast.version` to
   `2+support-shadow.1`. Keep the original metric, data ID and scoring rules.
3. Obtain authority covering the additional work **before running**. For this
   one-generation, one-candidate sample, the upper bound becomes **five inner
   model requests**: two executions, one generation and two shadow judgments
   (one batch per valid execution). The unmodified starter's three-request
   authority is insufficient. A conservative envelope is five times the declared
   per-model-call `reservationCny`; use the actually authorized total in
   `budget.maxCostCny`, with `permissions.paid` and `permissions.network` authorized.
   Keep `maxSessions:5` (native operations), `maxFastEvals:2`, no Slow/final and one
   candidate. Operation counts and nested model-request counts are distinct.
4. Repeat the guide's `describe → plan → run → report` commands and inspect a new
   plan. The descriptor now binds the primary and judge configuration. Never run
   the old plan or treat its stored three-request starter summary as current.

The wrapper ID is `<primary.id>-support-shadow`; its version is
`<primary.version>+support-shadow.1`. Inspect the full report's candidate Fast
evidence and the retained Journal/cost receipts for labels, input/source hashes,
judge version, execution latency and accounting. Primary and shadow fees settle
together; a missing fee stops as unknown and is never retried automatically.
Known invalid judgment output leaves the primary score intact. Existing
`FunctionEvaluators` may expose a callback refusal as `DUO_EVIDENCE_INVALID`;
`costEvidence.stopReason` retains the specific shadow safety-stop reason.
Do not merge this changed evaluator identity with old runs or treat shadow rows
as warm-start search feedback. The source-only sample never sends its expected
answers or final split to the judge, and never overwrites the original Target.

[Provider index](../PROVIDERS.md) · [Public tools](../AGENT_REFERENCE.md)
