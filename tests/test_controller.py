"""Loop mechanics end-to-end in mock mode: baseline -> generations -> slow
eval -> champion update; proxy-trap feedback; fail-closed; hypothesis
enforcement; fast-only and explore degradation; budget stops."""
import copy

import pytest
import yaml

from pathlib import Path

from dualloop.contract import EXPLORE_LABEL, PROXY_ONLY_LABEL
from dualloop.controller import build_controller
from dualloop.feedback import FeedbackEngine
from dualloop.journal import JsonlJournal
from dualloop.models import Candidate, Delta, FeedbackSummary
from dualloop.plugins.mock import MockMutator

MOCK_YML = Path(__file__).resolve().parent.parent / "experiments" / "mock.yml"
TRAP = "proxy-trap"


def config(**overrides):
    cfg = yaml.safe_load(MOCK_YML.read_text(encoding="utf-8"))
    cfg.update(overrides)
    return cfg


def run(tmp_path, **overrides):
    cfg = config(**overrides)
    controller = build_controller(cfg, tmp_path / "journal")
    summary = controller.run()
    return summary, controller, JsonlJournal(tmp_path / "journal")


def feedback(journal):
    return FeedbackEngine().compute(
        list(journal.latest().values()), ["dev_benchmark_score", "avg_cost_usd"],
        "task_success_rate", {"exploit": 3, "explore": 3, "innovate": 2})


def gen_candidates(journal, gen):
    seen = {}
    for e in journal.by_generation(gen):
        seen[e.candidate_id] = e
    return list(seen.values())


class TestEndToEnd:
    def test_baseline_to_champion_update_path(self, tmp_path):
        summary, _, journal = run(tmp_path, generations=4)
        assert summary.mode == "optimize"
        assert summary.stop_reason == "completed"
        assert summary.generations_run == 4

        latest = journal.latest()
        baseline = latest["dl-0001"]
        assert baseline.status == "champion" and baseline.slow_decision == "champion"
        assert baseline.fast.ok and baseline.slow.ok
        # champion updated off the baseline via the slow loop
        assert summary.champion_id != "dl-0001"
        champ = latest[summary.champion_id]
        assert champ.status == "champion" and champ.slow_decision == "champion"
        assert champ.slow.metrics["task_success_rate"] > (
            baseline.slow.metrics["task_success_rate"] + 0.02)

        # full status-transition chain was journaled for the champion
        transitions = [e.status for e in journal.for_candidate(summary.champion_id)]
        for status in ("proposed", "fast_evaluated", "slow_evaluated", "champion"):
            assert status in transitions

        # budgets respected
        assert summary.fast_evals <= 60 and summary.slow_evals <= 8

    def test_assigned_diversity_quotas_are_structural(self, tmp_path):
        run(tmp_path, generations=1)
        journal = JsonlJournal(tmp_path / "journal")
        cands = gen_candidates(journal, 1)
        counts = {"exploit": 0, "explore": 0, "innovate": 0}
        for c in cands:
            counts[c.mode] += 1
        assert counts == {"exploit": 3, "explore": 3, "innovate": 2}
        # exploit = champion family; explore = different families; innovate = compositional
        assert all(c.family == "baseline" for c in cands if c.mode == "exploit")
        assert any("+" in c.family for c in cands if c.mode == "innovate")

    def test_proxy_trap_feedback_closes_the_loop(self, tmp_path):
        run(tmp_path, generations=4)
        journal = JsonlJournal(tmp_path / "journal")
        fb = feedback(journal)

        # the trap family failed slow exactly twice, then was penalized
        trap = fb.family_outcomes[TRAP]
        assert trap.slow_failures == 2 and trap.penalized
        assert TRAP in fb.penalized_families
        assert trap.fast_avg > 0.9 and trap.slow_avg < 0.4   # A(0.91)/B(0.79) shape

        # a family with only ONE slow failure is NOT penalized
        one_failure = [f for f, o in fb.family_outcomes.items()
                       if o.slow_failures == 1]
        assert one_failure, "expected a singly-failed family in this run"
        assert all(not fb.family_outcomes[f].penalized for f in one_failure)

        # emphasis shifted by exactly the bounded +/-1 slot
        assert fb.suggested_emphasis == {"exploit": 4, "explore": 2, "innovate": 2}

        # ...and generation 3's candidate mix observably shows it
        gen3 = gen_candidates(journal, 3)
        counts = {"exploit": 0, "explore": 0, "innovate": 0}
        for c in gen3:
            counts[c.mode] += 1
        assert counts == {"exploit": 4, "explore": 2, "innovate": 2}
        # post-penalization generations contain no proxy-trap material,
        # while pre-penalization generations did
        assert any(TRAP in c.family for c in gen_candidates(journal, 2))
        assert all(TRAP not in c.family for c in gen_candidates(journal, 3))
        assert all(TRAP not in c.family for c in gen_candidates(journal, 4))

    def test_hypothesis_recorded_for_every_candidate(self, tmp_path):
        run(tmp_path, generations=2)
        journal = JsonlJournal(tmp_path / "journal")
        for e in journal.read():
            if e.status == "proposed":
                assert e.hypothesis.strip(), f"{e.candidate_id} missing hypothesis"
                assert e.delta_ref


