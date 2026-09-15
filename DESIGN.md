# DualLoop — A DSH-Native Dual-Loop Autonomous Optimization Plugin

Repository reading note (0.6.1): the dated design and status statements below are
historical. Use [current supported capabilities](CURRENT_STATUS.md) and the
[current architecture boundaries](README.md#architecture-and-extension-boundaries)
for the shipped product. The original design decisions are retained.

**Status:** Architecture proposal and historical design record; native delivery correction approved by the user on 2026-09-08 (below).
**Supersedes:** `evolution/DESIGN.md` as project direction (that document remains the historical record of the v1 prototype)
**Inspired by:** *Self-Evolving Recommendation System: End-To-End Autonomous Model Optimization With LLM Agents* — we abstract its dual-loop experimentation method; we do **not** reproduce YouTube, its recommendation system, or its production infrastructure.
**Positioning:** a **short-cycle portfolio project** — optimize for a demonstrable, honest closed loop with a readable narrative, not for platform completeness. The sibling `dsh_lab/` track is long-term and stays separate; no shared codebase, no merge.

**Binding delivery correction — 2026-09-08:** The user's instruction
“不是这个你应该做成DSH的插件” supersedes the thin-shell choice below. The current
default package must execute the supported protocol inside DSH through real Cordis
Definition/Provider/Consumer services, including lifecycle, replaceable providers
and native tools. The Python implementation is retained as explicit compatibility,
not counted as native service implementation. Historical Phase A/B text, principle
11, audit A1 and gap-matrix packaging priorities below record the former decision.
They no longer defer this native implementation.

**Binding search-ladder amendment — 2026-09-12:** The user's instruction
“slow是昂贵的，但贵也是有层级的，fast的便宜也是……多加点颗粒度” generalizes the
native contract's fixed fast/review/slow stage enumeration into an ordered
**credibility ladder** of caller-named stages (`searchStages`, uncapped depth —
two stages is the common default — cheapest first,
terminal validation last; `final` stays separate). The two budget pools keep their
semantics: the first rung spends the Fast allowance, every deeper rung and final
share the Slow allowance, and each rung keeps its own `maxEvaluations`/`topK`
contract cap. Legacy flat fast/slow contracts are unchanged. Historical text below
that names only fast/slow tiers records the former fixed vocabulary.

The implemented scope is a persona target with native contract/controller,
comparison/gate/feedback and durable journal/budget providers; generator/executor/
evaluator service definitions accept caller-supplied Cordis providers. The shipped
example is a zero-cost static fixture. A real model-backed native provider, other
target kinds, independent optimization efficacy and existing-profile deployment
remain separate work. See [current package](dsh-plugin/README.md),
[provider contract](dsh-plugin/PROVIDERS.md), and
[actual status/evidence](CURRENT_STATUS.md). Native JSON v1/API v2 is distinct from
the historical illustrative YAML contract below; an architecture example is not
an implementation receipt.

**Grill convergence (2026-09-06, 勿重开):**

- **Audience:** AI companies generally, **the DSH team specifically** (job application). Consequence: DSH-native correctness is the audience's sharpest scoring dimension — **Phase B (cordis shell) is required, not optional**, but stays thin and idiom-perfect rather than deep.
- **The one-sentence memory hook:** "把推荐系统论文的双循环自治实验方法**跨界移植**到 agent 优化领域，做成 DSH 原生插件，并用一个真实实验证明了闭环和 Slow→Fast 反馈。" Cross-domain transfer is the headline capability.
- **Time box: 1 week** (AI-assisted). Scope is cut to fit: demo = 2-3 generations, small benchmark, maximal reuse of v1 evaluators/infra; nothing beyond DESIGN.md's MVP list.
- **Failure disposition:** negative results are acceptable and welcome, but the failure record must be *complete* — journal + write-up is a first-class deliverable, not an apology.
- **Budget: ≤ ¥100 DeepSeek API.** Enforced via contract budgets (`max_fast_evals` / `max_slow_evals` / cost cap); demo sized to fit (see Demo Experiment).

---

## Project Thesis

DualLoop is a **reusable experiment method packaged as a DSH plugin**:

> Turn a vague optimization goal into an executable **Objective Contract**,
> search cheaply and broadly in a **Fast Loop** against a proxy objective,
> validate sparsely and honestly in a **Slow Loop** against a higher-fidelity objective,
> and feed Slow Loop evidence back into the next Fast Loop — closing the loop.

It is simultaneously:

1. a **DSH plugin** (cordis-native, installable, configured via `cordis.yml`);
2. a **reusable experiment method** (the protocol is target-agnostic);
3. a **GitHub portfolio project** (small, complete, reproducible);
4. an **optimization framework** others can point at their own agent / skill / workflow.

Non-goals: no recommendation system, no production infra, no new agent runtime, no distributed system, no big-bang UI.

---

## Problem

"Self-evolving" agent projects fail in predictable ways:

- **The objective is vibes.** "Make this agent better" with no measurable contract produces plausible-looking scores and no knowledge.
- **Fast and slow are just two evaluators.** Without a protocol, the expensive evaluation becomes a one-off acceptance gate whose results never change the search. The loop is open.
- **The evaluator decides what "better" means.** A single scalar score conflates measurement with judgment, invites reward hacking, and hides trade-offs (cost, latency, safety).
- **Search collapses to knob-twiddling.** `lr 0.10 → 0.11 → 0.12` instead of structural change, because nothing enforces candidate diversity.
- **History is a log, not memory.** The generator cannot learn "fast improvements of *this kind* never survive the slow loop."
- **No honest degradation path.** When no high-fidelity objective exists, systems fake a score instead of admitting they are exploring, not optimizing.

The v1 prototype in `evolution/` proved a loop *can* turn (baseline → propose → evaluate → select → journal → human promote), and produced hard-won engineering assets (sandbox isolation, telemetry, guardrails, offline regression). But its slow loop is manual-only, slow results never re-enter the fast loop as signal, comparison is a single scalar, and it is a Python script *orchestrating* DSH from outside rather than a plugin *living inside* DSH.

---

## Design Principles

1. **The Dual-Loop Protocol is the product.** Fast/Slow are not two evaluators; they are two phases of one fixed protocol with a mandatory feedback edge (Slow → next Fast). Everything else is a pluggable socket on that protocol.
2. **Objective before optimization.** No contract, no loop. A vague goal must pass through an Objective Designer into an Objective Contract before any candidate is generated.
3. **Fail closed.** If the contract is incomplete (no baseline, no measurable objective, no evaluator, no comparison direction, no executable experiment), the system must not claim to optimize. It degrades to **Explore Mode** and says so.
4. **Evaluators produce facts; Comparators decide "better".** Evaluators return metric dictionaries (`task_success, cost, latency, error_rate, safety_pass, sample_size, confidence`), never a verdict. Comparison policy (weighted / constrained / Pareto / lexicographic / business rules) is a separate, versioned plugin.
5. **Slow means closer to the truth, not "production".** A slow evaluator is defined by *fidelity relative to the fast one*: hidden holdout, larger benchmark, stronger judge, human review, integration tests, real downstream outcomes — anything nearer the north star.
6. **The Journal is shared memory, not a log.** Complete, append-only, queryable history that the Generator reads. Learning "which fast wins failed slow" is the mechanism, not a reporting feature.
7. **Diversity is policy.** Every generation explicitly mixes exploitation / exploration / innovation. Quotas are configurable, never hardcoded.
8. **Candidates are deltas.** A candidate is a minimal patch against a champion (cordis overlay, prompt section diff, config change), not a regenerated system.
9. **DSH executes; DualLoop orchestrates.** Agent sessions, tool execution, profiles, patches, approvals, telemetry belong to DSH. We build the experiment protocol, not a runtime.
10. **Small but complete over large but half-done.** Every shipped component must be testable offline (mock mode), reproducible (seeded), and honest (negative results journaled, not hidden).
11. **Prove the protocol before deepening the integration.** *(audit)* The closed loop, the feedback edge, and the demo are the portfolio evidence; cordis-plugin depth is packaging. When the two compete for time, the protocol wins.

---

## Objective Contract

The contract is the gate between "a wish" and "an experiment". Authored by the user with help from an Objective Designer; validated by an observability/validity check before the loop may start in Optimize Mode.

```yaml
# objective.yml
id: skill-research-quality
version: 1
created: 2026-09-06

target:                      # what is being edited
  kind: dsh-skill            # dsh-skill | dsh-persona | dsh-plugin-config | ...
  ref: skills/research/SKILL.md
  editable_space:            # what the Generator may touch
    - instructions
    - workflow_policy
  frozen: [tools, permissions]

baseline:
  ref: git:HEAD              # current champion must exist and be evaluable

upper_objective:             # North Star
  metric: task_success_rate
  direction: maximize
  evaluator: holdout_benchmark_v1   # slow evaluator id
  fidelity: high
  feedback_latency: slow

lower_objectives:            # Fast proxies
  - metric: dev_benchmark_score
    direction: maximize
    evaluator: dev_benchmark_v1
    expected_relation: correlates_positively_with(task_success_rate)
  - metric: avg_cost_usd
    direction: minimize
    evaluator: dev_benchmark_v1

constraints:                 # hard guardrails — violations reject, not penalize
  - metric: avg_cost_usd
    op: "<"
    value: 0.50
  - metric: safety_pass
    op: "=="
    value: true

comparison:                  # how "A beats B" is decided (comparator plugin id + config)
  plugin: weighted_v1
  config:
    weights: { task_success_rate: 1.0, avg_cost_usd: -0.2 }
    min_sample_size: 20
    incumbent_epsilon: 0.02  # challenger must beat champion by this margin

budget:                      # evaluation cost is a real budget
  max_fast_evals: 200
  max_slow_evals: 20
  max_wall_time_hours: 12
```

**Validity check (fail closed):** the loader verifies that `baseline` resolves, `target.editable_space` is non-empty and permitted, every referenced evaluator exists and its metrics cover the contract's metrics, `comparison.direction` is defined for the primary metric, and at least one executable experiment path exists. Any failure → the run is refused with a precise reason, or downgraded to Explore Mode (see below).

For an input like *"make this agent better"*, the Objective Designer (v1: an interactive CLI wizard; later: LLM-assisted) must produce something like the contract above — North Star = task success rate, fast proxies = dev benchmark / citation correctness / tool error rate, explicit cost/latency constraints — before anything runs.

---

## Dual-Loop Protocol

The protocol is fixed; every box is a plugin socket.

```
ObjectiveContract ──valid?──► Optimize Mode ─────────────────────────────┐
        │ no                                                              │
        ▼                                                                 │
   Explore Mode (no ranking claims)                                       │
                                                                          ▼
┌──────────────────── FAST LOOP (high freq, cheap, proxy) ───────────────────────┐
│ Generator(champion, Journal, FeedbackSummary, diversity_policy)                │
│      → candidates: N exploit / M explore / K innovate (deltas vs champion)     │
│ Executor → run each candidate (DSH does the work)                              │
│ FastEvaluator → EvaluationResult (metric dict, facts only)                     │
│ Comparator → ComparisonResult (ranking, per constraints + comparison policy)   │
│ PromotionGate → select top-k worth slow evaluation                             │
└──────────────────────────────────────┬─────────────────────────────────────────┘
                                       ▼
┌──────────────────── SLOW LOOP (low freq, expensive, high fidelity) ────────────┐
│ SlowEvaluator → EvaluationResult (closer to North Star)                        │
│ Comparator → accept / reject / update champion                                 │
│ Journal ← everything (hypothesis, delta, both metric sets, decisions, costs)   │
│ FeedbackEngine → FeedbackSummary:                                              │
│     fast/slow correlation, per-mutation-family outcomes, failed proxy regions  │
└──────────────────────────────────────┬─────────────────────────────────────────┘
                                       ▼
                    next Fast Loop generation (Generator reads FeedbackSummary)
```

The critical invariant: **Slow is not a final acceptance step.** The feedback edge into the next generation is part of the protocol, not an optional analysis.

---

## Plugin Architecture

Everything is a plugin; the Dual-Loop Protocol is the fixed core. Contracts are versioned, typed interfaces — not duck-typed conventions (a v1 lesson: duck typing hid interface drift).

**Delivery shape (audit: protocol-first, integration-second):**

- **Phase A — protocol core (the portfolio evidence).** A standalone `dualloop` package implementing the full protocol + demo, **reusing v1's proven Python infrastructure** (sandboxed DSH execution, guardrails, journal, world-generator evaluators, session traces). Run via CLI. This is the fastest honest path to a closed loop, and it keeps the demo weeks ahead of any packaging work.
- **Phase B — DSH-native shell.** A thin cordis plugin (`@dual-loop/dsh-plugin`, TypeScript) that registers the loop as a DSH service/CLI chord and drives the Phase A core. Thin by design: it proves "installable into any DSH profile" without rewriting working machinery. Deep in-DSH reimplementation stays deferred.

| # | Plugin contract | Responsibility | v1 implementation |
|---|---|---|---|
| 1 | **ObjectiveProvider** | Load/validate an Objective Contract; expose observability check | YAML file loader + schema validator |
| 2 | **ObjectiveDesigner** | Turn vague NL goals into a verifiable contract | interactive CLI wizard (LLM-assisted: deferred) |
| 3 | **Generator** | Propose candidates from champion + Journal + FeedbackSummary, honoring diversity quotas | template mutator + LLM proposer (headless DSH session) |
| 4 | **Mutator/Delta** | Define how a candidate modifies its parent; apply/validate deltas | cordis patch overlay / prompt-section patch |
| 5 | **Executor** | Actually run a candidate | DSH headless sessions (never reimplemented) |
| 6 | **FastEvaluator** | Produce cheap, low-fidelity evidence (metric dict) | programmatic benchmark (world-generator pattern from v1) |
| 7 | **SlowEvaluator** | Produce expensive, high-fidelity evidence | hidden holdout + stronger-model judge (optional human review) |
| 8 | **Comparator** | Decide "what is better" from metric dicts: weighted / constrained / Pareto / lexicographic / business rules | weighted + hard constraints + incumbent epsilon |
| 9 | **PromotionGate** | Decide which fast candidates earn slow evaluation | top-k + epsilon + budget-aware |
| 10 | **Journal** | Persistent shared experiment memory | append-only JSONL + SQLite index (queryable) |
| 11 | **LoopController** | Drive the state machine: generate → evaluate → promote → slow-evaluate → update → next generation | single cordis service with explicit states |
| 12 | **Observer/UI** | Visualize lineage, fast-vs-slow, promotions, alignment. Never participates in truth decisions | CLI tables (web observatory deferred) |

Safety-critical pieces (guardrail validation, budget enforcement, contract validity check, promotion finality) are **plain deterministic code**, never LLM-mediated — carried over from v1's "安全件保持非 LLM 代码" rule.

---

## Core Data Models

TypeScript interfaces (v1). Metrics are always dictionaries; verdicts only ever appear in `ComparisonResult`.

```ts
interface ObjectiveContract { /* the YAML above, parsed & validated */ }

interface Candidate {
  id: string;                    // dl-0007
  experimentId: string;
  parentId: string | null;       // lineage
  generation: number;
  family: string;                // mutation family, e.g. "retrieval-discipline"
  mode: 'exploit' | 'explore' | 'innovate';
  delta: Delta;                  // patch vs parent (cordis overlay / prompt diff)
  hypothesis: string;            // why this should help, stated BEFORE evaluation
}

interface EvaluationResult {
  candidateId: string;
  evaluatorId: string;
  tier: 'fast' | 'slow';
  ok: boolean;                   // false = infra failure, NOT a bad score
  metrics: Record<string, number | boolean>;  // task_success, cost, latency, error_rate,
                                              // safety_pass, sample_size, confidence, ...
  artifacts: string[];           // session traces, outputs
  costUsd: number;
  wallTimeS: number;
  ts: number;
}

interface ComparisonResult {
  comparedAt: number;
  comparatorId: string;
  ranking: string[];             // candidate ids, best first
  verdicts: Record<string, 'better' | 'worse' | 'incomparable' | 'constraint_violation'>;
  rationale: string;             // machine-generated from the policy, auditable
}

interface JournalEntry {
  // identity & lineage
  experimentId: string; candidateId: string; parentId: string | null;
  generation: number; family: string; mode: Candidate['mode'];
  // intent
  hypothesis: string; deltaRef: string;
  // fast loop
  fast?: EvaluationResult; fastRank?: number;
  promotionDecision?: 'promoted_to_slow' | 'held' | 'dropped';
  // slow loop
  slow?: EvaluationResult; slowDecision?: 'accepted' | 'rejected' | 'champion';
  // bookkeeping
  constraintViolations: string[]; failureReason?: string;
  status: 'proposed' | 'fast_evaluated' | 'slow_evaluated' | 'champion' | 'rejected' | 'error';
  ts: number;
}

interface FeedbackSummary {      // what the next Generator actually reads
  fastSlowCorrelation: Record<string, number>;        // per fast metric
  familyOutcomes: Record<string, { fastAvg: number; slowAvg: number; n: number }>;
  failedProxyRegions: string[];  // "fast>0.9 via X never survived slow"
  championLineage: string[];
  suggestedEmphasis: { exploit: number; explore: number; innovate: number };
}
```

---

## Fast Loop

**Purpose:** high-frequency, low-cost, broad search against the proxy objective.

State machine (per generation):

```
IDLE → GENERATING → EXECUTING → FAST_EVALUATING → COMPARING → PROMOTING → IDLE(next gen)
  │        │            │              │              │            │
  └────────┴────────────┴──────────────┴──────────────┴────────────┴──► on error:
                              journal ok=false, continue (fail closed)
```

Rules:

- **Diversity policy is mandatory — and structural, not self-reported.** *(audit)* Each generation requests e.g. 3 exploit / 3 explore / 2 innovate (configurable). Modes are **assigned by the LoopController** and produced by **different mutation operators**: exploit = local perturbation of the champion family; explore = switch to a different mutation family / region; innovate = cross-domain analogy or compositional change via a dedicated prompt template. An LLM generator never labels its own output "innovation" — quotas act on the generation mechanism, which is the only reliable defense against `lr 0.10 → 0.11 → 0.12` collapse.
- **Every candidate carries a hypothesis, ordered before the delta.** *(audit)* The generator protocol requires hypothesis output *first*, delta *second* — a candidate may not be a post-hoc rationalization. Journal entries record the ordering; violations are rejected by the Mutator.
- **Budgets are real:** `max_fast_evals`, per-eval timeout, cumulative cost. Exhaustion stops the loop cleanly, mid-state, with the journal intact.
- **Infra failure ≠ bad candidate:** `ok=false` entries are journaled with `failureReason` and excluded from ranking (v1 semantics, kept).
- **Comparability scope:** fast results rank only against results from the same evaluator + contract version.

## Promotion Gate

The PromotionGate plugin answers: *which fast candidates are worth slow-eval money?*

v1 policy: candidates that (a) beat the champion per the Comparator (including incumbent epsilon), (b) pass all hard constraints, (c) fit the remaining slow budget — ranked by comparator output, top-k promoted. The gate is budget-aware by design: slow evaluations are the scarce resource, and "how many can we afford" is an explicit input, not an afterthought.

## Slow Loop

**Purpose:** low-frequency, high-cost, high-fidelity validation closer to the North Star — and the source of all feedback signal.

State machine (per promoted candidate):

```
QUEUED → SLOW_EVALUATING → COMPARING(vs champion on upper objective) →
  ACCEPTED(new champion | accepted lineage) | REJECTED → FEEDBACK_UPDATED → JOURNALED
```

- A slow evaluator is any evidence source with **higher fidelity than fast**: hidden holdout split, larger/regenerated benchmark, stronger-model judge, human review, integration tests, real downstream outcomes. v1 demo: holdout world-generator split + optional stronger judge.
- **The slow tier must contain at least one evidence source from a *different family* than the fast tier.** *(audit)* If fast and slow are the same distribution with different sizes, "slow" is just a bigger proxy and the fidelity claim is unfalsifiable. The demo's slow loop therefore pairs the holdout suite with a **stronger-model judge on rubric dimensions** (different model from the generator), plus optional human spot-check. "Who falsifies the slow evaluator?" is answered by: heterogeneity + negative controls + the alignment table itself.
- **Champion update happens only here.** The fast loop proposes; the slow loop disposes. (v1 got this right with human `promote`; v2 automates the evaluation while keeping an optional human-approval chord via DSH's approval layer.)
- The champion may stay put. A generation with no accepted candidate is a normal, journal-worthy outcome.

## Slow-to-Fast Feedback

First-class mechanism, concretely:

1. After each slow evaluation, the **FeedbackEngine** recomputes `FeedbackSummary` from the full journal:
   - **Proxy alignment:** per fast metric, correlation with slow outcomes across all generations (e.g. `dev_benchmark_score` vs `task_success_rate`).
   - **Family outcomes:** per mutation family, fast average vs slow average. Families where fast≈high but slow≈low are *proxy traps*.
   - **Failed proxy regions:** explicit rules-of-thumb extracted from history ("persona verbosity > N chars inflated fast score, failed holdout twice").
2. The next **Generator** call receives this summary and must act on it: avoid failed regions, weight promising families, rebalance exploit/explore/innovate emphasis.
3. The **PromotionGate** may use family-level slow survival rates to prioritize which fast winners get scarce slow slots.
4. **The Comparator policy itself is NOT adapted by feedback.** Changing the definition of "better" mid-experiment destroys comparability (Goodhart). Feedback steers *search*, never *measurement*. Policy changes require a new contract version.
5. **Feedback is conservative by construction.** *(audit)* Generations are small (≈8 candidates, top-2 slow), so early family-level statistics are noise and LLM generators over-read noise. Rules: (a) a family is penalized only after **≥2 slow failures** (or a configured n); (b) correlations below `min_sample_size` are reported as *insufficient data*, never as findings; (c) `suggestedEmphasis` shifts are bounded per generation (e.g. ±1 quota slot). Feedback starts as a heuristic hint and earns influence only as the journal grows.

Worked example — fast says A(0.91) > B(0.87); slow says A(0.61) < B(0.79): the journal now records that A's family overfits the proxy. Next generation, B's direction is explored further and A's family is penalized in generation and promotion — not because anyone hardcoded it, but because `familyOutcomes` says so.

## Experiment Journal

Persistent shared memory of the dual loop; the single source of truth for generator, comparator, gate, feedback, and UI.

- **Append-only**, complete history (v1 lesson, matching the paper's ablation: full ranked history ≫ truncated windows).
- Storage: JSONL event log (source of truth, diff-friendly) + SQLite index for queries.
- Retains *everything* in `JournalEntry`, including rejected candidates, infra failures, costs, and constraint violations.
- The v1 `recent_window` policy (proposer sees last 10) is **rejected** for v2: the Generator gets structured `FeedbackSummary` + full ranked lineage; raw-window exposure was a context-size workaround, and deltas are compact enough to afford better.

## DSH Integration Boundary

**DSH owns** (we consume, never rebuild):

- agent runtime, tool execution pipeline, subagent/workflow fan-out
- cordis plugin system: loading, lifecycle, hot-reload, capability seams
- profiles, bundles, and `cordis.patch.yml` layering — our candidate delta format
- headless/web profiles for execution
- approval layer (optional human review hook for promotion)
- session persistence & telemetry (`session.jsonl.zstd` traces — v1 already harvests these)
- LLM streaming / token metering (cost evidence)
- sandboxing facilities

**DualLoop owns:**

- the Objective Contract schema, designer, and validity check
- the loop state machine (LoopController)
- generator/mutator/evaluator/comparator/gate plugin contracts and v1 implementations
- the journal and feedback engine
- experiment budgets and guardrails
- offline mock mode for regression

Packaging: `@dual-loop/dsh-plugin` — a cordis plugin registering the LoopController service + CLI commands (`dualloop run|status|lineage|promote`), configured in `cordis.yml` with slot names pointing at concrete plugins. DSH-native means: installing the plugin into any DSH profile gives that agent the dual-loop capability.

## Failure / Explore Mode

Two modes, explicitly labeled, never blended:

**Optimize Mode** requires: baseline ✓, editable target ✓, measurable objective ✓, evaluator ✓, comparison direction ✓, executable experiment ✓, and for full dual-loop: an upper objective + slow evaluator ✓. Only then may the system say "optimizing" / "candidate B is better".

**Missing upper objective or slow evaluator** → **fast-only exploration**: the fast loop runs, results are journaled, but output is labeled *proxy-only, not validated*. No champion is crowned on proxy evidence alone.

**Objective not comparable at all** → **Explore Mode**: generate alternatives → collect evidence → analyze differences → surface hypotheses. Deliverable is insight (e.g. "candidates cluster into 3 behavioral families; metric X discriminates them"), never a fabricated score. Explore Mode is also the escape hatch the Objective Designer uses to help the user discover what *should* be measured.

## MVP

Scope: prove the closed loop end-to-end, offline-testable, on one real demo. Sequenced protocol-first *(audit)* — the demo must never be hostage to packaging work.

**Phase A — protocol core (Python CLI, reuses v1 infrastructure):**

- Objective Contract v1 (YAML schema + validator + CLI wizard); three-mode gate (Optimize / fast-only / Explore)
- LoopController state machine (fast loop → promotion gate → slow loop → feedback update)
- Plugins v1: Generator (three structural mutation operators + LLM proposer, controller-assigned quotas, hypothesis-before-delta), Mutator (patch deltas, port of v1 overlay machinery), Executor (v1 sandboxed DSH headless), FastEvaluator (programmatic dev benchmark, world-generator pattern), SlowEvaluator (holdout split + stronger-model judge), Comparator (weighted + constraints + epsilon), PromotionGate (top-k + budget), Journal (JSONL + SQLite), Observer (CLI)
- FeedbackEngine v1 with conservative rules (≥2 slow failures to penalize a family; insufficient-data labeling; bounded emphasis shifts)
- Guardrails, budgets, fail-closed journaling (ported from v1)
- Mock mode: deterministic fake evaluators → full dual-loop regression without API calls (extension of v1 `experiment.mock.yml` to the slow tier)
- **The demo experiment (below) with honest results — this is the portfolio centerpiece**

**Phase B — DSH-native shell (thin cordis plugin, TypeScript):**

- `@dual-loop/dsh-plugin`: registers LoopController as a cordis service + `dualloop run|status|lineage` commands in a DSH profile, drives the Phase A core
- Install/run documentation for a third party

Explicitly **not** in MVP: UI web app, LLM Objective Designer, Pareto comparator, multi-target parallelism, human-in-loop promotion via approval API, cron daemon, distributed execution, deep in-DSH reimplementation of the core.

## Demo Experiment

**DSH Agent Skill Optimization** — small, executable, comparable, repeatable, real external feedback.

- **Baseline:** an existing skill (e.g. a research or summarization `SKILL.md`) as-is.
- **Editable space:** skill instructions / prompt / workflow policy sections.
- **Fast loop:** programmatic benchmark — dev task suite with verifiable answers, world-generator pattern (structure fixed, facts randomized per run; ported from v1 `memory_recall_v2`), cheap model, multi-seed. Metrics: success rate, cost, latency, tool error rate.
- **Slow loop:** hidden holdout suite (same distribution family, never visible to the generator) + optional stronger-model judge on rubric dimensions. Higher fidelity, higher cost, lower frequency.
- **Protocol:** N generations × (3 exploit / 3 explore / 2 innovate), promotion top-2, budgets capped.

Expected honest output (shape, not a promise of monotonic improvement):

```
             Fast(dev)   Slow(holdout)
baseline       0.53         0.51
gen1 best      0.61         0.58
gen2 best      0.68         0.66
gen3 best      0.72         0.67   ← fast gain > slow gain: proxy gap visible
```

If results flatline or regress, that is journaled and reported as the finding. The demo succeeds if the *closed loop* is real: generate → execute → evaluate → promote → high-fidelity validate → feedback → next generation, with feedback measurably altering generation choices.

## Metrics & Validation

How we prove the project works — and how we prove "optimization" is real rather than an LLM grading its own homework:

1. **Programmatic ground truth first.** Primary metrics are verifiable (exact answers, test pass/fail, measured cost/latency), not model opinion. LLM judges are secondary signals, rubric-constrained, and **never the same model that generates candidates** (generator/judge separation).
2. **Holdout hygiene.** Slow-eval worlds are never visible to the generator; evaluator code and answers are unreachable from the candidate's sandbox (v1's leak incident — model read evaluator source — is the standing cautionary test).
3. **Negative controls.** A deliberately-broken candidate must score low; a leak-probe candidate must be caught. If controls pass silently, the benchmark is broken, not the agent.
4. **Pre-registered contract.** The Objective Contract is fixed before the run; comparator changes version the contract. No post-hoc metric shopping.
5. **Contamination ledger.** Deprecated/invalid entries are blocklisted and excluded from all rankings (port of v1 `deprecated.txt`).
6. **The loop's own health metrics:** fast/slow correlation over time, champion lineage length, % of promoted candidates surviving slow, constraint violation rate, cost per accepted improvement. The headline plot is **proxy–North-Star alignment** (the fast-vs-slow table) — it must show the fast loop learning to serve the slow objective, or the project reports that honestly.
7. **Reproducibility:** seeded worlds, journaled deltas, mock-mode regression of loop mechanics in CI.

## Deferred Work

- LLM-assisted Objective Designer (v1 is a wizard; the designer conversation is itself a future demo of the loop)
- Web Experiment Observatory (lineage graph, fast-vs-slow charts, promotion history, constraint/cost dashboards)
- Pareto / lexicographic comparators, confidence-interval-aware selection (v1 already records `by_seed` variance)
- Human review as a SlowEvaluator via DSH's approval layer
- Warm-start injection, few-shot proposal exemplars (paper techniques, known value)
- Plugin/skill "gene pool" with whitelist review (v1二期 idea)
- Multi-target parallel experiments; cron-resident autonomous operation
- In-session self-composition via `@deepseek-ai/dsh-tool-cordis` (v1 "step 3" — highest risk, gated behind sandbox/approval design)
- Real downstream outcomes as slow evidence (post-deploy usage feedback)

## Migration From Current Architecture

Guiding rule: **design first, migrate second; no compatibility contortions.** The v1 Python prototype (`evolution/`) stays untouched as the archived proof-of-concept and source of portable assets. *(audit)* v2 is **not** a wholesale TypeScript rewrite: Phase A is a Python protocol core that *imports* v1 machinery (this is what makes the demo schedule realistic for a portfolio project); Phase B adds the thin TypeScript cordis shell around it.

Port (with their lessons encoded as tests): journal append-only semantics + contamination blocklist; guardrail whitelist validation; candidate-as-cordis-overlay + `!!js`-safe YAML round-trip; sandbox cwd isolation + evaluator-source hiding; session-trace harvesting; incumbent epsilon (→ comparator config); world-generator evaluator pattern; mock offline regression mode; fail-closed journaling; budgets/timeouts.

Rebuild: everything else — orchestrator → LoopController plugin; scalar score → metric dicts + Comparator; manual promote → SlowEvaluator + PromotionGate; windowed history → FeedbackSummary; mutate pool → diversity-quota Generator.

## Acceptance Criteria

1. `dualloop run` executes the full protocol in mock mode offline: contract validated → generations produced with diversity quotas → fast metrics → comparison → promotion → slow metrics → champion decision → feedback summary visibly changes the next generation's candidate mix. CI-green.
2. The demo experiment runs end-to-end on a real DSH skill with real (paid, budgeted) evaluations and produces the fast-vs-slow table and lineage, whatever the numbers say. The slow tier demonstrably includes a **different evidence family** than the fast tier (holdout + stronger-model judge) *(audit)*.
3. Fail-closed demonstrated: missing baseline / missing slow evaluator / infra failure each produce the correct degradation (refusal, fast-only label, `ok=false` journal entry) — with tests.
4. Feedback demonstrated: at least one seeded proxy-trap family is generated, fails slow **≥2 times**, and is observably de-emphasized in a later generation — and a family with a single slow failure is demonstrably NOT penalized (conservative-rule test) *(audit)*.
5. No LLM-generated verdict anywhere in the decision path: evaluators emit metrics, comparators apply versioned policy, generator/judge are different models. Diversity quotas are enforced structurally (distinct operators), and journal entries show hypothesis recorded before delta *(audit)*.
6. **Phase B:** a third party can install the plugin into a fresh DSH profile, point it at their own skill + benchmark via a contract file, and run the loop — documented in the README.

---

## Audit Amendments (2026-09-06)

Design audit against the first draft, under an explicit constraint: **this is a short-cycle portfolio project** (demonstrable proof for job applications); `dsh_lab/` is the separate long-term track and is NOT merged. Findings and resolutions — all already applied to the sections above:

| # | Finding | Resolution | Where |
|---|---|---|---|
| A1 | Cordis-plugin + TS rewrite at P0 made the demo hostage to packaging; protocol proof and integration are separable | Phase A (Python core, reuses v1 infra) / Phase B (thin cordis shell); protocol wins resource conflicts | Plugin Architecture, MVP, Migration, Gap #1 |
| A2 | "Slow = higher fidelity" unfalsifiable if fast and slow share one distribution | Slow tier requires ≥1 heterogeneous evidence family (holdout **+** stronger-model judge, optional human spot-check) | Slow Loop, Demo, Acceptance #2, Gap #21 |
| A3 | Feedback statistics under-powered at demo scale; LLM over-reads noise | Conservative rules: ≥2 slow failures to penalize a family, insufficient-data labeling, bounded emphasis shifts | Slow-to-Fast Feedback #5, Acceptance #4, Gap #22 |
| A4 | Self-reported diversity labels unenforceable | Controller-assigned modes + three structurally distinct mutation operators | Fast Loop, Acceptance #5, Gap #8 |
| A5 | Hypothesis field invites post-hoc rationalization | Generator output order enforced: hypothesis first, delta second; Mutator rejects violations | Fast Loop, Acceptance #5 |
| A6 | Portfolio value depends on narrative, not just code | Demo write-up (closed-loop evidence, proxy-gap table, honest failures) is an acceptance deliverable | Gap #23 |

Open audit items (accepted risks, not blockers): API cost of the real demo run (mitigated by budgets; cap the demo at ~3 generations); Phase B shell still untested against real cordis packaging (spike early in Phase B, not at the end).

---

## CURRENT → TARGET ARCHITECTURE GAP MATRIX

| # | Current (v1 `evolution/`) | Target (v2 DualLoop) | Gap | Action | Priority |
|---|---|---|---|---|---|
| 1 | Python `orchestrator.py` drives DSH from outside | Phase A: Python protocol core (CLI) importing v1 machinery; Phase B: thin cordis plugin shell | Protocol proof and packaging were conflated at P0 *(audit)* | Split: core loop = P0; cordis shell = Phase B, P1 | P0 (core) / P1 (shell) |
| 2 | No objective abstraction; `experiment.yml` = hypothesis + slots | Objective Contract (upper/lower/constraints/comparison/budget) + validity check | Entire concept missing | New: schema, loader, validator, wizard | P0 |
| 3 | Slow loop = human `promote` only; heldout run manually | SlowEvaluator plugin + automated slow phase in the loop | No automated high-fidelity phase | New: SlowEvaluator contract + holdout implementation | P0 |
| 4 | No Slow→Fast feedback; proposer sees last-10 window | FeedbackEngine → FeedbackSummary → Generator/Gate | The closing edge of the closed loop | New: feedback engine + generator integration | P0 |
| 5 | Single scalar `score`; metrics journaled but unused | Evaluators emit metric dicts; Comparator plugin decides | Measurement and judgment conflated | Refactor evaluator contract; new Comparator | P0 |
| 6 | No comparator; epsilon inline in selector | Comparator (weighted + constraints + epsilon), versioned per contract | Missing decision layer | New plugin; port epsilon as config | P0 |
| 7 | Champion via incumbent-epsilon selector; promotion via human gate | PromotionGate (top-k, budget-aware) + slow-loop champion update | Two ad-hoc mechanisms → one protocol gate | Redesign; port epsilon + heldout requirement | P1 |
| 8 | Proposers: mutate pool (5 snippets) / LLM, no diversity | Generator with controller-assigned exploit/explore/innovate quotas via **distinct mutation operators**; hypothesis-before-delta ordering | Self-reported diversity labels are unenforceable *(audit)*; search collapses to hill-climbing | New Generator contract + 3 structural operators + ordering check | P0 |
| 9 | Journal: append-only JSONL + entries + deprecated.txt | Same semantics + JournalEntry schema + SQLite index + FeedbackSummary views | Schema lacks slow tier, family, hypothesis, decisions | Extend schema; add index; port blocklist | P0 |
| 10 | Duck-typed slot modules, no load-time validation | Versioned typed plugin contracts with validation | Interface drift invisible (v1 pain) | Define TS interfaces + runtime checks | P1 |
| 11 | Fail-closed journaling, guardrail whitelist, budgets-by-timeout | Same, as deterministic safety core + real cost budgets | Cost untracked as budget (v1 ⚠️) | Port guardrails; add cost accounting from token telemetry | P1 |
| 12 | Candidates = cordis patch overlays; `!!js` YAML round-trip | Same delta format via Mutator plugin | Solid — needs porting to TS or sidecar | Port incl. round-trip tests | P1 |
| 13 | Sandbox cwd isolation; session-trace harvesting | Same, as Executor infrastructure | Solid — port | Port + encode leak incident as regression test | P1 |
| 14 | World-generator evaluators (train/heldout splits, multi-seed) | Same pattern as v1 FastEvaluator/SlowEvaluator | Solid pattern — port | Port; evaluator emits metric dicts now | P1 |
| 15 | Mock evaluator + `experiment.mock.yml` offline regression | Mock mode for full dual-loop incl. slow tier | Covers fast loop only | Extend to full protocol CI | P0 |
| 16 | No optimize/explore distinction | Optimize / fast-only / Explore Mode with honest labels | Missing degradation semantics | New: mode gate in contract validation | P1 |
| 17 | Objective Designer: none (human writes experiment.yml) | CLI wizard now, LLM-assisted later | Missing | v1 wizard; LLM deferred | P2 |
| 18 | Observer: `rank`/`show` CLI | CLI status/lineage now; web observatory deferred | Adequate for MVP | Keep CLI scope; defer web | P2 |
| 19 | Human review = only promote path | Optional approval-layer chord; automated slow default | Human gate unintegrated | Deferred chord via DSH approval | P2 |
| 20 | Packaging: scripts in a folder | Installable plugin + README + demo = portfolio artifact | Distribution missing | Package, docs, demo replay instructions | P1 |
| 21 | Slow tier conceptually "higher fidelity" but same distribution as fast | Slow tier must include ≥1 **different evidence family** (stronger judge / human spot-check) | Fidelity claim unfalsifiable *(audit)* | Bake into SlowEvaluator contract + demo acceptance | P0 |
| 22 | No feedback exists | FeedbackEngine with **conservative rules**: ≥2 slow failures to penalize, insufficient-data labeling, bounded emphasis shifts | Small samples → LLM over-reads noise *(audit)* | Encode thresholds in FeedbackEngine + tests | P0 |
| 23 | No portfolio narrative requirement | README/demo structured as evidence: closed loop, proxy-gap table, honest failures | Portfolio value lives in the story, not just the code *(audit)* | Demo write-up template in Acceptance Criteria | P1 |
