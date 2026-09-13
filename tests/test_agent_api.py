"""Public CLI acceptance. The example's metrics are explicit fixtures."""
import json
from pathlib import Path
import subprocess
import sys
import yaml
import pytest


ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / "examples" / "agent_native" / "experiment.yml"


def cli(*args):
    return subprocess.run([sys.executable, "-m", "dualloop", *map(str, args)],
                          cwd=ROOT, capture_output=True, text=True)


def test_discovery_is_machine_readable_and_honest():
    call = cli("discover")
    assert call.returncode == 0, call.stderr
    data = json.loads(call.stdout)
    assert data["api_version"] == 1
    assert data["capabilities"]["production_mutation"] is False
    assert data["capabilities"]["agent_native_paid_execution"] is False
    assert "input_schema" in data and "output_schema" in data


def test_missing_input_returns_structured_recovery(tmp_path):
    call = cli("plan", "--experiment", tmp_path / "missing.yml",
               "--journal-dir", tmp_path / "run")
    assert call.returncode == 2
    data = json.loads(call.stdout)
    assert data["error"]["code"] == "INPUT_MISSING"
    assert data["error"]["next_action"]
    assert not (tmp_path / "run").exists()


def test_plan_has_no_execution_side_effects_and_reports_actual_evidence(tmp_path):
    call = cli("plan", "--experiment", EXAMPLE, "--journal-dir", tmp_path / "run")
    assert call.returncode == 0, call.stdout + call.stderr
    plan = json.loads(call.stdout)
    assert plan["target"]["editable_space"] == ["persona"]
    assert plan["final_reserved_evals"] == 2
    assert plan["cost_estimate_usd"] is None
    assert not (tmp_path / "run").exists()


def test_end_to_end_and_repeat_inspection_do_not_execute_again(tmp_path):
    out = tmp_path / "run"
    plan_call = cli("plan", "--experiment", EXAMPLE, "--journal-dir", out)
    assert plan_call.returncode == 0, plan_call.stdout + plan_call.stderr
    plan = json.loads(plan_call.stdout)
    args = ("run", "--experiment", EXAMPLE, "--journal-dir", out,
            "--plan-digest", plan["plan_digest"])
    run = cli(*args)
    assert run.returncode == 0, run.stdout + run.stderr
    result = json.loads(run.stdout)
    assert result["status"] == "completed"
    assert result["conclusion"] == "recommend_candidate"
    assert result["improvement_proven"] is False  # explicit fixture
    assert result["cost_usd"] == 0
    history = (out / "history.jsonl").read_bytes()
    repeat = cli(*args)
    assert repeat.returncode == 0, repeat.stdout + repeat.stderr
    assert json.loads(repeat.stdout)["reused_artifacts"] is True
    assert (out / "history.jsonl").read_bytes() == history
    assert (out / "final.json").exists()
    assert (out / "baseline.txt").read_bytes() == (EXAMPLE.parent / "baseline.txt").read_bytes()


def experiment(tmp_path, **options):
    cfg = yaml.safe_load(EXAMPLE.read_text())
    cfg["agent"]["target_snapshot"] = str(EXAMPLE.parent / "baseline.txt")
    cfg["agent"]["adapter"] = str(EXAMPLE.parent / "adapter.py")
    cfg["agent"]["adapter_options"] = options
    path = tmp_path / "experiment.yml"
    path.write_text(yaml.safe_dump(cfg))
    return path, cfg


@pytest.mark.parametrize("options, conclusion", [
    ({"no_improvement": True}, "retain_baseline"),
    ({"invalid_candidate": True}, "insufficient_evidence"),
    ({"evaluation_failure": True}, "insufficient_evidence"),
])
def test_negative_paths_retain_honest_result(tmp_path, options, conclusion):
    source, cfg = experiment(tmp_path, **options)
    out = tmp_path / "run"
    plan_call = cli("plan", "--experiment", source, "--journal-dir", out)
    assert plan_call.returncode == 0, plan_call.stdout
    plan = json.loads(plan_call.stdout)
    run = cli("run", "--experiment", source, "--journal-dir", out, "--plan-digest", plan["plan_digest"])
    assert run.returncode == 0, run.stdout + run.stderr
    result = json.loads(run.stdout)
    assert result["conclusion"] == conclusion
    assert result["improvement_proven"] is False
    if not options.get("no_improvement"):
        assert result["failure_candidates"]
    if options.get("evaluation_failure"):
        assert result["cost_usd"] is None


