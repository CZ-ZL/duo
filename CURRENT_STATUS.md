# DUO 0.6.1 — current product support

DUO is a DSH-native component for bounded evaluation and optimization. The default bundle exposes preparation and waits for work providers; it does not wire a research fixture or authorize model spending.

This page is generated from native/capabilities.js and package.json. Run scripts/sync_product_docs.mjs after an intentional support change. Public discovery uses the same catalog. This build is a local release candidate until a matching delivery receipt exists. The source's docs/product-foundation/RELEASE_CLOSEOUT.md tracks its finite gate. PRODUCT_ACCEPTANCE.json and docs/slow-evidence-strategy/QUEUE.md retain prior sealed acceptance; historical experiments do not define current support.

| Target | Support | Mutable space | Warm start | Execution |
|---|---|---|---|---|
| dsh-persona | SUPPORTED | Complete isolated persona text; required placeholders preserved. | Adapter validation and safe Delta projection | matching_executor_required |
| dsh-plugin-config | PARTIAL | Only integer maxBodyChars in [50000,200000] for @deepseek-ai/dsh-web-fetch-http. | Adapter validation and safe Delta projection | matching_executor_required |

- **dsh-persona:** No original file writes or automatic deployment.
- **dsh-plugin-config:** Not arbitrary plugin configuration. Live fetch execution is an opt-in source research example; not a default runtime provider.

Custom targets use the existing TargetService and their own identity, validation and Delta projection. The active adapter advertises its targetKinds; adding a custom kind does not require a core edit. A legacy adapter without history hooks does not gain warm-start support.

Replaceable components: Target (duoTarget); Generator (duoGenerator); Executor (duoExecutor); Evaluator (duoEvaluators); Evidence comparison and aggregation (duoComparator); Evidence acquisition and promotion (duoGate); Feedback and history order (duoFeedback). Cordis owns registration, dependency injection and disposal. No new DUO registry/runtime is required.

Default public flow: describe → design (evaluate / optimize-basic / optimize-dual / optimize-auto preset) → save an inspected contract → plan → authorized run → status/report. Advanced use adds screened warm history or replaces a provider in the profile. See AGENT_GUIDE.md and examples/product/README.md in the package.

Slow modes: high_fidelity, expanded_evidence, unavailable. Read EVIDENCE_STRATEGY.md for negotiated information increment and actual acquisition receipts. No price/model-based fidelity inference or silent downgrade.

Supported environment: Linux, Node 24+, tested DSH 0.1.2-rc.1 / Cordis 4.0.2. Public TypeScript declarations and supported strategy hooks are compiled in the product gate. Windows/macOS are not currently verified. The text-hygiene example measures actual local text, not the behavior of an LLM Agent. Config execution requires a compatible executor; the persona executor is not a config executor.

- Trusted in-process providers; host owns permission enforcement.
- Recovery only at unchanged settled checkpoints within the original deadline.
- No automatic candidate adoption.
- Valid baseline quality violations may enter repair; candidates must meet unchanged constraints. Invalid evidence still stops search. Inspect plan.baselinePolicy and result.baselineAssessment.
- Method superiority is not established by product acceptance.

Research is paused for this product release: no new benchmark, single-loop comparison, Graph/Bayesian, weak-to-strong, Generator/Slow research or additional loops. Historical method evidence has not established a general DUO quality/cost advantage.
