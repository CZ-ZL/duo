"""Real (non-mock) wiring for the docs_qa demo experiment.

build_real_controller() wires the frozen contract (experiments/docs_qa.yml)
to the real plugins: LlmDocsQaGenerator (proposer on the `headless` profile),
SystemPromptMutator (cordis overlay + guardrails), DshDocsQaExecutor
(sandboxed headless sessions), DocsQaFast/SlowEvaluator (dev/holdout), the
deterministic comparator/gate/journal/feedback stack.

Baseline seeding: the baseline was ALREADY measured under the frozen prompt
and benchmark during calibration (runs/v2/). Re-running it would burn 32+24
paid sessions to re-measure a frozen quantity, so the run seeds the baseline
from those details files instead (cost_usd=0 in THIS run's budget — that
spend is accounted in the calibration ledger, see runs/CALIBRATION.md §8).
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Optional

from .comparator import TopKPromotionGate, WeightedComparator
from .contract import PluginRegistry
from .controller import LoopController
from .feedback import FeedbackEngine
from .journal import JsonlJournal
from .models import EvaluationResult
from .plugins.docs_qa_evaluator import (
    DocsQaFastEvaluator, DocsQaSlowEvaluator, _aggregate,
)
from .plugins.docs_qa_target import SystemPromptMutator
from .plugins.dsh_executor import DshDocsQaExecutor
from .plugins.llm_generator import LlmDocsQaGenerator, ProposerRunner
from .plugins.mock import MockObjectiveProvider, MockObserver
from .runtime.budget import SessionBudget

ROOT = Path(__file__).resolve().parent.parent
BENCH = ROOT / "benchmarks" / "docs_qa"
CORPUS = Path("/home/agent/.openclaw/workspace/Research OS/"
              "deepseek_harness/upstream/docs")


def seed_baseline_result(details_file: str | Path, tier: str,
                         question_ids: list[str] | None = None) -> EvaluationResult:
    """Rebuild an EvaluationResult from a calibration details JSON.

    Metrics are RECOMPUTED from the per-question details (so core_success and
    the other post-calibration metrics exist even for files written before
    they were introduced). `question_ids` filters the details to a subset —
    required when the run's fast tier evaluates a subset (Amendment A1) so
    the seeded baseline is comparable to candidate fast evals.
    cost_usd=0: the spend is already accounted in the calibration ledger;
    the demo budget covers only this run's marginal cost.
    """
    payload = json.loads(Path(details_file).read_text(encoding="utf-8"))
    details = payload["details"]
    if question_ids is not None:
        want = set(question_ids)
        details = [d for d in details if d["id"] in want]
        missing = want - {d["id"] for d in details}
        if missing:
            raise ValueError(f"{details_file}: no calibration details for "
                             f"subset ids {sorted(missing)}")
    metrics = _aggregate(details)
    if payload.get("tier") == "slow":
        violations = sum(len(d.get("procedure_violations", [])) for d in details)
        cited = sum(d.get("n_cited", 0) for d in details)
        metrics["procedure_violations"] = float(violations)
        metrics["procedure_compliance"] = (
            round((cited - violations) / cited, 4) if cited else 1.0)
    return EvaluationResult(
        candidate_id="baseline",  # remapped by the controller
        evaluator_id=payload.get("evaluator_id", f"seeded_{tier}"),
        tier=tier, ok=True, metrics=metrics,
        artifacts=[str(details_file)], cost_usd=0.0, wall_time_s=0.0,
    )


def build_real_controller(config: dict, journal_dir) -> LoopController:
    provider = MockObjectiveProvider(config["contract"])  # generic YAML loader
    contract = provider.load()

    reservations = config.get('session_reservations_usd')
    if (not isinstance(reservations, dict) or
            any(type(reservations.get(phase)) not in (int, float) or
                not math.isfinite(reservations[phase]) or reservations[phase] <= 0
                for phase in ('generation', 'evaluation'))):
        raise ValueError('real wiring requires explicit positive session_reservations_usd for generation and evaluation')
    if not math.isfinite(contract.budget.max_cost) or contract.budget.max_cost < 0:
        raise ValueError('real wiring requires a finite nonnegative contract amount limit')
    journal_dir = Path(journal_dir)
    budget = SessionBudget(
        config.get("session_budget_file",
                   str(journal_dir / "session_budget.json")),
        cap=int(config.get("session_cap", 10 ** 9)), max_cost_usd=contract.budget.max_cost)
    journal = JsonlJournal(journal_dir)

    executor = DshDocsQaExecutor(
        corpus_dir=CORPUS, budget=budget, reservation_usd=reservations["evaluation"],
        timeout_s=int(config.get("timeout_s", 180)))
    mutator = SystemPromptMutator(patch_dir=journal_dir / "patches")
    runner = ProposerRunner(
        profile=config.get("proposer_profile", "headless"), budget=budget,
        reservation_usd=reservations["generation"])
    generator = LlmDocsQaGenerator(
        runner=runner, families=list(config.get("families", [])),
        journal=journal, constraints=contract.constraints)

    pool_size = int(config.get("pool_size", 6))
    fast_question_ids = config.get("fast_question_ids")  # A1 subset, or None
    fast_evaluator = DocsQaFastEvaluator(
        executor=executor, questions_path=BENCH / "questions.dev.yml",
        corpus_root=CORPUS, details_dir=journal_dir / "details",
        question_ids=fast_question_ids, pool_size=pool_size)
    slow_evaluator = DocsQaSlowEvaluator(
        executor=executor, questions_path=BENCH / "questions.holdout.yml",
        corpus_root=CORPUS, details_dir=journal_dir / "details",
        pool_size=pool_size)

    comparison_cfg = (contract.comparison.config if contract.comparison else {})
    slow_weights = comparison_cfg.get("slow_weights") or (
        {contract.upper_metric: 1.0} if contract.upper_metric else {})
    comparator = WeightedComparator(comparison_cfg)
    slow_comparator = WeightedComparator({**comparison_cfg, "weights": slow_weights})

    registry = PluginRegistry(
        evaluators={fast_evaluator.evaluator_id, slow_evaluator.evaluator_id},
        comparators={"weighted_v1"},
        executors={"dsh_docs_qa"},
        baselines=set(config.get("resolvable_baselines", [])),
    )

    baseline_results: Optional[tuple[EvaluationResult, Optional[EvaluationResult]]] = None
    frozen = config.get("frozen_baseline") or {}
    if frozen.get("fast_details"):
        fast_seed = seed_baseline_result(frozen["fast_details"], "fast",
                                         question_ids=fast_question_ids)
        slow_seed = (seed_baseline_result(frozen["slow_details"], "slow")
                     if frozen.get("slow_details") else None)
        baseline_results = (fast_seed, slow_seed)

    resume_state = _build_resume_state(config, journal_dir, journal) \
        if config.get("resume") else None

    fb_cfg = config.get("feedback") or {}
    return LoopController(
        provider=provider,
        generator=generator,
        mutator=mutator,
        executor=executor,
        fast_evaluator=fast_evaluator,
        slow_evaluator=slow_evaluator if contract.upper_objective else None,
        comparator=comparator, slow_comparator=slow_comparator,
        gate=TopKPromotionGate(
            top_k=int((config.get("promotion") or {}).get("top_k", 2))),
        journal=journal,
        observer=MockObserver(verbose=bool(config.get("verbose", False))),
        feedback_engine=FeedbackEngine(
            slow_failure_threshold=int(fb_cfg.get("slow_failure_threshold", 2)),
            min_sample_size=int(fb_cfg.get("min_sample_size", 4)),
            max_emphasis_shift=int(fb_cfg.get("max_emphasis_shift", 1))),
        registry=registry,
        quotas=dict(config.get("quotas") or {}),
        generations=int(config.get("generations", 3)),
        baseline_results=baseline_results,
        resume_state=resume_state, budget_ledger=budget,
    )


def _build_resume_state(config: dict, journal_dir: Path,
                        journal: JsonlJournal):
    """Reconstruct the incumbent champion from an existing journal so the
    loop continues at the next generation. The journal is the state; the
    champion's persona is recovered from its mutator patch file (baseline
    champion => no patch => the profile default persona)."""
    import yaml as _yaml

    from .models import Candidate, Delta

    latest = journal.latest()
    champs = [e for e in latest.values() if e.slow_decision == "champion"]
    if not champs:
        raise RuntimeError("resume requested but the journal has no champion "
                           "— run without `resume` to start from the baseline")
    ce = max(champs, key=lambda e: (e.generation, e.ts))
    persona = None
    patch_file = journal_dir / "patches" / f"{ce.candidate_id}.yml"
    if patch_file.exists():
        entries = _yaml.safe_load(patch_file.read_text(encoding="utf-8")) or []
        persona = next((e.get("config", {}).get("persona")
                        for e in entries
                        if isinstance(e, dict) and e.get("id") == "system-prompt"),
                       None)
    champion = Candidate(
        id=ce.candidate_id, experiment_id=ce.experiment_id,
        parent_id=ce.parent_id, generation=ce.generation, family=ce.family,
        mode=ce.mode, hypothesis=ce.hypothesis, hypothesis_first=True,
        delta=Delta(kind="cordis-overlay", target="system-prompt",
                    patch={"persona": persona} if persona else {},
                    description="resumed champion"),
    )
    if ce.fast is None or ce.slow is None:
        raise RuntimeError(f"resume: champion {ce.candidate_id} lacks "
                           "fast/slow results in the journal")
    return (champion, ce.fast, ce.slow)
