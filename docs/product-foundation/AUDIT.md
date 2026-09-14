# Product architecture facts at 0.4.0

Reviewed source/remote baseline `6729d4c`, 2026-09-14. This table records actual implementation, not proposed modules. Existing architecture and safety boundaries are retained. Local product review has 33 affected tests passing while two cross-component gaps reproduce; a green component suite is not complete product acceptance.

| Responsibility | Implementation / public surface | General vs specific; duplication | Replaceable? / missing wiring | Minimum change |
|---|---|---|---|---|
| Lifecycle | native/controller.js; plan/run/status | Mostly generic; persona/config identity conditional, fixture result label | Existing ControllerService; no new runtime needed | Target-owned content identity; neutral evidence classification |
| Host integration | Cordis injections, DSH tools and agents | Generic native JS; Python explicitly legacy | Host owns registry, lifetimes, tools, permissions, models | Preserve host composition |
| Contract | contract.js; onboarding contractSchema/design | Runtime allows two target kinds, advertised schema only persona | ContractService replaceable; schema duplicated facts | Target-kind syntax generic; binding checked against active adapter; catalog for builtins |
| Target | target.js, config-target.js; /target, /config-target | Persona overlays; fetch maxBodyChars only | TargetService replaceable; missing shared lifecycle hooks | Put identity, history validation and Delta projection with adapters |
| Generator | model-generator, structured-generator, config-generator | Model/task specific by design; proposal projection has persona assumptions | GeneratorService replaceable | Keep algorithms frozen; pass matching target projection to existing proposal boundary |
| Executor | model-executor; fetch source example | Specific work adapters, generic lifecycle | ExecutorService replaceable; config real setup source-only | Shipped local product adapter/example, explicit real limits |
| Evaluator | function/docs/semantic adapters | Task-specific; measurements separate from decisions | EvaluatorsService, function adapter | Ship BYO/local examples and compatibility declarations |
| Evidence aggregation | policies.js WeightedComparator | Weighted/constraint policy, not universal truth | ComparatorService replaceable | Reuse; demonstrate replacement through public package |
| Promotion | gate.js / bounded-tie-gate.js | Strategy-specific default behind GateService | Already replaceable | Keep algorithm; document and test a replacement |
| Feedback / HistoryStrategy | feedback.js/history-feedback.js | Same-run feedback + screened history ordering | FeedbackService and optional orderHistory | Reuse existing seam; no extra service |
| Warm history | warm-start.js | Persona content hashes and Delta shape hardcoded | Selector replaceable; config rejected invalid_lineage | Target-specific projection/validation hooks; retain final/data/fixture limits |
| Journal | journal.js/store.js; SQLite | Generic; append-only receipts/checkpoints | JournalService | Preserve ownership, version checks and readonly recovery |
| Budget | budget.js/store.js/money.js | Shared native reservation/settlement; legacy Python separate contract | BudgetService | Preserve; clarify inner vs Caller budgets; avoid new accounting stack |
| Recovery | controller/store/observer | Settled baseline/generation only, original deadline | Storage capability declares support | Explicit supported boundaries, no blind replay |
| Report | observer.js; report tool | Generic candidates/evidence; result and persisted delivery distinguished | ObserverService | Preserve facts; add current capability entry and consistent errors |
| Public discovery | onboarding/tools/evaluator-discovery | describe vs discover overlap; discover needs valid plan | Existing tools suffice | Describe without plan; catalog + observed bindings, clear plan readiness |
| Failure surface | tools.finalizeDuoError; controller errorInfo | Duplicate partial diagnostics; cost/effect often only in report | Host keeps actual error identity | One shared normalization; unknown is explicit, not zero |
| Packaging | package.json, cordis.patch.yml | Default bundles research fixture; examples/model guide source-only | Exports work; install metadata exists | Product local example; keep fixture explicit opt-in compatibility; ship complete five examples |
| Public status | STATUS/DESIGN_COVERAGE + release metadata | Old Current/Latest narratives conflict with 0.4.0 | No single current page | Current capability/version page; historical evidence moved intact to archive section |
| Verification | release_gate.sh, native tests, 21 DSH profiles, CI | Historical research tests explicitly separate | Reuse cached DSH, clean profile and package | Add actual packaged product journeys; retain old negative evidence |

Known boundaries: trusted in-process providers, Linux/Node24 supported host, no hostile-provider sandbox, no automatic deployment, no arbitrary interrupted-call replay. Missing evaluator/objective still requires owner input; software must not invent it. Historical real Caller acceptance exists but does not establish fresh 0.5.0 acceptance or method superiority.
