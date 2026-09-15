"""LoopController: the dual-loop state machine (DESIGN.md "Dual-Loop Protocol").

validate contract -> evaluate baseline -> per generation:
  Generator (controller-ASSIGNED diversity quotas) -> Mutator -> Executor ->
  FastEvaluator -> Comparator -> PromotionGate -> SlowEvaluator ->
  Comparator (champion decision) -> journal everything -> FeedbackEngine ->
  next generation.

Invariants:
- Modes are assigned by the controller, never self-reported (audit A4).
- Champion updates happen ONLY in the slow loop: fast proposes, slow disposes.
- Budgets stop the loop cleanly, mid-state, journal intact.
- Fail closed: any plugin exception -> journal entry ok=false with
  failure_reason, loop continues (v1 semantics, kept).
"""
from __future__ import annotations

import hashlib
import re
import time
from dataclasses import dataclass, field
from typing import Any, Optional

from .comparator import TopKPromotionGate, WeightedComparator
from .contract import (
    EXPLORE_LABEL, PROXY_ONLY_LABEL, ObjectiveContract, PluginRegistry,
)
from .feedback import FeedbackEngine
from .journal import JsonlJournal
from .runtime.budget import BudgetExhausted
from .models import (
    Candidate, Delta, EvaluationResult, FeedbackSummary, JournalEntry, Mode,
    MODES,
)
from .plugins.base import (
    Executor, FastEvaluator, Generator, Journal, Mutator, ObjectiveProvider,
    Observer, PromotionGate, SlowEvaluator,
)
from .plugins.mock import (
    MockExecutor, MockFastEvaluator, MockGenerator, MockMutator,
    MockObjectiveProvider, MockObserver, MockSlowEvaluator,
)

BASELINE_FAMILY = "baseline"


@dataclass
class RunSummary:
    experiment_id: str
    mode: str
    labels: list[str] = field(default_factory=list)
    generations_run: int = 0
    champion_id: Optional[str] = None
    proxy_leader_id: Optional[str] = None
    stop_reason: str = "completed"
    fast_evals: int = 0
    slow_evals: int = 0
    cost_usd: Optional[float] = 0.0
    cost_accounting: dict = field(default_factory=dict)
    failure_reason: Optional[str] = None
    insight: Optional[str] = None      # Explore Mode deliverable


