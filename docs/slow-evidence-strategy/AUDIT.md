# Factual responsibility audit — v0.5.0 baseline

Sources are current native code, not old benchmark conclusions.

```text
Contract + provider declarations → Controller.plan (bind/hash)
Target → Generator → Target.apply → Executor → Evaluators.evaluate
                                                ↓ scoped evidence
Comparator.compare (same evaluator/version/data/tier only)
  → Gate.select (budgeted next-stage admission)
  → Controller (terminal champion decision currently inline)
  → Journal → Feedback.summarize → next generation
Observer → recorded measurements, comparisons, costs and conservative limitations
```

| Responsibility | Actual implementation/public seam | Reuse / actual gap |
|---|---|---|
| Evidence production | EvaluatorsService / function-evaluators; Executor separate | Reuse. Descriptor has identity, metrics, family, some optional semantics. No canonical scope/latency/model/determinism/increment contract. |
| Aggregation | WeightedComparator.compare; exclusion-comparator replacement | Same-scope checks correctly prevent raw Fast/Slow score mixing. No automatic Slow weight or price-based credibility found. No cross-source judgment summary yet. |
| Acquisition / promotion | TopKGate.select / bounded-tie-gate; controller ordered stages | Gate chooses who enters next measurement; terminal selection inline in Controller. Baseline measures all configured stages. No gap-aware bounded evidence request contract. |
| Feedback | ConservativeFeedback / history-feedback | Existing allowed numeric observations and verdicts, no final/raw outputs. Reuse; add only safe strategy facts. |
| Plan / modes | resolveNativeContract, onboarding.design, NativeController.plan | Single-tier fast_only already works. Number of configured stages selects legacy mode optimize; no additional-information negotiation. |
| Result / report | controller, observer | Family difference explicitly NOT qualified; improvementProven false. Missing canonical optimization_mode/slow_mode/acquisition summary. |
| History | warm-start provider/condition/environment screening | Existing strict provenance/final/cost boundary; needs evidence-mode identity. |
| Defaults | bin/duo.mjs + local-providers | Same text-hygiene check repeated Fast/Slow, correctly disclaims efficacy but still runs unnecessary second stage. Change default to basic. |
| Language | stages.js schema/comments, type/docs | Ordered stages called increasing credibility/fidelity/cost without evidence. Remove that assumption while preserving legacy authored API. |

Confusion is primarily orchestration and terminology, not a hidden expensive-model weighting algorithm. Scores remain scoped summaries of evidence, not evidence quality. Reuse existing comparator, gate and feedback; no giant SlowAgent, provider registry, scheduler, model runtime or new budget ledger.

Compatibility decision: old contracts without a product preset retain their explicitly authored stage execution and old API fields. Their new semantics must label unqualified additional evidence as unavailable and disclose legacy measurement replay, never full dual-loop validation. New public presets enforce evidence negotiation and avoid duplicate acquisition. Old experiments and artifacts are not rewritten. This preserves promised legacy execution compatibility without certifying its fidelity.
