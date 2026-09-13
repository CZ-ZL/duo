"""Deterministic offline mock plugins (DESIGN.md MVP "Mock mode").

Proves the PROTOCOL end-to-end without API calls: loop mechanics, mode gate,
promotion, feedback edge, fail-closed journaling. Scores are hash-derived
from delta content and carry no semantic meaning — except the designated
"proxy-trap" family, where fast and slow DELIBERATELY DISAGREE (fast-high,
slow-low), reproducing DESIGN.md's worked example A(0.91)/B(0.79) so the
Slow->Fast feedback edge can be regression-tested.

Everything is seeded/deterministic: same experiment file -> same run.
"""
from __future__ import annotations

import hashlib
import time
from pathlib import Path
from typing import Any, Callable, Optional

from ..contract import (
    ObjectiveContract, PluginRegistry, ValidationResult, load_contract,
    validate_contract,
)
from ..models import (
    Candidate, Delta, EvaluationResult, FeedbackSummary, Mode,
)


def _jitter(*parts: Any, mod: int, scale: int) -> float:
    digest = int(hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest(), 16)
    return (digest % mod) / scale


class MockObjectiveProvider:
    def __init__(self, source: str | Path | dict):
        self.source = source

    def load(self) -> ObjectiveContract:
        return load_contract(self.source)

    def validate(self, contract: ObjectiveContract,
                 registry: PluginRegistry) -> ValidationResult:
        return validate_contract(contract, registry)


class MockGenerator:
    """Three structurally distinct operators behind controller-assigned quotas:

    - exploit:  local perturbation of the CHAMPION's family
    - explore:  switch to a different mutation family (round-robin over the
                configured family pool, skipping families the FeedbackSummary
                has penalized — the observable Slow->Fast feedback effect)
    - innovate: compositional change, crossing two non-penalized families

    Hypothesis is emitted BEFORE the delta (hypothesis_first=True, audit A5).
    """

    failure_cost_usd = 0.0  # deterministic mock has no external billable work

    def __init__(self, seed: int, families: list[str]):
        if not families:
            raise ValueError("MockGenerator needs a non-empty family pool")
        self.seed = seed
        self.families = list(families)

    def _family_for_explore(self, generation: int, slot: int,
                            penalized: set[str]) -> str:
        n = len(self.families)
        for step in range(n):
            fam = self.families[(generation + slot + step) % n]
            if fam not in penalized:
                return fam
        return self.families[(generation + slot) % n]  # all penalized: give up deterministically

    def propose(self, champion: Optional[Candidate],
                feedback: FeedbackSummary,
                quotas: dict[str, int],
                generation: int,
                next_id: Callable[[], str]) -> list[Candidate]:
        penalized = set(feedback.penalized_families)
        free = [f for f in self.families if f not in penalized] or self.families
        candidates: list[Candidate] = []
        for mode, count in quotas.items():
            for i in range(count):
                if mode == "exploit":
                    family = champion.family if champion else self.families[0]
                    op = "local perturbation of champion family"
                elif mode == "explore":
                    family = self._family_for_explore(generation, i, penalized)
                    op = "switch mutation family / region"
                else:  # innovate
                    a = free[(generation + i) % len(free)]
                    b = free[(generation + i + 1) % len(free)]
                    family = f"{a}+{b}" if a != b else a
                    op = f"cross-domain composition of {a} x {b}"
                cid = next_id()
                content = f"{self.seed}|{generation}|{mode}|{family}|{i}|{cid}"
                hypothesis = (
                    f"[{mode}] {op}: {family} should raise the proxy objective "
                    f"because generation {generation} evidence suggests this "
                    f"region is underexplored (stated before any evaluation)."
                )
                candidates.append(Candidate(
                    id=cid,
                    experiment_id="",  # stamped by the controller
                    parent_id=champion.id if champion else None,
                    generation=generation,
                    family=family,
                    mode=mode,  # type: ignore[arg-type]  # assigned, not self-reported
                    hypothesis=hypothesis,
                    hypothesis_first=True,
                    delta=Delta(kind="prompt-section", target="instructions",
                                patch={"set": {"content": content}},
                                description=op),
                ))
        return candidates