class LoopController:
    def __init__(self, *, provider: ObjectiveProvider, generator: Generator,
                 mutator: Mutator, executor: Executor,
                 fast_evaluator: FastEvaluator,
                 slow_evaluator: Optional[SlowEvaluator],
                 comparator, slow_comparator,
                 gate: PromotionGate, journal: Journal, observer: Observer,
                 feedback_engine: FeedbackEngine,
                 registry: PluginRegistry,
                 quotas: dict[str, int], generations: int,
                 baseline_results: Optional[
                     tuple[EvaluationResult, Optional[EvaluationResult]]] = None,
                 resume_state: Optional[
                     tuple[Candidate, EvaluationResult,
                           Optional[EvaluationResult]]] = None,
                 stop_check=None, proxy_iteration: bool = False, budget_ledger=None):
        self.provider = provider
        self.generator = generator
        self.mutator = mutator
        self.executor = executor
        self.fast_evaluator = fast_evaluator
        self.slow_evaluator = slow_evaluator
        self.comparator = comparator
        self.slow_comparator = slow_comparator
        self.gate = gate
        self.journal = journal
        self.observer = observer
        self.feedback_engine = feedback_engine
        self.registry = registry
        self.quotas = {m: int(quotas.get(m, 0)) for m in MODES}
        self.generations = generations

        self._seq = 0
        self._fast_evals = 0
        self._slow_evals = 0
        self.budget_ledger = budget_ledger
        self._failure_cost_base = 0.0
        self._resource_stop = None
        self._cost = 0.0
        self._unknown_cost = False
        self._started = None
        self._state: dict[str, dict[str, Any]] = {}
        self._champion: Optional[Candidate] = None
        self._champion_fast: Optional[EvaluationResult] = None
        self._champion_slow: Optional[EvaluationResult] = None
        # pre-measured baseline (e.g. seeded from a calibration run) — skips
        # re-running paid sessions for a frozen quantity
        self._baseline_results = baseline_results
        # resume: (champion candidate, its fast result, its slow result)
        # restored from an existing journal; the loop continues at
        # champion.generation + 1 instead of re-running the baseline
        self._resume_state = resume_state
        self._stop_check = stop_check
        self._proxy_iteration = proxy_iteration  # explicit single-loop comparison control

    # ---- plumbing ----

    def _next_id(self) -> str:
        self._seq += 1
        return f"dl-{self._seq:04d}"

    def _journal(self, candidate: Candidate, **updates) -> None:
        st = self._state.setdefault(candidate.id, {})
        st.update(updates)
        self.journal.record(JournalEntry(
            experiment_id=candidate.experiment_id, candidate_id=candidate.id,
            parent_id=candidate.parent_id, generation=candidate.generation,
            family=candidate.family, mode=candidate.mode,
            hypothesis=candidate.hypothesis,
            delta_ref=st.get("delta_ref", ""),
            fast=st.get("fast"), fast_rank=st.get("fast_rank"),
            promotion_decision=st.get("promotion_decision"),
            slow=st.get("slow"), slow_decision=st.get("slow_decision"),
            constraint_violations=st.get("constraint_violations", []),
            failure_reason=st.get("failure_reason"),
            status=st.get("status", "proposed"),
            delta=candidate.delta.to_dict(),
        ))

    def _fail(self, candidate: Candidate, where: str, exc: Exception,
              tier: str = "fast") -> None:
        """Fail closed: journal ok=false with failure_reason, loop continues."""
        plugin = getattr(self, where, None)
        failure_cost = 0.0 if where == "mutator" else getattr(plugin, "failure_cost_usd", None)
        if self.budget_ledger is not None and where != 'mutator':
            snapshot = self.budget_ledger.snapshot()
            failure_cost = (None if snapshot['cost_usd'] is None else
                            round(snapshot['known_cost_usd'] - self._failure_cost_base, 9))
            if isinstance(exc, BudgetExhausted):
                self._resource_stop = snapshot.get('blocked_reason') or (
                    'budget:unknown_cost' if failure_cost is None else 'budget:admission_refused')
        if failure_cost is None:
            self._unknown_cost = True
        elif self.budget_ledger is None:
            self._cost += failure_cost
        failed = EvaluationResult(candidate_id=candidate.id,
                                  evaluator_id=where, tier=tier, ok=False,
                                  cost_usd=failure_cost)  # type: ignore[arg-type]
        self._journal(candidate, status="error",
                      failure_reason=f"{where}: {exc}",
                      **{tier: failed})
        self.observer.on_event("fail_closed", {"candidate": candidate.id,
                                               "where": where, "error": str(exc)})

    def _budget_stop(self, contract: ObjectiveContract) -> Optional[str]:
        if self.budget_ledger is not None:
            snapshot = self.budget_ledger.snapshot()
            self._cost = snapshot['known_cost_usd']
            if snapshot.get('blocked_reason'):
                return snapshot['blocked_reason']
            if snapshot['cost_usd'] is None:
                return 'budget:unknown_cost'
            if snapshot['known_cost_usd'] >= snapshot['max_cost_usd']:
                return 'budget:max_cost'
        if self._resource_stop:
            return self._resource_stop
        if self._stop_check and (stop := self._stop_check()):
            return stop
        hours = contract.budget.max_wall_time_hours
        if hours is not None and self._started is not None and (
                time.monotonic() - self._started >= hours * 3600):
            return "budget:max_wall_time_hours"
        if self._fast_evals >= contract.budget.max_fast_evals:
            return "budget:max_fast_evals"
        if self._unknown_cost:
            return "budget:unknown_cost"
        if self._cost > contract.budget.max_cost or (
                contract.budget.max_cost > 0 and self._cost == contract.budget.max_cost):
            return "budget:max_cost"
        return None

    # ---- phases ----

    def _evaluate(self, candidate: Candidate, tier: str) -> Optional[EvaluationResult]:
        """Mutator -> Executor -> Evaluator, fail closed at every step."""
        if self.budget_ledger is not None:
            self._failure_cost_base = self.budget_ledger.known_cost_usd
        try:
            if candidate.generation > 0 and (
                    self._champion is None or candidate.parent_id != self._champion.id):
                raise ValueError("candidate parent does not match the current champion")
            applied = self.mutator.apply(candidate, self._champion)
        except Exception as exc:
            self._fail(candidate, "mutator", exc, tier)
            return None
        # Reserve the attempt before work starts; exceptions can consume
        # resources too and must not open an unbounded retry path.
        if tier == "fast":
            self._fast_evals += 1
        else:
            self._slow_evals += 1
        try:
            artifact = self.executor.run(candidate, applied)
        except Exception as exc:
            self._fail(candidate, "executor", exc, tier)
            return None
        evaluator = self.fast_evaluator if tier == "fast" else self.slow_evaluator
        try:
            result = evaluator.evaluate(candidate, artifact)
        except Exception as exc:
            self._fail(candidate, f"{tier}_evaluator", exc, tier)
            return None
        if result.cost_usd is None:
            self._unknown_cost = True
        elif self.budget_ledger is None:
            self._cost += result.cost_usd
        if not result.ok:
            self._journal(candidate, status="error", failure_reason=f"{tier}_evaluator: returned ok=false",
                          **{tier: result})
            self.observer.on_event("fail_closed", {"candidate": candidate.id,
                                                   "where": f"{tier}_evaluator",
                                                   "error": "returned ok=false"})
        return result

    def _evaluate_baseline(self, contract: ObjectiveContract,
                           full_loop: bool) -> Candidate:
        baseline = Candidate(
            id=self._next_id(), experiment_id=contract.id, parent_id=None,
            generation=0, family=BASELINE_FAMILY, mode="exploit",
            hypothesis="baseline: default configuration calibrates the ruler",
            delta=Delta(kind="identity", target=contract.target.ref, patch={},
                        description="baseline"),
        )
        self._journal(baseline, status="proposed",
                      delta_ref=baseline.delta.content_key())
        if self._baseline_results is not None:
            # seeded baseline (frozen measurement, e.g. from calibration):
            # no sessions are spent re-measuring it
            fast, slow = self._baseline_results
            fast = EvaluationResult.from_dict(
                {**fast.to_dict(), "candidate_id": baseline.id})
            self._journal(baseline, status="fast_evaluated", fast=fast)
            self._champion, self._champion_fast = baseline, fast
            if full_loop:
                if slow is None or not slow.ok:
                    raise RuntimeError("baseline slow evaluation failed: "
                                       "infrastructure problem, refusing to start")
                slow = EvaluationResult.from_dict(
                    {**slow.to_dict(), "candidate_id": baseline.id})
                self._journal(baseline, status="champion", slow=slow,
                              slow_decision="champion")
                self._champion_slow = slow
                self.observer.on_event("champion", {"candidate": baseline.id,
                                                    "via": "baseline"})
            return baseline
        fast = self._evaluate(baseline, "fast")
        if fast is None or not fast.ok:
            raise RuntimeError("baseline fast evaluation failed: infrastructure "
                               "problem, refusing to start the loop")
        self._journal(baseline, status="fast_evaluated", fast=fast)
        self._champion, self._champion_fast = baseline, fast
        if full_loop:
            slow = self._evaluate(baseline, "slow")
            if slow is None or not slow.ok:
                raise RuntimeError("baseline slow evaluation failed: "
                                   "infrastructure problem, refusing to start")
            # the baseline is the initial champion by definition
            self._journal(baseline, status="champion", slow=slow,
                          slow_decision="champion")
            self._champion_slow = slow
            self.observer.on_event("champion", {"candidate": baseline.id,
                                                "via": "baseline"})
        return baseline

    def _run_generation(self, contract: ObjectiveContract, generation: int,
                        quotas: dict[str, int],
                        feedback: FeedbackSummary) -> Optional[str]:
        """One fast-loop generation + slow-loop validation.
        Returns a stop reason if a budget ran out mid-state, else None."""
        assert self._champion is not None
        if (stop := self._budget_stop(contract)):
            return stop
        if self.budget_ledger is not None:
            self._failure_cost_base = self.budget_ledger.known_cost_usd
        try:
            candidates = self.generator.propose(
                self._champion, feedback, quotas, generation, self._next_id)
        except Exception as exc:
            ghost = Candidate(id=self._next_id(), experiment_id=contract.id,
                              parent_id=self._champion.id, generation=generation,
                              family="unknown", mode="exploit", hypothesis="",
                              delta=Delta(kind="none", target="", patch={}))
            self._fail(ghost, "generator", exc)
            return self._budget_stop(contract)
        for c in candidates:
            c.experiment_id = contract.id
        if not candidates:
            return "no_candidates"

        # GENERATING -> EXECUTING -> FAST_EVALUATING
        fast_results: list[EvaluationResult] = []
        for c in candidates:
            if (stop := self._budget_stop(contract)):
                return stop
            self._journal(c, status="proposed",
                          delta_ref=hashlib.sha256(
                              c.delta.content_key().encode()).hexdigest()[:12])
            result = self._evaluate(c, "fast")
            if result is None:
                continue  # already journaled ok=false by _fail
            self._journal(c, status="fast_evaluated" if result.ok else "error", fast=result)
            fast_results.append(result)
            self.observer.on_event("fast_evaluated", {
                "candidate": c.id, "family": c.family, "mode": c.mode,
                "metrics": result.metrics})

        if not fast_results:
            return "budget:unknown_cost" if self._unknown_cost else (
                self._stop_check() if self._stop_check else None)
        if self._stop_check and (stop := self._stop_check()):
            return stop
        if self._unknown_cost:
            return "budget:unknown_cost"

        # COMPARING (fast tier; incumbent = champion's fast result)
        pool = fast_results + ([self._champion_fast] if self._champion_fast else [])
        comparison = self.comparator.compare(pool, contract.constraints,
                                             incumbent_id=self._champion.id)
        rank_of = {cid: i + 1 for i, cid in enumerate(comparison.ranking)}
        for c in candidates:
            if c.id in rank_of:
                self._journal(c, fast_rank=rank_of[c.id])
        self.observer.on_event("fast_comparison", {
            "generation": generation, "ranking": comparison.ranking,
            "rationale": comparison.rationale})

        # PROMOTING -> SLOW_EVALUATING -> champion decision (full loop only)
        if self.slow_evaluator is None or self._champion_slow is None:
            if self._proxy_iteration:
                winner = next((cid for cid in comparison.ranking
                               if comparison.verdicts.get(cid) == "better" and
                               cid in {c.id for c in candidates}), None)
                if winner:
                    self._champion = next(c for c in candidates if c.id == winner)
                    self._champion_fast = next(r for r in fast_results if r.candidate_id == winner)
            return None  # fast-only: no champion crowned on proxy evidence
        remaining = contract.budget.max_slow_evals - self._slow_evals
        promoted, decisions = self.gate.select(
            comparison, [c.id for c in candidates], remaining)
        by_id = {c.id: c for c in candidates}
        for cid, decision in decisions.items():
            self._journal(by_id[cid], promotion_decision=decision)
        slow_results: list[EvaluationResult] = []
        for cid in promoted:
            if self._unknown_cost:
                return "budget:unknown_cost"
            if self._stop_check and (stop := self._stop_check()):
                return stop
            if self._slow_evals >= contract.budget.max_slow_evals:
                self._journal(by_id[cid], promotion_decision="held")
                continue
            if self._cost > contract.budget.max_cost or (
                    contract.budget.max_cost > 0 and self._cost == contract.budget.max_cost):
                self._journal(by_id[cid], promotion_decision="held")
                return "budget:max_cost"
            c = by_id[cid]
            result = self._evaluate(c, "slow")
            if result is None:
                continue
            self._journal(c, status="slow_evaluated" if result.ok else "error", slow=result)
            self.observer.on_event("slow_evaluated", {"candidate": c.id, "metrics": result.metrics})
            slow_results.append(result)

        if not slow_results:
            return "budget:unknown_cost" if self._unknown_cost else (
                self._stop_check() if self._stop_check else None)
        if self._unknown_cost:
            return "budget:unknown_cost"
        if self._stop_check and (stop := self._stop_check()):
            return stop

        # COMPARING (slow tier, vs champion on the upper objective)
        slow_comparison = self.slow_comparator.compare(
            slow_results + [self._champion_slow], contract.constraints,
            incumbent_id=self._champion.id)
        winner = next((cid for cid in slow_comparison.ranking
                       if cid in by_id and
                       slow_comparison.verdicts.get(cid) == "better"), None)
        for cid in [r.candidate_id for r in slow_results]:
            c = by_id[cid]
            verdict = slow_comparison.verdicts.get(cid, "worse")
            if cid == winner:
                self._journal(c, status="champion", slow_decision="champion")
                self._champion = c
                self._champion_fast = next(
                    r for r in fast_results if r.candidate_id == cid)
                self._champion_slow = next(
                    r for r in slow_results if r.candidate_id == cid)
                self.observer.on_event("champion", {
                    "candidate": cid, "generation": generation,
                    "slow_metrics": self._champion_slow.metrics})
            elif verdict == "better":
                self._journal(c, status="slow_evaluated", slow_decision="accepted")
            else:
                violations = []
                if verdict == "constraint_violation":
                    violations = [slow_comparison.rationale]
                self._journal(c, status="rejected", slow_decision="rejected",
                              constraint_violations=violations)
        self.observer.on_event("slow_comparison", {
            "generation": generation, "verdicts": slow_comparison.verdicts,
            "rationale": slow_comparison.rationale})
        return None

    # ---- modes ----

    def _resume(self) -> int:
        """Restore champion state from a previous run's journal and return
        the generation number to CONTINUE at (champion.generation + 1).
        The journal is the state; nothing is re-measured."""
        assert self._resume_state is not None
        champ, fast, slow = self._resume_state
        max_seq = 0
        for e in self.journal.latest().values():
            m = re.match(r"dl-(\d+)$", e.candidate_id)
            if m:
                max_seq = max(max_seq, int(m.group(1)))
        self._seq = max_seq
        self._champion, self._champion_fast, self._champion_slow = champ, fast, slow
        self.observer.on_event("resumed", {
            "champion": champ.id, "champion_generation": champ.generation,
            "continue_at": champ.generation + 1,
            "slow_core": (slow.metrics.get("core_success") if slow else None)})
        return champ.generation + 1

    def run(self) -> RunSummary:
        try:
            summary = self._run_impl()
        except Exception as exc:
            if self.budget_ledger is None:
                raise
            contract = getattr(self, '_active_contract', None)
            summary = RunSummary(experiment_id=contract.id if contract else 'unknown',
                                 mode=getattr(self, '_active_mode', 'unknown'),
                                 stop_reason=self._resource_stop or f'failure:{type(exc).__name__}',
                                 failure_reason=str(exc))
        summary.fast_evals, summary.slow_evals = self._fast_evals, self._slow_evals
        if self.budget_ledger is not None:
            try:
                snapshot = self.budget_ledger.snapshot()
                summary.cost_usd = None if self._unknown_cost else snapshot['cost_usd']
                summary.cost_accounting = {key: snapshot[key] for key in
                    ('ledger_id', 'known_cost_usd', 'reserved_cost_usd', 'max_cost_usd',
                     'phases', 'sessions_used', 'blocked_reason')}
                summary.cost_accounting.update(scope='cumulative_ledger',
                    ledger_path=str(self.budget_ledger.path.resolve()),
                    pricing='historical_estimate', seeded_calibration_included=False)
                if summary.stop_reason in ('completed', 'no_candidates'):
                    summary.stop_reason = snapshot.get('blocked_reason') or self._resource_stop or (
                        'budget:unknown_cost' if summary.cost_usd is None else summary.stop_reason)
            except (OSError, ValueError) as exc:
                summary.cost_usd = None
                summary.stop_reason = 'budget:unreadable_ledger'
                summary.failure_reason = str(exc)
        else:
            summary.cost_usd = None if self._unknown_cost else round(self._cost, 4)
        try:
            self.observer.on_event('run_summary', summary.__dict__.copy())
        except Exception as exc:
            if self.budget_ledger is None:
                raise
            summary.stop_reason = 'failure:observer'
            summary.failure_reason = '; '.join(filter(None, (summary.failure_reason, str(exc))))
        return summary

    def _run_impl(self) -> RunSummary:
        self._started = time.monotonic()
        if self._resume_state is None and self.journal.read():
            raise RuntimeError("existing journal: inspect or explicitly reconcile resume; "
                               "refusing to restart with colliding candidate ids")
        contract = self.provider.load()
        self._active_contract = contract
        validation = self.provider.validate(contract, self.registry)
        self._active_mode = validation.mode
        self.observer.on_event("mode", {"mode": validation.mode,
                                        "labels": validation.labels})
        if validation.mode == "explore":
            return self._run_explore(contract, validation.labels)
        full_loop = validation.mode == "optimize"
        summary = RunSummary(experiment_id=contract.id, mode=validation.mode,
                             labels=list(validation.labels))
        if (stop := self._budget_stop(contract)):
            summary.stop_reason = stop
            return summary
        if self._resume_state is not None:
            start_generation = self._resume()
        else:
            self._evaluate_baseline(contract, full_loop)
            start_generation = 1

        for generation in range(start_generation, self.generations + 1):
            feedback = (self._feedback(contract) if full_loop
                        else FeedbackSummary(
                            suggested_emphasis=dict(self.quotas)))
            quotas = (feedback.suggested_emphasis if full_loop
                      else dict(self.quotas))
            stop = self._run_generation(contract, generation, quotas, feedback)
            summary.generations_run = generation
            if stop:
                summary.stop_reason = stop
                break

        summary.fast_evals = self._fast_evals
        summary.slow_evals = self._slow_evals
        summary.cost_usd = None if self._unknown_cost else round(self._cost, 4)
        if full_loop:
            summary.champion_id = self._champion.id if self._champion else None
        else:
            # fast-only: a proxy LEADER, never a champion (PROXY_ONLY_LABEL)
            summary.proxy_leader_id = self._proxy_leader(contract)
            if PROXY_ONLY_LABEL not in summary.labels:
                summary.labels.append(PROXY_ONLY_LABEL)
        return summary

    def _feedback(self, contract: ObjectiveContract) -> FeedbackSummary:
        fast_metrics = [o.metric for o in contract.lower_objectives]
        return self.feedback_engine.compute(
            list(self.journal.latest().values()),
            fast_metrics=fast_metrics,
            upper_metric=contract.upper_metric or "",
            base_emphasis=self.quotas)

    def _proxy_leader(self, contract: ObjectiveContract) -> Optional[str]:
        if self._proxy_iteration and self._champion:
            return self._champion.id
        pool = [e.fast for e in self.journal.latest().values() if e.fast and e.fast.ok]
        comparison = self.comparator.compare(pool, contract.constraints)
        return next((cid for cid in comparison.ranking
                     if comparison.verdicts.get(cid) == "better"), None)

    def _run_explore(self, contract: ObjectiveContract,
                     labels: list[str]) -> RunSummary:
        """Explore Mode: generate alternatives -> collect evidence -> surface
        hypotheses. Deliverable is insight, never a fabricated ranking."""
        summary = RunSummary(experiment_id=contract.id, mode="explore",
                             labels=labels or [EXPLORE_LABEL])
        if stop := self._budget_stop(contract):
            summary.stop_reason = stop
            return summary
        self._evaluate_baseline(contract, full_loop=False)
        if stop := self._budget_stop(contract):
            summary.stop_reason = stop
            return summary
        if self.budget_ledger is not None:
            self._failure_cost_base = self.budget_ledger.known_cost_usd
        feedback = FeedbackSummary(suggested_emphasis=dict(self.quotas))
        candidates = self.generator.propose(self._champion, feedback,
                                            self.quotas, 1, self._next_id)
        for c in candidates:
            c.experiment_id = contract.id
            if (stop := self._budget_stop(contract)):
                summary.stop_reason = stop
                break
            self._journal(c, status="proposed")
            result = self._evaluate(c, "fast")
            if result is not None:
                self._journal(c, status="fast_evaluated", fast=result)
        summary.generations_run = 1
        summary.fast_evals = self._fast_evals
        summary.slow_evals = self._slow_evals
        summary.cost_usd = None if self._unknown_cost else round(self._cost, 4)
        families = sorted({c.family for c in candidates})
        summary.insight = (f"candidates cluster into {len(families)} behavioral "
                           f"families: {families}; metric "
                           f"{contract.primary_metric} discriminates them")
        self.observer.on_event("explore_insight", {"insight": summary.insight})
        return summary


