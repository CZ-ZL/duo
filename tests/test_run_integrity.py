import pytest

from test_controller import config
from dualloop.controller import build_controller
from dualloop.models import Candidate, Delta
from dualloop.plugins.docs_qa_target import DEFAULT_PERSONA, SystemPromptMutator


def candidate(parent_id="parent", patch=None):
    return Candidate("child", "e", parent_id, 1, "f", "exploit",
                     Delta("cordis-overlay", "system-prompt", patch or
                           {"persona": DEFAULT_PERSONA + " Be precise."}), "hypothesis")


def test_mutator_rejects_wrong_parent_and_forbidden_patch_without_writes(tmp_path):
    parent = candidate()
    parent.id = "parent"
    mutator = SystemPromptMutator(tmp_path / "patches")
    with pytest.raises(ValueError, match="parent"):
        mutator.apply(candidate(parent_id="stale"), parent)
    with pytest.raises(ValueError, match="patch"):
        mutator.apply(candidate(patch={"persona": DEFAULT_PERSONA, "permissions": "all"}), parent)
    assert not (tmp_path / "patches").exists()


def test_failed_evaluator_attempts_consume_budget(tmp_path):
    cfg = config(generations=4)
    cfg["contract"]["budget"]["max_fast_evals"] = 2
    controller = build_controller(cfg, tmp_path)
    evaluate = controller.fast_evaluator.evaluate
    calls = []

    def broken(c, a):
        calls.append(c.id)
        if c.generation:
            raise RuntimeError("failed after work started")
        return evaluate(c, a)

    controller.fast_evaluator.evaluate = broken
    summary = controller.run()
    assert len(calls) == 2
    assert summary.fast_evals == 2
    assert summary.stop_reason == "budget:max_fast_evals"


def test_invalid_candidate_parent_is_rejected_before_executor(tmp_path):
    controller = build_controller(config(generations=1), tmp_path)
    propose = controller.generator.propose

    def stale(*args):
        candidates = propose(*args)
        for c in candidates:
            c.parent_id = "wrong-version"
        return candidates

    controller.generator.propose = stale
    summary = controller.run()
    assert summary.fast_evals == 1  # baseline only
    assert all(e.status == "error" for e in controller.journal.latest().values()
               if e.generation)


def test_wall_budget_prevents_generation(tmp_path):
    cfg = config(generations=3)
    cfg["contract"]["budget"]["max_wall_time_hours"] = 1e-12
    controller = build_controller(cfg, tmp_path)
    calls = []
    controller.generator.propose = lambda *a: calls.append(a) or []
    summary = controller.run()
    assert calls == []
    assert summary.stop_reason == "budget:max_wall_time_hours"


def test_unknown_evaluation_cost_is_not_reported_as_free(tmp_path):
    controller = build_controller(config(generations=1), tmp_path)
    evaluate = controller.fast_evaluator.evaluate

    def unknown(c, a):
        value = evaluate(c, a)
        value.cost_usd = None
        return value

    controller.fast_evaluator.evaluate = unknown
    summary = controller.run()
    assert summary.cost_usd is None
    assert summary.stop_reason == "budget:unknown_cost"


def test_same_output_directory_cannot_blindly_restart_existing_controller(tmp_path):
    controller = build_controller(config(generations=1), tmp_path)
    controller.run()
    history = (tmp_path / "history.jsonl").read_bytes()
    with pytest.raises(RuntimeError, match="existing journal"):
        build_controller(config(generations=1), tmp_path).run()
    assert (tmp_path / "history.jsonl").read_bytes() == history


def test_snapshot_baseline_is_explicit_and_delta_requires_content_parent(tmp_path):
    mutator = SystemPromptMutator(tmp_path)
    mutator.baseline_persona = DEFAULT_PERSONA
    base = Candidate("parent", "e", None, 0, "baseline", "exploit",
                     Delta("identity", "system-prompt", {}), "baseline")
    applied = mutator.apply(base, None)
    assert applied["persona"] == DEFAULT_PERSONA
    child = candidate()
    child.delta.parent_version = "wrong-content"
    with pytest.raises(ValueError, match="version"):
        mutator.apply(child, base)
    assert not (tmp_path / "child.yml").exists()