@pytest.mark.parametrize("change, code", [
    ("budget", "BUDGET_INSUFFICIENT"), ("metrics", "INCOMPATIBLE_INPUT"),
    ("split", "INCOMPATIBLE_INPUT"), ("paid", "PERMISSION_UNSUPPORTED"),
    ("evaluator", "EVALUATOR_MISSING"), ("direction", "INCOMPATIBLE_INPUT"),
])
def test_preflight_rejects_before_output_or_adapter_execution(tmp_path, change, code):
    source, cfg = experiment(tmp_path)
    if change == "budget":
        cfg["contract"]["budget"]["max_fast_evals"] = 1
    elif change == "metrics":
        cfg["agent"]["evaluators"]["slow"]["metrics"] = ["wrong_metric"]
    elif change == "split":
        cfg["agent"]["evaluators"]["final"]["data_id"] = cfg["agent"]["evaluators"]["fast"]["data_id"]
    elif change == "paid":
        cfg["agent"]["permissions"]["paid"] = True
    elif change == "evaluator":
        del cfg["agent"]["evaluators"]["slow"]
    elif change == "direction":
        cfg["contract"]["upper_objective"]["direction"] = "minimize"
    source.write_text(yaml.safe_dump(cfg))
    call = cli("plan", "--experiment", source, "--journal-dir", tmp_path / "run")
    assert call.returncode == 2
    assert json.loads(call.stdout)["error"]["code"] == code
    assert not (tmp_path / "run").exists()


def test_changed_input_cannot_use_previous_plan(tmp_path):
    source, cfg = experiment(tmp_path)
    out = tmp_path / "run"
    plan = json.loads(cli("plan", "--experiment", source, "--journal-dir", out).stdout)
    cfg["generations"] += 1
    source.write_text(yaml.safe_dump(cfg))
    call = cli("run", "--experiment", source, "--journal-dir", out, "--plan-digest", plan["plan_digest"])
    assert call.returncode == 2
    assert json.loads(call.stdout)["error"]["code"] == "PLAN_CHANGED"
    assert not out.exists()


def test_unfinished_run_cannot_be_blindly_repeated(tmp_path):
    out = tmp_path / "run"
    plan = json.loads(cli("plan", "--experiment", EXAMPLE, "--journal-dir", out).stdout)
    out.mkdir()
    call = cli("run", "--experiment", EXAMPLE, "--journal-dir", out, "--plan-digest", plan["plan_digest"])
    assert call.returncode == 2
    assert json.loads(call.stdout)["error"]["code"] == "RUN_UNCERTAIN"
    assert list(out.iterdir()) == []


def test_status_is_actually_read_only(tmp_path):
    out = tmp_path / "does-not-exist"
    call = cli("status", "--journal-dir", out)
    assert call.returncode == 0
    assert not out.exists()


def test_fast_only_has_no_final_or_champion_claim(tmp_path):
    source, cfg = experiment(tmp_path)
    del cfg["contract"]["upper_objective"]
    del cfg["agent"]["evaluators"]["slow"]
    del cfg["agent"]["evaluators"]["final"]
    source.write_text(yaml.safe_dump(cfg))
    out = tmp_path / "run"
    plan = json.loads(cli("plan", "--experiment", source, "--journal-dir", out).stdout)
    call = cli("run", "--experiment", source, "--journal-dir", out, "--plan-digest", plan["plan_digest"])
    assert call.returncode == 0, call.stdout + call.stderr
    result = json.loads(call.stdout)
    assert result["mode"] == "fast_only"
    assert result["conclusion"] == "insufficient_evidence"
    assert not (out / "final.json").exists()


def test_caller_can_replace_selection_without_core_edits(tmp_path):
    source, cfg = experiment(tmp_path)
    adapter = tmp_path / "caller.py"
    adapter.write_text((EXAMPLE.parent / "adapter.py").read_text() + '''
original_factory = create_bindings
class HoldAll:
    def select(self, comparison, ids, remaining):
        return [], {cid: "held" for cid in ids}
def create_bindings(**kwargs):
    bindings = original_factory(**kwargs)
    bindings["gate"] = HoldAll()
    return bindings
''')
    cfg["agent"]["adapter"] = str(adapter)
    source.write_text(yaml.safe_dump(cfg))
    out = tmp_path / "run"
    plan = json.loads(cli("plan", "--experiment", source, "--journal-dir", out).stdout)
    call = cli("run", "--experiment", source, "--journal-dir", out, "--plan-digest", plan["plan_digest"])
    assert call.returncode == 0, call.stdout + call.stderr
    result = json.loads(call.stdout)
    assert result["conclusion"] == "insufficient_evidence"
    assert result["counters"]["selection_calls"] > 0