def build_controller(config: dict, journal_dir) -> LoopController:
    """Wire an experiment config (e.g. research/experiments/mock.yml) into a controller."""
    plugins = config.get("plugins") or {}
    if plugins and plugins.get("fast_evaluator") != "mock":
        from .real_wiring import build_real_controller  # lazy: avoids a cycle
        return build_real_controller(config, journal_dir)
    seed = int(config.get("seed", 0))
    families = list(config.get("families", []))
    trap = config.get("proxy_trap_family", "")
    contract_source = config["contract"]
    provider = MockObjectiveProvider(contract_source)
    contract = provider.load()

    fb_cfg = config.get("feedback") or {}
    comparison_cfg = (contract.comparison.config if contract.comparison else {})
    slow_weights = comparison_cfg.get("slow_weights") or (
        {contract.upper_metric: 1.0} if contract.upper_metric else {})
    comparator = WeightedComparator(comparison_cfg)
    slow_comparator = WeightedComparator({**comparison_cfg, "weights": slow_weights})

    registry = PluginRegistry(
        evaluators={"mock_fast", "mock_slow"},
        comparators={"weighted_v1"},
        executors={"mock"},
        baselines=set(config.get("resolvable_baselines", ["git:HEAD"])),
    )
    return LoopController(
        provider=provider,
        generator=MockGenerator(seed=seed, families=families),
        mutator=MockMutator(),
        executor=MockExecutor(
            fail_for_families=set(config.get("executor_fail_for_families", []))),
        fast_evaluator=MockFastEvaluator(seed=seed, trap_family=trap),
        slow_evaluator=(MockSlowEvaluator(seed=seed, trap_family=trap)
                        if contract.upper_objective else None),
        comparator=comparator, slow_comparator=slow_comparator,
        gate=TopKPromotionGate(top_k=int((config.get("promotion") or {}).get("top_k", 2))),
        journal=JsonlJournal(journal_dir),
        observer=MockObserver(verbose=bool(config.get("verbose", False))),
        feedback_engine=FeedbackEngine(
            slow_failure_threshold=int(fb_cfg.get("slow_failure_threshold", 2)),
            min_sample_size=int(fb_cfg.get("min_sample_size", 4)),
            max_emphasis_shift=int(fb_cfg.get("max_emphasis_shift", 1))),
        registry=registry,
        quotas=dict(config.get("quotas") or {}),
        generations=int(config.get("generations", 3)),
    )
