"""Plugin contracts (DESIGN.md "Plugin Architecture").

Everything is a plugin; the Dual-Loop Protocol is the fixed core. Contracts
are typed interfaces (typing.Protocol), not duck-typed conventions — a v1
lesson: duck typing hid interface drift.

Safety-critical pieces (contract validity, budgets, comparator, promotion
finality) are plain deterministic code, never LLM-mediated.
"""
from __future__ import annotations

from typing import Any, Optional, Protocol, runtime_checkable

from ..contract import ObjectiveContract, PluginRegistry, ValidationResult
from ..models import (
    Candidate, ComparisonResult, EvaluationResult, FeedbackSummary, JournalEntry,
)


@runtime_checkable
class ObjectiveProvider(Protocol):
    """Load/validate an Objective Contract; expose the validity check."""

    def load(self) -> ObjectiveContract: ...

    def validate(self, contract: ObjectiveContract,
                 registry: PluginRegistry) -> ValidationResult: ...


@runtime_checkable
class Generator(Protocol):
    """Propose candidates from champion + FeedbackSummary, honoring the
    diversity quotas ASSIGNED by the LoopController (modes are never
    self-reported). Hypothesis output comes first, delta second (audit A5)."""

    def propose(self, champion: Optional[Candidate],
                feedback: FeedbackSummary,
                quotas: dict[str, int],       # mode -> count, controller-assigned
                generation: int,
                next_id,                       # callable() -> candidate id
                ) -> list[Candidate]: ...


@runtime_checkable
class Mutator(Protocol):
    """Apply/validate a candidate's delta against its parent.

    Rejects candidates without a prior hypothesis (hypothesis-before-delta)."""

    def apply(self, candidate: Candidate, parent: Optional[Candidate]) -> Any: ...


@runtime_checkable
class Executor(Protocol):
    """Actually run a candidate (in real mode: DSH headless sessions)."""

    def run(self, candidate: Candidate, applied: Any) -> Any: ...


@runtime_checkable
class FastEvaluator(Protocol):
    """Cheap, low-fidelity evidence. Metric dict only, never a verdict."""

    evaluator_id: str

    def evaluate(self, candidate: Candidate, run_artifact: Any) -> EvaluationResult: ...


@runtime_checkable
class SlowEvaluator(Protocol):
    """Expensive, high-fidelity evidence closer to the North Star.

    Must include at least one evidence family different from the fast tier
    (audit A2). Metric dict only, never a verdict."""

    evaluator_id: str

    def evaluate(self, candidate: Candidate, run_artifact: Any) -> EvaluationResult: ...


@runtime_checkable
class Comparator(Protocol):
    """Decide "what is better" from metric dicts. Never an LLM."""

    comparator_id: str

    def compare(self, results: list[EvaluationResult],
                constraints: list,
                incumbent_id: Optional[str] = None) -> ComparisonResult: ...


@runtime_checkable
class PromotionGate(Protocol):
    """Which fast candidates are worth slow-eval money (top-k, budget-aware)."""

    def select(self, comparison: ComparisonResult,
               candidate_ids: list[str],
               slow_budget_remaining: int) -> tuple[list[str], dict[str, str]]: ...


@runtime_checkable
class Journal(Protocol):
    """Persistent shared experiment memory (append-only)."""

    def record(self, entry: JournalEntry) -> None: ...

    def read(self) -> list[JournalEntry]: ...

    def latest(self) -> dict[str, JournalEntry]: ...


@runtime_checkable
class Observer(Protocol):
    """Visualize lineage / fast-vs-slow / promotions. NEVER participates
    in truth decisions."""

    def on_event(self, event: str, payload: dict) -> None: ...