def test_nonzero_or_unknown_evaluator_cost_is_not_reported_as_zero(tmp_path):
    source, cfg = experiment(tmp_path)
    adapter = tmp_path / "caller.py"
    adapter.write_text((EXAMPLE.parent / "adapter.py").read_text().replace("cost_usd=0)", "cost_usd=None)"))
    cfg["agent"]["adapter"] = str(adapter)
    source.write_text(yaml.safe_dump(cfg))
    out = tmp_path / "run"
    plan = json.loads(cli("plan", "--experiment", source, "--journal-dir", out).stdout)
    call = cli("run", "--experiment", source, "--journal-dir", out, "--plan-digest", plan["plan_digest"])
    data = json.loads(call.stdout)
    assert data["cost_usd"] is None
    assert data["conclusion"] == "run_failed"


@pytest.mark.parametrize("mode", ["baseline", "single_loop"])
def test_comparison_controls_report_actual_mode_and_do_not_run_slow_validation(tmp_path, mode):
    source, cfg = experiment(tmp_path)
    cfg["agent"]["search_mode"] = mode
    source.write_text(yaml.safe_dump(cfg))
    out = tmp_path / "run"
    plan = json.loads(cli("plan", "--experiment", source, "--journal-dir", out).stdout)
    assert plan["mode"] == mode
    call = cli("run", "--experiment", source, "--journal-dir", out, "--plan-digest", plan["plan_digest"])
    assert call.returncode == 0, call.stdout + call.stderr
    result = json.loads(call.stdout)
    assert result["mode"] == mode
    assert result["summary"]["slow_evals"] == 0
    if mode == "baseline":
        assert result["counters"]["generator_calls"] == 0
    else:
        assert result["counters"]["generator_calls"] == cfg["generations"]
    assert (out / "final.json").exists()


def custom_run(tmp_path, transform, **options):
    generations = options.pop("_generations", None)
    top_k = options.pop("_top_k", None)
    failure_limit = options.pop("_failure_limit", None)
    source, cfg = experiment(tmp_path, **options)
    if generations is not None:
        cfg["generations"] = generations
    if top_k is not None:
        cfg["promotion"]["top_k"] = top_k
    if failure_limit is not None:
        cfg["agent"]["max_consecutive_failures"] = failure_limit
    adapter = tmp_path / "caller.py"
    adapter.write_text(transform((EXAMPLE.parent / "adapter.py").read_text()))
    cfg["agent"]["adapter"] = str(adapter)
    source.write_text(yaml.safe_dump(cfg))
    out = tmp_path / "run"
    plan = json.loads(cli("plan", "--experiment", source, "--journal-dir", out).stdout)
    return cli("run", "--experiment", source, "--journal-dir", out, "--plan-digest", plan["plan_digest"]), out


def test_failed_final_baseline_cannot_return_retain_baseline(tmp_path):
    call, out = custom_run(tmp_path, lambda s: s.replace(
        'else "slow", True,', 'else "slow", self.tier != "final",'), no_improvement=True)
    result = json.loads(call.stdout)
    assert result["conclusion"] in ("insufficient_evidence", "run_failed")
    assert result["improvement_proven"] is False


def test_inadmissible_baseline_sample_size_cannot_support_conclusion(tmp_path):
    call, out = custom_run(tmp_path, lambda s: s.replace('"sample_size": 1', '"sample_size": 0'))
    assert json.loads(call.stdout)["conclusion"] in ("insufficient_evidence", "run_failed")


def test_returned_failed_evaluations_obey_failure_limit(tmp_path):
    call, out = custom_run(tmp_path, lambda s: s.replace(
        'else "slow", True,', 'else "slow", candidate.generation == 0,'))
    result = json.loads(call.stdout)
    assert result["status"] == "stopped"
    assert result["summary"]["stop_reason"] == "consecutive_failures"
    assert result["summary"]["fast_evals"] == 4


def test_empty_generator_is_a_stop_without_optimization_evidence(tmp_path):
    call, out = custom_run(tmp_path, lambda s: s.replace('return candidates', 'return []'))
    result = json.loads(call.stdout)
    assert result["status"] == "stopped"
    assert result["summary"]["stop_reason"] == "no_candidates"
    assert result["conclusion"] == "insufficient_evidence"