class MockMutator:
    """Applies a delta as a text overlay. Enforces hypothesis-before-delta:
    a candidate without a prior hypothesis is REJECTED (audit A5)."""

    def apply(self, candidate: Candidate, parent: Optional[Candidate]) -> Any:
        if not candidate.hypothesis_first or not candidate.hypothesis.strip():
            raise ValueError(
                f"{candidate.id}: hypothesis must be stated before the delta")
        base = parent.delta.content_key() if parent else "baseline"
        return {"content": base + ">>" + candidate.delta.content_key()}


class MockExecutor:
    failure_cost_usd = 0.0
    """Echoes the applied artifact. `fail_for_families` simulates infra
    failure for fail-closed regression tests."""

    def __init__(self, fail_for_families: Optional[set[str]] = None):
        self.fail_for_families = fail_for_families or set()

    def run(self, candidate: Candidate, applied: Any) -> Any:
        if candidate.family in self.fail_for_families:
            raise RuntimeError(f"mock infra failure executing {candidate.id} "
                               f"(family {candidate.family})")
        return {"candidate_id": candidate.id, "output": applied["content"]}


class MockFastEvaluator:
    failure_cost_usd = 0.0
    """Dev-benchmark proxy. Hash of delta content -> metric dict.

    The proxy-trap family scores FAST-HIGH (>= 0.90) — it overfits the proxy.
    """

    evaluator_id = "mock_fast"

    def __init__(self, seed: int, trap_family: str):
        self.seed = seed
        self.trap_family = trap_family

    def evaluate(self, candidate: Candidate, run_artifact: Any) -> EvaluationResult:
        key = run_artifact["output"]
        if candidate.generation == 0:
            score = 0.50  # baseline calibrates the ruler
        elif candidate.family == self.trap_family:
            score = 0.90 + _jitter(self.seed, "fast", key, mod=80, scale=1000)
        else:
            score = 0.50 + _jitter(self.seed, "fast", key, mod=350, scale=1000)
        return EvaluationResult(
            candidate_id=candidate.id, evaluator_id=self.evaluator_id,
            tier="fast", ok=True,
            metrics={
                "dev_benchmark_score": round(score, 4),
                "avg_cost_usd": round(0.01 + _jitter("cost", key, mod=10, scale=10000), 4),
                "safety_pass": True,
                "sample_size": 30,
            },
            artifacts=[], cost_usd=0.01, wall_time_s=0.1, ts=time.time(),
        )


class MockSlowEvaluator:
    failure_cost_usd = 0.0
    """Holdout + stronger-judge stand-in (a DIFFERENT evidence family than
    fast, audit A2). DISAGREES with fast on the proxy-trap family:
    fast-high, slow-low (0.30-0.40) — the proxy trap from DESIGN.md."""

    evaluator_id = "mock_slow"

    def __init__(self, seed: int, trap_family: str):
        self.seed = seed
        self.trap_family = trap_family

    def evaluate(self, candidate: Candidate, run_artifact: Any) -> EvaluationResult:
        key = run_artifact["output"]
        if candidate.generation == 0:
            score = 0.50
        elif candidate.family == self.trap_family:
            score = 0.30 + _jitter(self.seed, "slow", key, mod=100, scale=1000)
        else:
            score = 0.55 + _jitter(self.seed, "slow", key, mod=250, scale=1000)
        return EvaluationResult(
            candidate_id=candidate.id, evaluator_id=self.evaluator_id,
            tier="slow", ok=True,
            metrics={
                "task_success_rate": round(score, 4),
                "avg_cost_usd": round(0.20 + _jitter("cost", "slow", key, mod=10, scale=10000), 4),
                "safety_pass": True,
                "sample_size": 60,
                "judge_rubric_mean": round(score - 0.02, 4),  # second evidence family
            },
            artifacts=[], cost_usd=0.20, wall_time_s=1.0, ts=time.time(),
        )


class MockObserver:
    """Collects events (and optionally prints). Never touches decisions."""

    def __init__(self, verbose: bool = False):
        self.verbose = verbose
        self.events: list[tuple[str, dict]] = []

    def on_event(self, event: str, payload: dict) -> None:
        self.events.append((event, payload))
        if self.verbose:
            print(f"[{event}] {payload}")
