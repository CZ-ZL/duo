"""Core data models (DESIGN.md "Core Data Models").

Metrics are always dictionaries; verdicts only ever appear in ComparisonResult.
All models are typed dataclasses with JSON round-trip support for the journal.
"""
from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Literal, Optional

Mode = Literal["exploit", "explore", "innovate"]
Tier = Literal["fast", "slow"]
Verdict = Literal["better", "worse", "incomparable", "constraint_violation"]
Status = Literal[
    "proposed", "fast_evaluated", "slow_evaluated", "champion", "rejected", "error"
]
PromotionDecision = Literal["promoted_to_slow", "held", "dropped"]
SlowDecision = Literal["accepted", "rejected", "champion"]

MODES: tuple[Mode, ...] = ("exploit", "explore", "innovate")


@dataclass
class Delta:
    """A candidate is a minimal patch against its parent, not a regenerated system."""

    kind: str                      # e.g. "prompt-section" | "config-patch"
    target: str                    # which part of the editable space it touches
    patch: dict[str, Any]
    description: str = ""
    parent_version: Optional[str] = None  # content digest when the target supports it

    def content_key(self) -> str:
        """Canonical string form; evaluators hash this, never verdicts."""
        return json.dumps(
            {"kind": self.kind, "target": self.target, "patch": self.patch},
            sort_keys=True,
        )

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Delta":
        return cls(kind=d["kind"], target=d["target"], patch=d["patch"],
                   description=d.get("description", ""),
                   parent_version=d.get("parent_version"))


@dataclass
class Candidate:
    id: str                        # dl-0007
    experiment_id: str
    parent_id: Optional[str]       # lineage
    generation: int
    family: str                    # mutation family, e.g. "retrieval-discipline"
    mode: Mode                     # ASSIGNED by the LoopController, never self-reported
    delta: Delta
    hypothesis: str                # why this should help, stated BEFORE the delta
    hypothesis_first: bool = True  # generator output ordering marker (audit A5)


@dataclass
class EvaluationResult:
    """Facts only. ok=False means infra failure, NOT a bad score."""

    candidate_id: str
    evaluator_id: str
    tier: Tier
    ok: bool
    metrics: dict[str, float | bool] = field(default_factory=dict)
    artifacts: list[str] = field(default_factory=list)
    cost_usd: Optional[float] = None  # missing cost is unknown, never a free operation
    wall_time_s: float = 0.0
    ts: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "EvaluationResult":
        return cls(
            candidate_id=d["candidate_id"], evaluator_id=d["evaluator_id"],
            tier=d["tier"], ok=d["ok"], metrics=d.get("metrics", {}),
            artifacts=d.get("artifacts", []), cost_usd=d.get("cost_usd"),
            wall_time_s=d.get("wall_time_s", 0.0), ts=d.get("ts", 0.0),
        )


@dataclass
class ComparisonResult:
    """The only place verdicts exist. Machine-generated, auditable."""

    compared_at: float
    comparator_id: str
    ranking: list[str]                              # candidate ids, best first
    verdicts: dict[str, Verdict]
    rationale: str

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class JournalEntry:
    """One line of the append-only JSONL journal.

    A new entry is appended at every state transition of a candidate; the
    latest entry per candidate id is its current state.
    """

    experiment_id: str
    candidate_id: str
    parent_id: Optional[str]
    generation: int
    family: str
    mode: Mode
    hypothesis: str
    delta_ref: str
    fast: Optional[EvaluationResult] = None
    fast_rank: Optional[int] = None
    promotion_decision: Optional[PromotionDecision] = None
    slow: Optional[EvaluationResult] = None
    slow_decision: Optional[SlowDecision] = None
    constraint_violations: list[str] = field(default_factory=list)
    failure_reason: Optional[str] = None
    status: Status = "proposed"
    ts: float = field(default_factory=time.time)
    delta: Optional[dict] = None

    def to_dict(self) -> dict:
        d = asdict(self)
        d["fast"] = self.fast.to_dict() if self.fast else None
        d["slow"] = self.slow.to_dict() if self.slow else None
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "JournalEntry":
        return cls(
            experiment_id=d["experiment_id"], candidate_id=d["candidate_id"],
            parent_id=d.get("parent_id"), generation=d["generation"],
            family=d["family"], mode=d["mode"], hypothesis=d.get("hypothesis", ""),
            delta_ref=d.get("delta_ref", ""),
            fast=EvaluationResult.from_dict(d["fast"]) if d.get("fast") else None,
            fast_rank=d.get("fast_rank"),
            promotion_decision=d.get("promotion_decision"),
            slow=EvaluationResult.from_dict(d["slow"]) if d.get("slow") else None,
            slow_decision=d.get("slow_decision"),
            constraint_violations=d.get("constraint_violations", []),
            failure_reason=d.get("failure_reason"),
            status=d.get("status", "proposed"), ts=d.get("ts", 0.0),
            delta=d.get("delta"),
        )


@dataclass
class FamilyOutcome:
    fast_avg: float = 0.0
    slow_avg: float = 0.0
    n: int = 0                 # slow-evaluated candidates in this family
    slow_failures: int = 0     # candidates rejected by the slow loop
    penalized: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class FeedbackSummary:
    """What the next Generator actually reads (DESIGN.md FeedbackSummary).

    Correlations below min_sample_size are reported as the string
    "insufficient_data", never as findings (audit A3).
    """

    fast_slow_correlation: dict[str, float | str] = field(default_factory=dict)
    family_outcomes: dict[str, FamilyOutcome] = field(default_factory=dict)
    failed_proxy_regions: list[str] = field(default_factory=list)
    penalized_families: list[str] = field(default_factory=list)
    champion_lineage: list[str] = field(default_factory=list)
    suggested_emphasis: dict[str, int] = field(
        default_factory=lambda: {"exploit": 0, "explore": 0, "innovate": 0}
    )