def test_standard_dataclass_adapter_loads(tmp_path):
    call, out = custom_run(tmp_path, lambda s: 'from __future__ import annotations\nfrom dataclasses import dataclass\n@dataclass\nclass Record:\n    value: int = 1\n' + s)
    assert call.returncode == 0, call.stdout + call.stderr


def test_failed_gate_preserves_spent_attempt_counters(tmp_path):
    call, out = custom_run(tmp_path, lambda s: s + '''
original = create_bindings
class BadGate:
    def select(self, *args):
        raise RuntimeError("selection failed")
def create_bindings(**kwargs):
    result = original(**kwargs)
    result["gate"] = BadGate()
    return result
''')
    result = json.loads(call.stdout)
    assert result["status"] == "failed"
    assert result["attempts"]["fast"] == 4
    assert result["attempts"]["slow"] == 1


def test_output_parent_regular_file_yields_structured_error(tmp_path):
    parent = tmp_path / "regular-file"
    parent.write_text("keep")
    call = cli("plan", "--experiment", EXAMPLE, "--journal-dir", parent / "run")
    assert call.returncode == 2
    assert json.loads(call.stdout)["error"]["code"] == "OUTPUT_CONFLICT"
    assert parent.read_text() == "keep"


def test_status_does_not_report_stale_success_after_artifact_changed(tmp_path):
    call, out = custom_run(tmp_path, lambda s: s)
    assert call.returncode == 0
    (out / "baseline.txt").write_text("changed")
    status = cli("status", "--journal-dir", out)
    assert status.returncode == 2
    assert json.loads(status.stdout)["error"]["code"] == "ARTIFACT_CONFLICT"


def test_unknown_slow_cost_stops_before_final_confirmation(tmp_path):
    call, out = custom_run(tmp_path, lambda s: s.replace(
        'if self.options.get("evaluation_failure") and candidate.generation:',
        'if self.tier == "slow" and candidate.generation:'), _generations=1)
    result = json.loads(call.stdout)
    assert result["status"] == "stopped"
    assert result["cost_usd"] is None
    assert result["attempts"]["final"] == 0


def test_last_generation_fast_exception_does_not_trigger_final(tmp_path):
    call, out = custom_run(tmp_path, lambda s: s.replace('return candidates', 'return candidates[:1]'),
                           evaluation_failure=True, _generations=1)
    result = json.loads(call.stdout)
    assert result["status"] == "stopped"
    assert result["attempts"]["final"] == 0
    assert result["cost_usd"] is None


def test_first_unknown_slow_cost_stops_remaining_slow_candidates(tmp_path):
    call, out = custom_run(tmp_path, lambda s: s.replace(
        'if self.options.get("evaluation_failure") and candidate.generation:',
        'if self.tier == "slow" and candidate.generation:'), _generations=1, _top_k=3)
    result = json.loads(call.stdout)
    assert result["status"] == "stopped"
    assert result["attempts"]["slow"] == 2
    assert result["attempts"]["final"] == 0


def test_successful_slow_evaluation_resets_consecutive_failures(tmp_path):
    call, out = custom_run(tmp_path, lambda s: s.replace(
        'else "slow", True,',
        'else "slow", not (self.tier == "slow" and candidate.id in ("dl-0002", "dl-0004")),'),
        _generations=1, _top_k=3, _failure_limit=2)
    result = json.loads(call.stdout)
    assert result["status"] == "completed"
    assert result["counters"]["consecutive_failures"] == 1


def test_partial_journal_status_preserves_bytes_and_returns_recovery_error(tmp_path):
    out = tmp_path / "run"
    out.mkdir()
    (out / "plan.json").write_text("{}")
    broken = b'{"experiment_id": "incomplete'
    (out / "history.jsonl").write_bytes(broken)
    call = cli("status", "--journal-dir", out)
    assert call.returncode == 2
    assert json.loads(call.stdout)["error"]["code"] == "JOURNAL_INCOMPLETE"
    assert (out / "history.jsonl").read_bytes() == broken


def test_last_generation_generator_failure_stops_before_final(tmp_path):
    call, out = custom_run(tmp_path, lambda s: s.replace('return candidates', 'raise RuntimeError("generation failed")'),
                           _generations=1)
    result = json.loads(call.stdout)
    assert result["status"] == "stopped"
    assert result["attempts"]["final"] == 0