class TestFailClosed:
    def test_plugin_exception_journals_ok_false_and_loop_continues(self, tmp_path):
        summary, _, journal = run(
            tmp_path, generations=2,
            executor_fail_for_families=["citation-rigor"])
        assert summary.stop_reason == "completed"   # loop survived
        errors = [e for e in journal.read() if e.status == "error"]
        assert errors, "expected fail-closed error entries"
        for e in errors:
            assert e.failure_reason and "executor" in e.failure_reason
            assert e.fast is not None and e.fast.ok is False
        # other candidates were still evaluated around the failures
        evaluated = [e for e in journal.latest().values()
                     if e.fast is not None and e.fast.ok]
        assert len(evaluated) > 5

    def test_mutator_rejects_candidate_without_hypothesis(self):
        mutator = MockMutator()
        bad = Candidate(id="dl-x", experiment_id="e", parent_id=None,
                        generation=1, family="f", mode="exploit", hypothesis="",
                        hypothesis_first=True,
                        delta=Delta(kind="k", target="t", patch={}))
        with pytest.raises(ValueError, match="hypothesis"):
            mutator.apply(bad, None)
        no_order = Candidate(id="dl-y", experiment_id="e", parent_id=None,
                             generation=1, family="f", mode="exploit",
                             hypothesis="post-hoc rationalization",
                             hypothesis_first=False,
                             delta=Delta(kind="k", target="t", patch={}))
        with pytest.raises(ValueError, match="hypothesis"):
            mutator.apply(no_order, None)

    def test_generator_exception_is_journaled_and_loop_continues(self, tmp_path):
        cfg = config(generations=2)
        controller = build_controller(cfg, tmp_path / "journal")
        real_propose = controller.generator.propose
        state = {"calls": 0}

        def flaky(champion, fb, quotas, generation, next_id):
            state["calls"] += 1
            if generation == 1:
                raise RuntimeError("mock generator blew up")
            return real_propose(champion, fb, quotas, generation, next_id)

        controller.generator.propose = flaky
        summary = controller.run()
        journal = JsonlJournal(tmp_path / "journal")
        assert summary.stop_reason == "completed"
        assert summary.generations_run == 2
        assert any(e.status == "error" and "generator" in (e.failure_reason or "")
                   for e in journal.read())


class TestDegradationModes:
    def test_fast_only_labels_proxy_only_and_crowns_no_champion(self, tmp_path):
        cfg = config(generations=2)
        del cfg["contract"]["upper_objective"]
        controller = build_controller(cfg, tmp_path / "journal")
        summary = controller.run()
        assert summary.mode == "fast_only"
        assert PROXY_ONLY_LABEL in summary.labels
        assert summary.slow_evals == 0
        assert summary.champion_id is None          # no champion on proxy evidence
        assert summary.proxy_leader_id is not None

    def test_explore_mode_delivers_insight_not_ranking(self, tmp_path):
        cfg = config(generations=2)
        del cfg["contract"]["comparison"]
        controller = build_controller(cfg, tmp_path / "journal")
        summary = controller.run()
        assert summary.mode == "explore"
        assert EXPLORE_LABEL in summary.labels
        assert summary.insight and "families" in summary.insight
        assert summary.champion_id is None

    def test_budget_stops_loop_cleanly_mid_state(self, tmp_path):
        summary, _, journal = run(tmp_path, generations=4)
        cfg = config(generations=4)
        cfg["contract"]["budget"]["max_fast_evals"] = 5
        controller = build_controller(cfg, tmp_path / "journal2")
        summary = controller.run()
        assert summary.stop_reason == "budget:max_fast_evals"
        assert summary.generations_run < 4
        assert summary.fast_evals <= 5
        # journal intact: everything up to the stop is recorded
        assert journal is not None
        assert len(JsonlJournal(tmp_path / "journal2").read()) > 0
