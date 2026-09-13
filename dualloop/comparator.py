"""Decision-layer plugins: WeightedComparator + TopKPromotionGate.

Evaluators produce facts; only here is "better" decided (DESIGN.md Design
Principle #4). The comparator is plain deterministic code, NEVER an LLM,
and its policy is versioned via the contract (feedback never adapts it —
Slow-to-Fast Feedback rule #4).

Hard constraints REJECT (verdict "constraint_violation"), never penalize.
"""
from __future__ import annotations

import math
import time
from typing import Any, Optional

from .contract import Constraint
from .models import ComparisonResult, EvaluationResult


def _finite_number(value: Any) -> bool:
    return type(value) in (int, float) and math.isfinite(value)


def _check_constraint(metrics: dict[str, Any], c: Constraint) -> Optional[str]:
    """Return a violation description, or None if the constraint holds.

    A missing metric is a violation (fail closed): a candidate whose safety
    or cost is unmeasured does not pass the guardrail.
    """
    if c.metric not in metrics:
        return f"{c.metric}: missing (constraint {c.op} {c.value} cannot be checked)"
    actual = metrics[c.metric]
    if isinstance(c.value, bool):
        if type(actual) is not bool:
            return f"{c.metric}: expected a boolean guardrail measurement"
    elif not _finite_number(actual):
        return f"{c.metric}: expected a finite numeric guardrail measurement"
    ops = {
        "<": lambda: actual < c.value,
        "<=": lambda: actual <= c.value,
        ">": lambda: actual > c.value,
        ">=": lambda: actual >= c.value,
        "==": lambda: actual == c.value,
        "!=": lambda: actual != c.value,
    }
    if not ops[c.op]():
        return f"{c.metric}={actual!r} violates {c.op} {c.value!r}"
    return None


class WeightedComparator:
    """weighted_v1: weighted score + hard constraints + incumbent epsilon.

    score(candidate) = sum(weight * metric) over configured weights; weight
    sign encodes direction (e.g. avg_cost_usd: -0.2). A challenger must beat
    the incumbent by `incumbent_epsilon` to be verdicted "better" — ties and
    near-ties keep the incumbent (ported from v1's incumbent-epsilon selector).
    """

    comparator_id = "weighted_v1"

    def __init__(self, config: Optional[dict] = None):
        config = config or {}
        self.weights: dict[str, float] = {
            str(k): float(v) for k, v in (config.get("weights") or {}).items()
        }
        self.min_sample_size = float(config.get("min_sample_size", 0))
        self.incumbent_epsilon = float(config.get("incumbent_epsilon", 0.0))

    def score(self, result: EvaluationResult) -> float:
        total = 0.0
        for metric, w in self.weights.items():
            v = result.metrics.get(metric)
            if isinstance(v, bool) or v is None:
                continue  # booleans are guardrail inputs, not scoring inputs
            total += w * float(v)
        return total

    def compare(self, results: list[EvaluationResult],
                constraints: Optional[list[Constraint]] = None,
                incumbent_id: Optional[str] = None) -> ComparisonResult:
        constraints = constraints or []
        verdicts: dict[str, str] = {}
        violations: dict[str, list[str]] = {}
        scores: dict[str, float] = {}
        comparable: list[str] = []
        incomparable: list[str] = []
        violated: list[str] = []
        evidence_errors: dict[str, str] = {}
        incumbent = next((r for r in results if r.candidate_id == incumbent_id), None)
        scope = ((incumbent.evaluator_id, incumbent.tier) if incumbent else
                 ((results[0].evaluator_id, results[0].tier) if results else None))

        for r in results:
            bad = [v for c in constraints
                   if (v := _check_constraint(r.metrics, c))]
            if r.ok is True and bad:
                verdicts[r.candidate_id] = "constraint_violation"
                violations[r.candidate_id] = bad
                violated.append(r.candidate_id)
                continue
            reason = None
            if r.ok is not True:
                reason = "evaluation failed"
            elif scope != (r.evaluator_id, r.tier):
                reason = "evaluator version/tier differs from comparison scope"
            elif not self.weights or any(
                    not _finite_number(r.metrics.get(m)) for m in self.weights):
                reason = "scoring metrics missing or not finite numbers"
            elif self.min_sample_size > 0 and (
                    not _finite_number(r.metrics.get("sample_size")) or
                    r.metrics["sample_size"] < self.min_sample_size):
                reason = f"sample_size missing/invalid/below {self.min_sample_size:g}"
            if reason:
                verdicts[r.candidate_id] = "incomparable"
                evidence_errors[r.candidate_id] = reason
                incomparable.append(r.candidate_id)
                continue
            scores[r.candidate_id] = self.score(r)
            comparable.append(r.candidate_id)

        ranked = sorted(comparable, key=lambda cid: (-scores[cid], cid))
        ranking = ranked + sorted(incomparable) + sorted(violated)

        incumbent_score = scores.get(incumbent_id) if incumbent_id else None
        for cid in ranked:
            if incumbent_id is not None and incumbent_score is None:
                verdicts[cid] = "incomparable"
                evidence_errors[cid] = "incumbent has no admissible evidence"
            elif incumbent_score is None:
                verdicts[cid] = "better"  # no incumbent: ranking carries the meaning
            elif scores[cid] > incumbent_score + self.incumbent_epsilon:
                verdicts[cid] = "better"
            else:
                # within epsilon (or below): incumbent advantage holds
                verdicts[cid] = "worse"

        rationale_parts = [
            f"policy=weighted_v1 weights={self.weights} "
            f"epsilon={self.incumbent_epsilon} min_sample_size={self.min_sample_size:g}",
            f"ranked={[(cid, round(scores[cid], 4)) for cid in ranked]}",
        ]
        if incumbent_id:
            rationale_parts.append(
                f"incumbent={incumbent_id} score={incumbent_score!r}")
        for cid, bad in violations.items():
            rationale_parts.append(f"{cid} rejected: {'; '.join(bad)}")
        for cid, reason in evidence_errors.items():
            rationale_parts.append(f"{cid} incomparable: {reason}")
        return ComparisonResult(
            compared_at=time.time(), comparator_id=self.comparator_id,
            ranking=ranking, verdicts=verdicts,  # type: ignore[arg-type]
            rationale=" | ".join(rationale_parts),
        )


class TopKPromotionGate:
    """Which fast candidates earn slow-eval money (DESIGN.md "Promotion Gate").

    v1 policy: candidates that (a) beat the champion per the Comparator
    (including incumbent epsilon), (b) pass all hard constraints, (c) fit
    the remaining slow budget — ranked by comparator output, top-k promoted.
    """

    gate_id = "top_k_v1"

    def __init__(self, top_k: int = 2):
        self.top_k = top_k

    def select(self, comparison: ComparisonResult,
               candidate_ids: list[str],
               slow_budget_remaining: int,
               ) -> tuple[list[str], dict[str, str]]:
        """Return (promoted ids, per-candidate promotionDecision)."""
        decisions: dict[str, str] = {}
        eligible = [cid for cid in comparison.ranking
                    if cid in candidate_ids
                    and comparison.verdicts.get(cid) == "better"]
        promoted: list[str] = []
        slots = max(0, min(self.top_k, slow_budget_remaining))
        for cid in eligible:
            if len(promoted) < slots:
                promoted.append(cid)
                decisions[cid] = "promoted_to_slow"
            else:
                # beat the champion but no slow slot / budget left
                decisions[cid] = "held"
        for cid in candidate_ids:
            decisions.setdefault(cid, "dropped")
        return promoted, decisions
