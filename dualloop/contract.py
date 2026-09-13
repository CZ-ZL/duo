"""Objective Contract: YAML load + schema validation + three-mode gate.

The contract is the gate between "a wish" and "an experiment" (DESIGN.md
"Objective Contract" and "Failure / Explore Mode"):

- Optimize Mode requires: resolvable baseline, non-empty editable target,
  measurable objective, resolvable evaluators, comparison direction, and an
  executable experiment path. Full dual-loop additionally requires an upper
  objective + slow evaluator.
- Missing upper objective / slow evaluator -> fast-only ("proxy-only, not
  validated").
- Objective not comparable -> Explore Mode.
- Everything else missing -> the run is REFUSED with precise reasons.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Optional

import yaml

ContractMode = Literal["optimize", "fast_only", "explore"]

PROXY_ONLY_LABEL = "proxy-only, not validated"
EXPLORE_LABEL = "explore: no ranking claims"

DIRECTIONS = ("maximize", "minimize")
_OPS = ("<", "<=", ">", ">=", "==", "!=")


class ContractValidationError(Exception):
    """Raised when a contract fails hard validity checks. Fail closed."""

    def __init__(self, reasons: list[str]):
        self.reasons = reasons
        super().__init__("invalid objective contract: " + "; ".join(reasons))


@dataclass
class PluginRegistry:
    """What the deployment can actually resolve. Validation checks the
    contract's references against this — a contract naming an evaluator that
    does not exist must not run."""

    evaluators: set[str] = field(default_factory=set)
    comparators: set[str] = field(default_factory=set)
    executors: set[str] = field(default_factory=set)
    baselines: set[str] = field(default_factory=set)


@dataclass
class Target:
    kind: str
    ref: str
    editable_space: list[str]
    frozen: list[str] = field(default_factory=list)


@dataclass
class Baseline:
    ref: str


@dataclass
class Objective:
    metric: str
    direction: str
    evaluator: str
    extras: dict[str, Any] = field(default_factory=dict)


@dataclass
class Constraint:
    metric: str
    op: str
    value: float | bool


@dataclass
class Comparison:
    plugin: str
    config: dict[str, Any] = field(default_factory=dict)


@dataclass
class Budget:
    max_fast_evals: int
    max_slow_evals: int
    max_cost: float = float("inf")
    max_wall_time_hours: Optional[float] = None


@dataclass
class ObjectiveContract:
    id: str
    version: int
    target: Target
    baseline: Baseline
    upper_objective: Optional[Objective]
    lower_objectives: list[Objective]
    constraints: list[Constraint]
    comparison: Optional[Comparison]
    budget: Budget

    @property
    def primary_metric(self) -> str:
        return self.lower_objectives[0].metric

    @property
    def upper_metric(self) -> Optional[str]:
        return self.upper_objective.metric if self.upper_objective else None


@dataclass
class ValidationResult:
    mode: ContractMode
    reasons: list[str] = field(default_factory=list)   # why not full optimize
    labels: list[str] = field(default_factory=list)    # honest output labels


def _parse_objective(d: Any, where: str, errors: list[str]) -> Optional[Objective]:
    if not isinstance(d, dict):
        errors.append(f"{where}: must be a mapping")
        return None
    missing = [k for k in ("metric", "direction", "evaluator") if k not in d]
    if missing:
        errors.append(f"{where}: missing keys {missing}")
        return None
    extras = {k: v for k, v in d.items() if k not in ("metric", "direction", "evaluator")}
    return Objective(metric=str(d["metric"]), direction=str(d["direction"]),
                     evaluator=str(d["evaluator"]), extras=extras)


def load_contract(source: str | Path | dict) -> ObjectiveContract:
    """Parse YAML (path or already-loaded mapping) into an ObjectiveContract.

    Structural problems (wrong types, missing required sections) raise
    ContractValidationError immediately; deployment-dependent checks
    (resolvability) happen in validate_contract.
    """
    if isinstance(source, (str, Path)):
        raw = yaml.safe_load(Path(source).read_text(encoding="utf-8"))
    else:
        raw = source
    errors: list[str] = []
    if not isinstance(raw, dict):
        raise ContractValidationError(["contract must be a YAML mapping"])

    for key in ("id", "version", "target", "baseline", "budget"):
        if key not in raw:
            errors.append(f"missing required section: {key}")

    target = None
    if isinstance(raw.get("target"), dict):
        t = raw["target"]
        editable = t.get("editable_space")
        if not isinstance(editable, list) or not editable:
            errors.append("target.editable_space: must be a non-empty list")
            editable = []
        target = Target(kind=str(t.get("kind", "")), ref=str(t.get("ref", "")),
                        editable_space=[str(e) for e in editable],
                        frozen=[str(f) for f in t.get("frozen", [])])
    elif "target" in raw:
        errors.append("target: must be a mapping")

    baseline = None
    if isinstance(raw.get("baseline"), dict) and raw["baseline"].get("ref"):
        baseline = Baseline(ref=str(raw["baseline"]["ref"]))
    elif "baseline" in raw:
        errors.append("baseline: must be a mapping with a ref")

    lower: list[Objective] = []
    raw_lower = raw.get("lower_objectives")
    if not isinstance(raw_lower, list) or not raw_lower:
        errors.append("lower_objectives: must be a non-empty list (no measurable objective)")
    else:
        for i, item in enumerate(raw_lower):
            obj = _parse_objective(item, f"lower_objectives[{i}]", errors)
            if obj:
                lower.append(obj)

    upper = None
    if raw.get("upper_objective") is not None:
        upper = _parse_objective(raw["upper_objective"], "upper_objective", errors)

    constraints: list[Constraint] = []
    for i, c in enumerate(raw.get("constraints") or []):
        if not isinstance(c, dict) or not all(k in c for k in ("metric", "op", "value")):
            errors.append(f"constraints[{i}]: needs metric/op/value")
            continue
        if str(c["op"]) not in _OPS:
            errors.append(f"constraints[{i}]: unsupported op {c['op']!r}")
            continue
        constraints.append(Constraint(metric=str(c["metric"]), op=str(c["op"]),
                                      value=c["value"]))

    comparison = None
    if raw.get("comparison") is not None:
        comp = raw["comparison"]
        if not isinstance(comp, dict) or not comp.get("plugin"):
            errors.append("comparison: must name a comparator plugin")
        else:
            comparison = Comparison(plugin=str(comp["plugin"]),
                                    config=dict(comp.get("config") or {}))

    budget = None
    if isinstance(raw.get("budget"), dict):
        b = raw["budget"]
        for key in ("max_fast_evals", "max_slow_evals"):
            if not isinstance(b.get(key), int) or b[key] <= 0:
                errors.append(f"budget.{key}: must be a positive integer")
        if not errors:
            budget = Budget(
                max_fast_evals=b["max_fast_evals"],
                max_slow_evals=b["max_slow_evals"],
                max_cost=float(b.get("max_cost", float("inf"))),
                max_wall_time_hours=b.get("max_wall_time_hours"),
            )
    elif "budget" in raw:
        errors.append("budget: must be a mapping")

    if errors:
        raise ContractValidationError(errors)
    return ObjectiveContract(
        id=str(raw["id"]), version=int(raw["version"]), target=target,
        baseline=baseline, upper_objective=upper, lower_objectives=lower,
        constraints=constraints, comparison=comparison, budget=budget,
    )


def validate_contract(contract: ObjectiveContract,
                      registry: PluginRegistry) -> ValidationResult:
    """Deployment-dependent validity check; decides the mode gate.

    Raises ContractValidationError (refusal, precise reasons) when the run
    cannot honestly claim to optimize OR explore: unresolvable baseline,
    empty editable space, unmeasurable/unresolvable objective, or no
    executable experiment path.
    """
    reasons: list[str] = []

    if contract.baseline.ref not in registry.baselines:
        reasons.append(f"baseline {contract.baseline.ref!r} does not resolve")
    if not contract.target.editable_space:
        reasons.append("target.editable_space is empty: nothing the Generator may touch")
    for obj in contract.lower_objectives:
        if obj.direction not in DIRECTIONS:
            reasons.append(f"objective {obj.metric!r}: no comparison direction "
                           f"({obj.direction!r})")
        if obj.evaluator not in registry.evaluators:
            reasons.append(f"evaluator {obj.evaluator!r} for metric {obj.metric!r} "
                           "does not resolve")
    if contract.upper_objective and (
            contract.upper_objective.evaluator not in registry.evaluators):
        reasons.append(f"slow evaluator {contract.upper_objective.evaluator!r} "
                       "does not resolve")
    if not registry.executors:
        reasons.append("no executable experiment path: no executor is wired")

    if reasons:
        raise ContractValidationError(reasons)

    # Comparability: without it the system explores, it does not rank.
    comparable = (
        contract.comparison is not None
        and contract.comparison.plugin in registry.comparators
        and all(o.direction in DIRECTIONS for o in contract.lower_objectives)
    )
    if not comparable:
        why = ("comparison section missing or comparator "
               f"{getattr(contract.comparison, 'plugin', None)!r} unresolvable"
               if contract.comparison is None
               or contract.comparison.plugin not in registry.comparators
               else "primary objective has no comparison direction")
        return ValidationResult(mode="explore", reasons=[why],
                                labels=[EXPLORE_LABEL])

    if contract.upper_objective is None or (
            contract.upper_objective.evaluator not in registry.evaluators):
        why = ("no upper objective" if contract.upper_objective is None
               else "upper objective has no resolvable slow evaluator")
        return ValidationResult(mode="fast_only", reasons=[why],
                                labels=[PROXY_ONLY_LABEL])

    return ValidationResult(mode="optimize")
