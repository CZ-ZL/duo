"""Calling-agent adapter over the existing protocol, not another optimizer.

The first supported path is a trusted local Python adapter evaluating a
snapshot of a DSH persona. Permissions describe the admitted work; this
module is NOT a sandbox for untrusted Python. Paid execution stays in the
existing host path until its reservation/reconciliation contract is ready.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import asdict
import contextlib
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sys
import time

import yaml

from .contract import ContractValidationError, PluginRegistry, load_contract, validate_contract
from .plugins.docs_qa_target import build_overlay, persona_version, validate_entries


class AgentError(Exception):
    def __init__(self, code, component, message, next_action, *, retryable=False):
        self.payload = {
            "code": code, "component": component, "message": message,
            "retryable": retryable, "recoverable": True,
            "recovery_conditions": next_action, "next_action": next_action,
        }
        super().__init__(message)


def error_payload(error):
    return {"api_version": 1, "status": "failed", "conclusion": "run_failed",
            "improvement_proven": False, "error": error.payload}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, allow_nan=False,
                                    ensure_ascii=False).encode()).hexdigest()


def read_config(path):
    try:
        value = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise AgentError("INPUT_MISSING", "experiment", "Experiment file is missing",
                         "Provide an existing experiment YAML; use the documented example.")
    except (OSError, ValueError, yaml.YAMLError):
        raise AgentError("INVALID_INPUT", "experiment", "Cannot read experiment YAML",
                         "Provide a readable UTF-8 YAML mapping.")
    if not isinstance(value, dict):
        raise AgentError("INVALID_INPUT", "experiment", "Expected a YAML mapping",
                         "Use the input_schema from discover and the example contract.")
    return value


def read_result(root, expected_digest=None):
    """Inspect and verify existing artifacts; never starts or resumes operations."""
    root = Path(root).resolve()
    try:
        previous = json.loads((root / "result.json").read_text(encoding="utf-8"))
        if expected_digest is not None and previous["plan_digest"] != expected_digest:
            raise ValueError("different plan")
        for name, sha in previous["artifact_hashes"].items():
            path = (root / name).resolve()
            if root not in path.parents or hashlib.sha256(path.read_bytes()).hexdigest() != sha:
                raise ValueError("changed artifact")
        return previous
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        raise AgentError("ARTIFACT_CONFLICT", "journal", "Result does not match its plan or retained artifacts",
                         "Inspect existing evidence and preserve the run; do not treat a changed artifact as verified success.") from None


def discover():
    """No imports of calling-agent code, filesystem writes, or provider calls."""
    from .agent_schema import schemas
    input_schema, output_schema = schemas()
    return {
        "api_version": 1, "name": "dualloop", "version": "0.1.0",
        "when_to_use": "Optimize a DSH persona snapshot with an existing trusted local evaluator.",
        "when_not_to_use": "Untrusted code, production deployment, paid Agent-native execution, or no evaluator.",
        "capabilities": {
            "target_kinds": ["dsh-persona"], "delta_kinds": ["cordis-overlay"],
            "replaceable": ["generator", "executor", "fast_evaluator", "slow_evaluator", "gate"],
            "production_mutation": False, "agent_native_paid_execution": False,
            "comparison_controls": ["baseline", "single_loop", "dual_loop"],
            "final_evaluation": True, "resume": "inspect completed artifacts; uncertain operations require reconciliation",
        },
        "dependencies": ["Python >=3.10", "PyYAML >=6", "trusted local adapter.py"],
        "permissions": {"network": False, "paid": False, "external_side_effects": False},
        "side_effects": ["creates a new run directory containing snapshots, overlays, journal and result"],
        "input_schema": input_schema,
        "output_schema": output_schema,
        "commands": ["discover", "plan --experiment FILE --journal-dir NEW_DIR",
                     "run --experiment FILE --journal-dir NEW_DIR --plan-digest SHA256",
                     "status --journal-dir DIR"],
        "guide": "AGENT_GUIDE.md", "example": "examples/agent_native/experiment.yml",
    }


def make_plan(config, experiment_path, journal_dir):
    try:
        return _make_plan(config, experiment_path, journal_dir)
    except (TypeError, ValueError, KeyError, AttributeError, ContractValidationError):
        raise AgentError("INVALID_INPUT", "plan", "An input has an invalid type or value",
                         "Validate against discover/input_schema and the example; correct the input and plan again.") from None


def _make_plan(config, experiment_path, journal_dir):
    """Resolve/fingerprint inputs without importing the adapter or measuring anything."""
    def reject(message, code="INCOMPATIBLE_INPUT", component="contract"):
        raise AgentError(code, component, message,
                         "Correct the named input and run plan again before executing.")

    config = deepcopy(config)
    agent = config.get("agent")
    if not isinstance(agent, dict):
        reject("agent section with an executable evaluator adapter is required", "EVALUATOR_MISSING")
    for field in ("target_snapshot", "adapter", "evaluators", "permissions", "evidence_kind"):
        if field not in agent:
            reject(f"agent.{field} is required", "INPUT_MISSING", "agent")
    if agent["permissions"] != {"paid": False, "network": False, "external_side_effects": False} or any(
            type(v) is not bool for v in agent["permissions"].values()):
        reject("This adapter admits only local, zero-paid-cost work without external side effects",
               "PERMISSION_UNSUPPORTED", "permissions")
    if agent["evidence_kind"] not in ("fixture", "local_benchmark"):
        reject("evidence_kind must be fixture or local_benchmark")
    search_mode = agent.get("search_mode", "dual_loop")
    if search_mode not in ("baseline", "single_loop", "dual_loop"):
        reject("search_mode must be baseline, single_loop or dual_loop")
    base = Path(experiment_path).resolve().parent
    inputs = {}
    for field in ("target_snapshot", "adapter"):
        if not isinstance(agent[field], str):
            reject(f"agent.{field} must be a path")
        path = (base / agent[field]).resolve()
        try:
            content = path.read_bytes()
        except OSError:
            reject(f"agent.{field} is missing or unreadable", "INPUT_MISSING", field)
        inputs[field] = {"path": str(path), "sha256": hashlib.sha256(content).hexdigest()}
    try:
        persona = Path(inputs["target_snapshot"]["path"]).read_text(encoding="utf-8")
    except UnicodeError:
        reject("target_snapshot must be UTF-8")
    errors = validate_entries(build_overlay(persona))
    if errors:
        reject("target_snapshot: " + "; ".join(errors))
    if Path(inputs["adapter"]["path"]).suffix != ".py":
        reject("adapter must be a trusted local Python .py file")
    try:
        contract = load_contract(config.get("contract"))
    except (ContractValidationError, ValueError, TypeError) as exc:
        reject(str(exc), "INVALID_CONTRACT")
    if contract.target.kind != "dsh-persona" or contract.target.ref != "system-prompt":
        reject("Only dsh-persona/system-prompt is implemented by this adapter")
    if contract.target.editable_space != ["persona"] or "persona" in contract.target.frozen:
        reject("Only persona may be editable, and it cannot also be frozen")
    if contract.baseline.ref != "snapshot:target":
        reject("baseline.ref must be snapshot:target")
    if contract.budget.max_cost != 0:
        reject("Agent-native offline runs require explicit budget.max_cost: 0", "PERMISSION_UNSUPPORTED")
    hours = contract.budget.max_wall_time_hours
    if type(hours) not in (int, float) or not math.isfinite(hours) or hours <= 0:
        reject("budget.max_wall_time_hours must be a positive finite number")
    for field in ("max_fast_evals", "max_slow_evals"):
        if type(getattr(contract.budget, field)) is not int:
            reject(f"budget.{field} must be an integer, not boolean")
    if type(config.get("generations")) is not int or config["generations"] <= 0:
        reject("generations must be a positive integer")
    quotas = config.get("quotas")
    if not isinstance(quotas, dict) or set(quotas) != {"exploit", "explore", "innovate"} or any(
            type(v) is not int or v < 0 for v in quotas.values()) or sum(quotas.values()) == 0:
        reject("quotas must specify nonnegative exploit/explore/innovate counts, with at least one candidate")
    top_k = (config.get("promotion") or {}).get("top_k", 1)
    if type(top_k) is not int or top_k <= 0:
        reject("promotion.top_k must be a positive integer")
    evaluators = agent["evaluators"]
    if not isinstance(evaluators, dict) or "fast" not in evaluators:
        reject("Provide agent.evaluators.fast and a create_bindings adapter", "EVALUATOR_MISSING")
    if set(evaluators) - {"fast", "slow", "final"}:
        reject("Unknown evaluator tier")
    data_ids = []
    for tier, spec in evaluators.items():
        if not isinstance(spec, dict) or any(not spec.get(k) for k in ("id", "version", "data_id", "metrics", "evidence", "limitations")):
            reject(f"evaluators.{tier} needs id/version/data_id/metrics/evidence/limitations")
        if set(spec) - {"id", "version", "data_id", "metrics", "evidence", "limitations", "data_path"}:
            reject(f"evaluators.{tier} has unsupported fields; credentials do not belong in descriptors")
        if any(not isinstance(spec[k], str) for k in ("id", "version", "data_id", "evidence", "limitations")):
            reject(f"evaluators.{tier} descriptor fields must be strings")
        if not isinstance(spec["metrics"], list) or not all(isinstance(m, str) for m in spec["metrics"]):
            reject(f"evaluators.{tier}.metrics must list metric names")
        data_ids.append(spec["data_id"])
        if "data_path" in spec:
            data_path = (base / spec["data_path"]).resolve()
            try:
                inputs[f"data:{tier}"] = {"path": str(data_path), "sha256": hashlib.sha256(data_path.read_bytes()).hexdigest()}
            except OSError:
                reject(f"evaluators.{tier}.data_path is missing", "INPUT_MISSING")
    if len(set(data_ids)) != len(data_ids):
        reject("Search, validation and final data_id must be distinct; reused data is not independent final evidence")
    if contract.upper_objective and "slow" not in evaluators:
        reject("upper_objective requires a slow evaluator", "EVALUATOR_MISSING")
    if not contract.upper_objective and ("slow" in evaluators or "final" in evaluators):
        reject("slow/final requires an upper objective")
    if contract.comparison is None or contract.comparison.plugin != "weighted_v1":
        reject("This entrypoint requires the existing weighted_v1 comparator")
    weights = contract.comparison.config.get("weights")
    slow_weights = contract.comparison.config.get("slow_weights")
    for field in ("min_sample_size", "incumbent_epsilon"):
        value = contract.comparison.config.get(field, 0)
        if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
            reject(f"comparison.{field} must be finite and nonnegative")
    objectives = {"fast": contract.lower_objectives}
    if contract.upper_objective:
        objectives["slow"] = [contract.upper_objective]
    for tier, objs in objectives.items():
        spec = evaluators[tier]
        active_weights = weights if tier == "fast" else slow_weights
        if not isinstance(active_weights, dict) or not active_weights or any(
                type(v) not in (int, float) or not math.isfinite(v) for v in active_weights.values()):
            reject(f"Explicit finite {tier} weights are required")
        for obj in objs:
            if obj.evaluator != spec["id"] or obj.direction not in ("maximize", "minimize"):
                reject(f"{tier} objective evaluator/direction is incompatible")
            weight = active_weights.get(obj.metric, 0)
            if (obj.direction == "maximize" and weight <= 0) or (obj.direction == "minimize" and weight >= 0):
                reject(f"{tier} weight for {obj.metric} disagrees with objective direction")
        needed = set(active_weights) | {c.metric for c in contract.constraints} | {o.metric for o in objs}
        if not needed <= set(spec["metrics"]):
            reject(f"{tier} evaluator does not declare all required metrics")
    if "final" in evaluators and not (set(slow_weights) | {c.metric for c in contract.constraints}) <= set(evaluators["final"]["metrics"]):
        reject("final evaluator does not declare required slow metrics")
    registry = PluginRegistry(evaluators={s["id"] for s in evaluators.values()},
                              comparators={"weighted_v1"}, executors={"caller"},
                              baselines={"snapshot:target"})
    validation = validate_contract(contract, registry)
    final_slots = 2 if "final" in evaluators else 0
    if contract.budget.max_fast_evals < 2 or (contract.upper_objective and contract.budget.max_slow_evals < 2 + final_slots):
        reject("Budget cannot cover baseline and one candidate plus configured final confirmation",
               "BUDGET_INSUFFICIENT", "budget")
    run_dir = Path(journal_dir).resolve()
    if any(p.exists() and not p.is_dir() for p in [run_dir, *run_dir.parents]):
        reject("Output directory conflicts with an existing regular file", "OUTPUT_CONFLICT", "artifacts")
    if any(run_dir == Path(i["path"]) or run_dir in Path(i["path"]).parents for i in inputs.values()):
        reject("Run directory must be separate from input files", "OUTPUT_CONFLICT")
    max_failures = agent.get("max_consecutive_failures", 3)
    if type(max_failures) is not int or max_failures <= 0:
        reject("max_consecutive_failures must be positive")
    plan = {
        "api_version": 1, "experiment_id": contract.id, "contract_version": contract.version,
        "mode": validation.mode if search_mode == "dual_loop" else search_mode,
        "search_mode": search_mode, "labels": validation.labels,
        "target": {"ref": "system-prompt", "kind": "dsh-persona", "version": persona_version(persona),
                   "editable_space": ["persona"], "production_mutation": False},
        "inputs": inputs, "evaluators": evaluators, "budget": asdict(contract.budget),
        "loop_slow_limit": contract.budget.max_slow_evals - final_slots,
        "final_reserved_evals": final_slots, "generations": config["generations"],
        "quotas": quotas, "top_k": top_k, "max_consecutive_failures": max_failures,
        "permissions": agent["permissions"], "evidence_kind": agent["evidence_kind"],
        "cost_estimate_usd": None,
        "cost_basis": "No measured estimate; trusted adapter must declare zero paid cost for generation, selection and evaluation.",
        "model_configuration": {"provider": None, "model": None,
                                "scope": "No model provider is admitted by this offline entrypoint."},
        "stop_conditions": ["evaluation budget", "wall deadline between calls", "consecutive failures", "cancellation", "no candidates", "generation limit", "unknown or positive paid cost"],
        "artifact_dir": str(run_dir), "config_digest": digest(config),
        "limitations": ["Trusted in-process Python; isolation of target copies is not an OS sandbox.",
                        "Slow data is selection/validation data and feeds search; final data never feeds the loop.",
                        "Final data separation is declared by the caller, not independently audited.",
                        "Wall deadline and cancellation are cooperative between plugin calls."],
    }
    plan["plan_digest"] = digest(plan)
    return plan


def execute_plan(config, plan, expected_digest):
    if expected_digest != plan["plan_digest"]:
        raise AgentError("PLAN_CHANGED", "plan", "An inspected matching plan digest is required",
                         "Run plan, inspect target/evaluation/budget, and pass its plan_digest to run.")
    from .comparator import TopKPromotionGate, WeightedComparator
    from .controller import LoopController
    from .feedback import FeedbackEngine
    from .journal import JsonlJournal
    from .models import Candidate, Delta, EvaluationResult
    from .plugins.base import Executor, FastEvaluator, Generator, PromotionGate
    from .plugins.docs_qa_target import SystemPromptMutator
    from .plugins.mock import MockObjectiveProvider

    root = Path(plan["artifact_dir"])
    if root.exists():
        result_path = root / "result.json"
        if not result_path.exists():
            raise AgentError("RUN_UNCERTAIN", "journal", "Run directory already exists without a terminal result",
                             "Inspect status, owning process and artifacts; reconcile unfinished work before any new run.")
        previous = read_result(root, expected_digest)
        return {**previous, "reused_artifacts": True}

    def verify_inputs():
        for name, item in plan["inputs"].items():
            try:
                matches = hashlib.sha256(Path(item["path"]).read_bytes()).hexdigest() == item["sha256"]
            except OSError:
                matches = False
            if not matches:
                raise AgentError("INPUT_CHANGED", name, "A frozen input changed",
                                 "Preserve this run, inspect the changed input and create a new plan after reconciliation.")
        if digest(config) != plan["config_digest"]:
            raise AgentError("PLAN_CHANGED", "config", "Configuration changed after planning",
                             "Plan again using the intended configuration.")

    verify_inputs()
    try:
        root.mkdir(parents=True, exist_ok=False)
    except FileExistsError:
        raise AgentError("RUN_UNCERTAIN", "journal", "Another call claimed this run directory",
                         "Inspect status; do not submit the same work concurrently.")
    except OSError:
        raise AgentError("OUTPUT_UNWRITABLE", "artifacts", "Cannot create the requested run directory",
                         "Choose an authorized writable output directory and plan again.") from None

    def write_json(name, value):
        with (root / name).open("x", encoding="utf-8") as stream:
            stream.write(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n")

    write_json("plan.json", plan)
    baseline = Path(plan["inputs"]["target_snapshot"]["path"]).read_text(encoding="utf-8")
    (root / "baseline.txt").write_text(baseline, encoding="utf-8")
    started = time.monotonic()
    controller = None
    failure = None
    summary = None
    final_results = []
    counters = {"consecutive_failures": 0, "generator_calls": 0, "selection_calls": 0,
                "final_evals": 0, "cost_unknown": False}

    def check_stop():
        if counters["cost_unknown"] or (controller and controller._unknown_cost):
            return "budget:unknown_cost"
        if time.monotonic() - started >= plan["budget"]["max_wall_time_hours"] * 3600:
            return "budget:max_wall_time_hours"
        if counters["consecutive_failures"] >= plan["max_consecutive_failures"]:
            return "consecutive_failures"
        return None

    def invoke(component, fn, *args):
        verify_inputs()
        if check_stop():
            raise AgentError("RUN_STOPPED", component, check_stop(),
                             "Inspect result and retained attempts; do not automatically repeat a stopped run.")
        try:
            # Adapter stdout is diagnostic, not the machine-readable result channel.
            with contextlib.redirect_stdout(sys.stderr):
                value = fn(*args)
        except AgentError:
            raise
        except Exception as exc:
            # Exception text can contain credentials or private evaluator data.
            raise AgentError("PLUGIN_FAILED", component, f"{component} raised {type(exc).__name__}",
                             "Inspect your trusted adapter privately, correct the cause and make a new plan.") from None
        verify_inputs()
        return value

    class GuardedGenerator:
        def __init__(self, plugin):
            self.plugin = plugin

        def propose(self, champion, feedback, quotas, generation, next_id):
            allocated = []

            def allocate():
                cid = next_id()
                allocated.append(cid)
                return cid

            counters["generator_calls"] += 1
            candidates = invoke("generator", self.plugin.propose, deepcopy(champion),
                                deepcopy(feedback), dict(quotas), generation, allocate)
            if not isinstance(candidates, list) or len(candidates) > sum(quotas.values()):
                raise ValueError("generator exceeded assigned quotas or returned a non-list")
            counts = dict.fromkeys(quotas, 0)
            seen = set()
            for c in candidates:
                if not isinstance(c, Candidate) or c.id not in allocated or c.id in seen:
                    raise ValueError("generator must use each controller-issued candidate id at most once")
                if c.generation != generation or c.mode not in counts:
                    raise ValueError("generator returned incompatible generation/mode")
                seen.add(c.id)
                counts[c.mode] += 1
            if any(counts[m] > quotas[m] for m in quotas):
                raise ValueError("generator exceeded mode quota")
            return deepcopy(candidates)

    class GuardedExecutor:
        def __init__(self, plugin):
            self.plugin = plugin

        def run(self, candidate, applied):
            return invoke("executor", self.plugin.run, deepcopy(candidate), deepcopy(applied))

    class GuardedEvaluator:
        def __init__(self, plugin, tier):
            self.plugin, self.tier = plugin, tier
            self.evaluator_id = plan["evaluators"][tier]["id"]

        def evaluate(self, candidate, artifact):
            r = invoke(self.tier + "_evaluator", self.plugin.evaluate,
                       deepcopy(candidate), deepcopy(artifact))
            if not isinstance(r, EvaluationResult) or r.candidate_id != candidate.id or (
                    r.evaluator_id != self.evaluator_id or r.tier != ("fast" if self.tier == "fast" else "slow")):
                raise ValueError("evaluator result identity/tier does not match the frozen request")
            if type(r.ok) is not bool or not isinstance(r.metrics, dict):
                raise ValueError("evaluator must return boolean ok and structured metrics")
            if any(type(v) not in (bool, int, float) or
                   (type(v) is not bool and not math.isfinite(v)) for v in r.metrics.values()):
                raise ValueError("evaluator metrics must be finite numbers or booleans")
            if r.ok and not set(plan["evaluators"][self.tier]["metrics"]) <= set(r.metrics):
                raise ValueError("evaluator omitted declared metrics")
            if r.cost_usd != 0 or type(r.cost_usd) not in (int, float):
                counters["cost_unknown"] = True
                raise AgentError("COST_UNCERTAIN", self.tier, "Evaluator did not report zero paid cost",
                                 "Reconcile the cost and permissions; this local entrypoint cannot authorize paid work.")
            if not isinstance(r.artifacts, list) or not r.artifacts:
                raise ValueError("evaluator must return evidence artifact references")
            for ref in r.artifacts:
                path = Path(ref).resolve()
                if root not in path.parents or not path.is_file():
                    raise ValueError("evidence artifact must exist inside this run directory")
            return deepcopy(r)

    class GuardedGate:
        def __init__(self, plugin):
            self.plugin = plugin

        def select(self, comparison, ids, remaining):
            counters["selection_calls"] += 1
            promoted, decisions = invoke("gate", self.plugin.select, deepcopy(comparison), list(ids), remaining)
            if len(promoted) != len(set(promoted)) or len(promoted) > min(remaining, plan["top_k"]) or any(
                    cid not in ids or comparison.verdicts.get(cid) != "better" for cid in promoted):
                raise ValueError("selection strategy cannot bypass evidence or budget constraints")
            if set(decisions) != set(ids) or any(
                    d not in ("promoted_to_slow", "held", "dropped") for d in decisions.values()) or any(
                    (decisions[cid] == "promoted_to_slow") != (cid in promoted) for cid in ids):
                raise ValueError("selection strategy returned inconsistent decisions")
            return promoted, decisions

    class Observer:
        def on_event(self, event, payload):
            if event == "fail_closed":
                counters["consecutive_failures"] += 1
            if event in ("fast_evaluated", "slow_evaluated"):
                tier = "fast" if event == "fast_evaluated" else "slow"
                if controller._state[payload["candidate"]][tier].ok:
                    counters["consecutive_failures"] = 0

    try:
        adapter_path = plan["inputs"]["adapter"]["path"]
        # Standard Python decorators (including dataclasses with postponed
        # annotations) resolve their module through sys.modules during import.
        module_name = "dualloop_adapter_" + expected_digest
        spec = importlib.util.spec_from_file_location(module_name, adapter_path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        invoke("adapter", spec.loader.exec_module, module)
        factory = getattr(module, "create_bindings", None)
        if not callable(factory):
            raise AgentError("PLUGIN_INCOMPATIBLE", "adapter", "adapter must export create_bindings",
                             "Implement the factory contract shown in AGENT_GUIDE.md.")
        bindings = invoke("adapter", lambda: factory(
            baseline_persona=baseline, run_dir=str(root), evaluators=deepcopy(plan["evaluators"]),
            options=deepcopy(config["agent"].get("adapter_options", {}))))
        if not isinstance(bindings, dict):
            raise ValueError("create_bindings must return a mapping")
        for key, protocol in (("generator", Generator), ("executor", Executor),
                              ("fast_evaluator", FastEvaluator)):
            if not isinstance(bindings.get(key), protocol):
                raise ValueError(f"missing or incompatible {key}")
        for key in ("generation_max_cost_usd", "selection_max_cost_usd"):
            if type(bindings.get(key)) not in (int, float) or bindings[key] != 0:
                raise ValueError(f"{key} must explicitly declare zero paid cost")
        for tier, declared in plan["evaluators"].items():
            plugin = bindings.get(tier + "_evaluator")
            if not isinstance(plugin, FastEvaluator) or plugin.evaluator_id != declared["id"]:
                raise ValueError(f"{tier} evaluator id/interface differs from the plan")
        gate = bindings.get("gate", TopKPromotionGate(plan["top_k"]))
        if not isinstance(gate, PromotionGate):
            raise ValueError("incompatible gate")
        effective = deepcopy(config["contract"])
        effective["budget"]["max_slow_evals"] = plan["loop_slow_limit"]
        if plan["search_mode"] != "dual_loop":
            effective["upper_objective"] = None
        provider = MockObjectiveProvider(effective)
        contract = provider.load()
        comp_cfg = contract.comparison.config
        slow_comparator = WeightedComparator({**comp_cfg, "weights": comp_cfg.get("slow_weights", {})})
        registry = PluginRegistry(evaluators={s["id"] for s in plan["evaluators"].values()},
                                  comparators={"weighted_v1"}, executors={"caller"}, baselines={"snapshot:target"})
        controller = LoopController(
            provider=provider, generator=GuardedGenerator(bindings["generator"]),
            mutator=SystemPromptMutator(root / "patches", baseline_persona=baseline),
            executor=GuardedExecutor(bindings["executor"]),
            fast_evaluator=GuardedEvaluator(bindings["fast_evaluator"], "fast"),
            slow_evaluator=(GuardedEvaluator(bindings["slow_evaluator"], "slow")
                            if "slow" in plan["evaluators"] and plan["search_mode"] == "dual_loop" else None),
            comparator=WeightedComparator(comp_cfg), slow_comparator=slow_comparator,
            gate=GuardedGate(gate), journal=JsonlJournal(root), observer=Observer(),
            feedback_engine=FeedbackEngine(), registry=registry, quotas=plan["quotas"],
            generations=0 if plan["search_mode"] == "baseline" else plan["generations"],
            stop_check=check_stop, proxy_iteration=plan["search_mode"] == "single_loop")
        summary = controller.run()
        selection_id = summary.champion_id or summary.proxy_leader_id
        if plan["search_mode"] != "dual_loop":
            summary.mode = plan["search_mode"]
        if plan["final_reserved_evals"] and summary.stop_reason == "completed" and selection_id:
            # Search is over. These facts are deliberately outside the feedback Journal.
            latest = controller.journal.latest()
            baseline_entry = next(e for e in latest.values() if e.generation == 0)
            ids = list(dict.fromkeys([baseline_entry.candidate_id, selection_id]))
            for cid in ids:
                e = latest[cid]
                c = Candidate(e.candidate_id, e.experiment_id, e.parent_id, e.generation,
                              e.family, e.mode, Delta.from_dict(e.delta), e.hypothesis)
                persona = c.delta.patch.get("persona", baseline)
                artifact = {"persona": persona, "patch_path": str(root / "patches" / f"{cid}.yml")}
                counters["final_evals"] += 1
                final_results.append(GuardedEvaluator(bindings["final_evaluator"], "final").evaluate(
                    c, controller.executor.run(c, artifact)))
            write_json("final.json", {"used_for_search": False, "results": [r.to_dict() for r in final_results]})
    except KeyboardInterrupt:
        failure = AgentError("CANCELLED", "run", "Run cancelled between or during local plugin calls",
                             "Inspect retained artifacts; cancellation does not authorize repeating work.")
    except AgentError as exc:
        failure = exc
    except Exception as exc:
        failure = AgentError("RUN_FAILED", "run", f"Local run raised {type(exc).__name__}",
                             "Inspect status and the adapter contract; retain this run and correct the cause before replanning.")

    latest = controller.journal.latest() if controller else {}
    errors = [e for e in latest.values() if e.status == "error" or (e.fast and not e.fast.ok) or (e.slow and not e.slow.ok)]
    counters["cost_unknown"] = counters["cost_unknown"] or bool(controller and controller._unknown_cost)
    final_invalid = False
    if final_results:
        final_comparison = slow_comparator.compare(final_results, contract.constraints)
        final_invalid = any(v not in ("better", "worse") for v in final_comparison.verdicts.values())
    champion = (summary.champion_id or summary.proxy_leader_id) if summary else None
    baseline_id = next((e.candidate_id for e in latest.values() if e.generation == 0), None)
    conclusion = "insufficient_evidence"
    if failure:
        conclusion = "run_failed"
    elif summary and summary.stop_reason == "completed" and summary.mode in ("optimize", "single_loop", "baseline"):
        held = any(e.promotion_decision == "held" for e in latest.values())
        baseline_entry = latest.get(baseline_id)
        baseline_valid = baseline_entry is not None and baseline_entry.fast is not None
        if baseline_valid:
            verdict = controller.comparator.compare([baseline_entry.fast], contract.constraints).verdicts.get(baseline_id)
            baseline_valid = verdict in ("better", "worse")
        if baseline_valid and baseline_entry.slow:
            verdict = controller.slow_comparator.compare([baseline_entry.slow], contract.constraints).verdicts.get(baseline_id)
            baseline_valid = verdict in ("better", "worse")
        if champion == baseline_id and not errors and not held and baseline_valid and not final_invalid:
            conclusion = "retain_baseline"
        elif final_results and len(final_results) == 2:
            comparison = slow_comparator.compare(final_results, contract.constraints, baseline_id)
            conclusion = ("recommend_candidate" if comparison.verdicts.get(champion) == "better"
                          else "retain_baseline" if comparison.verdicts.get(champion) == "worse"
                          else "insufficient_evidence")
    status = ("cancelled" if failure and failure.payload["code"] == "CANCELLED" else
              "failed" if failure else "completed" if summary.stop_reason == "completed" else "stopped")
    selected = latest.get(champion)
    candidate_path = str(root / "patches" / f"{champion}.yml") if selected and champion != baseline_id else None
    result = {
        "api_version": 1, "run_id": expected_digest[:16], "plan_digest": expected_digest,
        "experiment_id": plan["experiment_id"], "status": status, "conclusion": conclusion,
        "improvement_proven": conclusion == "recommend_candidate" and plan["evidence_kind"] == "local_benchmark",
        "evidence_kind": plan["evidence_kind"], "reused_artifacts": False,
        "mode": plan["mode"], "summary": asdict(summary) if summary else None,
        "cost_usd": None if failure or counters["cost_unknown"] else summary.cost_usd,
        "attempts": {"fast": controller._fast_evals if controller else 0,
                     "slow": controller._slow_evals if controller else 0,
                     "final": counters["final_evals"]},
        "cost_scope": "Paid USD only; generation/selection declared zero by trusted local adapter; evaluation reports where available. Exceptions after work may leave unknown cost. CPU time is separate.",
        "wall_time_s": time.monotonic() - started, "counters": counters,
        "candidate_id": champion, "baseline_id": baseline_id, "candidate_path": candidate_path,
        "original_target_changed": False, "failure_candidates": sorted(
            {e.candidate_id for e in errors} | {r.candidate_id for r in final_results if not r.ok}),
        "limitations": plan["limitations"] + [
            "Fixture results establish mechanics only, not optimization efficacy." if plan["evidence_kind"] == "fixture"
            else "Improvement is scoped to the caller-declared local benchmark; evaluator quality and final independence are not independently audited.",
            "No independent Agent usability claim is made by this run."],
        "error": failure.payload if failure else None,
    }
    try:
        verify_inputs()
    except AgentError as exc:
        result.update(status="failed", conclusion="run_failed", improvement_proven=False,
                      error=exc.payload,
                      original_target_changed=(exc.payload["component"] == "target_snapshot"))
    result["artifact_hashes"] = {
        str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*")) if p.is_file() and not p.is_symlink()
    }
    write_json("result.json", result)
    return result
