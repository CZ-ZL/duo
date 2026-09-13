"""Evidence admission must precede ranking and paid slow selection."""
import pytest

from dualloop.comparator import TopKPromotionGate, WeightedComparator
from dualloop.models import EvaluationResult


def result(cid, **updates):
    fields = dict(candidate_id=cid, evaluator_id="eval-v1", tier="fast", ok=True,
                  metrics={"score": .5, "sample_size": 4})
    fields.update(updates)
    return EvaluationResult(**fields)


@pytest.mark.parametrize("updates", [
    {"ok": False, "metrics": {"score": 999, "sample_size": 4}},
    {"metrics": {"sample_size": 4}},
    {"metrics": {"score": float("nan"), "sample_size": 4}},
    {"metrics": {"score": float("inf"), "sample_size": 4}},
    {"metrics": {"score": True, "sample_size": 4}},
    {"metrics": {"score": "1", "sample_size": 4}},
    {"metrics": {"score": 1}},
    {"metrics": {"score": 1, "sample_size": float("nan")}},
    {"evaluator_id": "eval-v2", "metrics": {"score": 1, "sample_size": 4}},
    {"tier": "slow", "metrics": {"score": 1, "sample_size": 4}},
])
def test_invalid_evidence_is_incomparable_and_never_promoted(updates):
    comp = WeightedComparator({"weights": {"score": 1}, "min_sample_size": 4})
    out = comp.compare([result("base"), result("bad", **updates)], incumbent_id="base")
    assert out.verdicts["bad"] == "incomparable"
    assert TopKPromotionGate().select(out, ["bad"], 10)[0] == []


def test_invalid_incumbent_does_not_mean_every_candidate_is_better():
    out = WeightedComparator({"weights": {"score": 1}}).compare(
        [result("base", ok=False), result("challenger")], incumbent_id="base")
    assert out.verdicts["challenger"] == "incomparable"


def test_missing_negative_weight_metric_cannot_look_like_zero_cost():
    out = WeightedComparator({"weights": {"score": 1, "cost": -1}}).compare([
        result("base", metrics={"score": .5, "cost": .2}),
        result("missing", metrics={"score": .5}),
    ], incumbent_id="base")
    assert out.verdicts["missing"] == "incomparable"


def test_best_slow_candidate_wins_regardless_of_evaluation_order(tmp_path):
    from test_controller import config
    from dualloop.controller import build_controller

    controller = build_controller(config(generations=1), tmp_path)

    def propose(champ, feedback, quotas, generation, next_id):
        from dualloop.models import Candidate, Delta
        return [Candidate(next_id(), champ.experiment_id, champ.id, generation,
                          family, "exploit", Delta("prompt-section", "t", {}), "test")
                for family in ("best", "second")]

    def evaluate(candidate, artifact, tier):
        score = {"baseline": .1, "best": .9, "second": .7}[candidate.family]
        return EvaluationResult(candidate.id, "mock_" + tier, tier, True, {
            "dev_benchmark_score": score, "task_success_rate": score,
            "avg_cost_usd": .01, "safety_pass": True, "sample_size": 10}, cost_usd=0)

    controller.generator.propose = propose
    controller.fast_evaluator.evaluate = lambda c, a: evaluate(c, a, "fast")
    controller.slow_evaluator.evaluate = lambda c, a: evaluate(c, a, "slow")
    summary = controller.run()
    assert controller.journal.latest()[summary.champion_id].family == "best"
