#!/usr/bin/env python3
"""Prepare or run bounded local Agent-native comparisons using the existing core.

Default: execute only the shipped, explicitly marked fixture. Custom experiment
files require --execute-local; otherwise just freeze the comparison protocol.
No installers, credentials, provider calls or historical journal writes.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import yaml
from dualloop.agent_api import AgentError, discover, execute_plan, make_plan, read_config

EXAMPLE = ROOT / "examples" / "agent_native" / "experiment.yml"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--experiment", type=Path)
    parser.add_argument("--execute-local", action="store_true")
    parser.add_argument("--repeats", type=int, default=2)
    parser.add_argument("--threshold", type=float, default=1.0)
    args = parser.parse_args(argv)
    if args.repeats < 1:
        parser.error("--repeats must be positive")
    source = (args.experiment or EXAMPLE).resolve()
    base = read_config(source)
    for field in ("target_snapshot", "adapter"):
        base["agent"][field] = str((source.parent / base["agent"][field]).resolve())
    for spec in base["agent"]["evaluators"].values():
        if "data_path" in spec:
            spec["data_path"] = str((source.parent / spec["data_path"]).resolve())
    if "final" not in base["agent"]["evaluators"]:
        parser.error("comparison requires a predeclared final evaluator")
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    (out / "configs").mkdir()

    def write(name, value):
        (out / name).write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")

    arms = ["baseline", "single_loop", "dual_loop"]
    objective = base["contract"]["upper_objective"]
    protocol = {
        "status": "FROZEN_BEFORE_EXECUTION", "source": str(source),
        "metric": objective["metric"], "direction": objective["direction"],
        "threshold": args.threshold, "budget_per_arm": base["contract"]["budget"],
        "repeats": args.repeats, "arms": arms,
        "shared": ["initial snapshot", "candidate adapter/model", "data IDs", "metric rules", "resource caps", "terminal evaluator"],
        "differences": {
            "baseline": "No generation, no slow validation; initial target is terminally evaluated.",
            "single_loop": "Same generator and fast evaluator; proxy incumbent updated per generation; no slow feedback/validation.",
            "dual_loop": "Existing fast/slow protocol, validation selection and slow-to-fast feedback.",
        },
        "cost_scope": "Total paid USD includes generator, selection and evaluator; local CPU wall time recorded separately.",
        "stopping": "Per-arm frozen caps and generation limit; no best-run selection or extra repeats after observing results.",
        "resources_to_target": "Terminal totals if final threshold attained; first-hit time within search is NOT_EVALUATED.",
        "evidence_kind": base["agent"]["evidence_kind"],
    }
    write("comparison_protocol.json", protocol)
    write("discovery.json", discover())
    results = []
    should_run = args.experiment is None or args.execute_local
    for repeat in range(args.repeats):
        for arm in arms:
            name = f"{arm}-{repeat + 1}"
            cfg = deepcopy(base)
            cfg["agent"]["search_mode"] = arm
            path = out / "configs" / f"{name}.yml"
            path.write_text(yaml.safe_dump(cfg, sort_keys=False))
            plan = make_plan(cfg, path, out / name)
            write(f"configs/{name}.plan.json", plan)
            if not should_run:
                results.append({"arm": arm, "repeat": repeat + 1, "status": "NOT_RUN",
                                "plan": str(out / "configs" / f"{name}.plan.json")})
                continue
            result = execute_plan(cfg, plan, plan["plan_digest"])
            final_path = out / name / "final.json"
            final = json.loads(final_path.read_text())["results"] if final_path.exists() else []
            selected = next((r for r in final if r["candidate_id"] == result["candidate_id"]), None)
            value = selected["metrics"].get(objective["metric"]) if selected and selected["ok"] else None
            achieved = value is not None and (value >= args.threshold if objective["direction"] == "maximize" else value <= args.threshold)
            summary = result.get("summary") or {}
            attempts = result.get("attempts") or {}
            resources = {"fast_attempts": attempts.get("fast", summary.get("fast_evals")),
                         "slow_attempts": attempts.get("slow", summary.get("slow_evals")),
                         "final_attempts": attempts.get("final", result["counters"]["final_evals"]),
                         "generator_calls": result["counters"]["generator_calls"],
                         "selection_calls": result["counters"]["selection_calls"],
                         "total_cost_usd": result["cost_usd"], "wall_time_s": result["wall_time_s"]}
            results.append({"arm": arm, "repeat": repeat + 1, "status": result["status"],
                            "conclusion": result["conclusion"], "final_metric": value,
                            "final_metrics": selected["metrics"] if selected else None,
                            "failure_candidates": result["failure_candidates"],
                            "resources": resources, "resources_to_target": resources if achieved else None,
                            "result": str(out / name / "result.json")})

    checks = []
    if args.experiment is None:
        for name, option, expected in (
                ("no-improvement", "no_improvement", "retain_baseline"),
                ("invalid-candidate", "invalid_candidate", "insufficient_evidence"),
                ("evaluation-failure", "evaluation_failure", "insufficient_evidence")):
            cfg = deepcopy(base)
            cfg["agent"]["adapter_options"] = {option: True}
            path = out / "configs" / f"{name}.yml"
            path.write_text(yaml.safe_dump(cfg))
            plan = make_plan(cfg, path, out / name)
            result = execute_plan(cfg, plan, plan["plan_digest"])
            checks.append({"case": name, "expected": expected, "actual": result["conclusion"],
                           "passed": result["conclusion"] == expected})
        for name in ("missing-evaluator", "budget-insufficient"):
            cfg = deepcopy(base)
            if name == "missing-evaluator":
                del cfg["agent"]["evaluators"]["fast"]
                expected = "EVALUATOR_MISSING"
            else:
                cfg["contract"]["budget"]["max_fast_evals"] = 1
                expected = "BUDGET_INSUFFICIENT"
            try:
                make_plan(cfg, source, out / name)
                actual = "UNEXPECTED_ACCEPTANCE"
            except AgentError as exc:
                actual = exc.payload["code"]
            checks.append({"case": name, "expected": expected, "actual": actual, "passed": actual == expected})
    variation = {}
    for arm in arms:
        values = [r["final_metric"] for r in results if r["arm"] == arm and r.get("final_metric") is not None]
        variation[arm] = {"observed_repeats": len(values), "range": max(values) - min(values) if values else None}
    report = {
        "status": "completed" if should_run else "prepared_not_run",
        "evidence_kind": base["agent"]["evidence_kind"],
        "efficacy_claim": "NOT_EVALUATED" if base["agent"]["evidence_kind"] == "fixture" or not should_run else "CALLER_BENCHMARK_ONLY",
        "independent_agent_validation": "Separate receipt required; this script is not an independent Agent.",
        "arms": results, "repeat_variation": variation, "acceptance_checks": checks,
        "limitations": ["Do not infer live optimization value from static fixtures.",
                        "Final evaluator quality/data independence are caller assertions, not instrument qualification.",
                        "No paid provider run was authorized or launched by this verification.",
                        "Resource caps are equal; baseline and single-loop intentionally use fewer evaluation stages."],
    }
    write("report.json", report)
    print(json.dumps({"report": str(out / "report.json"), "status": report["status"],
                      "efficacy_claim": report["efficacy_claim"], "arms": len(results),
                      "checks_passed": sum(c["passed"] for c in checks)}, indent=2))
    return 0 if all(c["passed"] for c in checks) and all(r["status"] in ("completed", "NOT_RUN") for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
