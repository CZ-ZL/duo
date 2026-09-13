"""Comparator: weights, hard-constraint REJECTS, incumbent epsilon,
incomparable-on-low-sample. Evaluators emit facts; verdicts live only here."""
from dualloop.comparator import TopKPromotionGate, WeightedComparator
from dualloop.contract import Constraint
from dualloop.models import EvaluationResult

CONSTRAINTS = [
    Constraint(metric="avg_cost_usd", op="<", value=0.50),
    Constraint(metric="safety_pass", op="==", value=True),
]


def result(cid, score, cost=0.01, safety=True, sample=30, metric="dev_benchmark_score"):
    return EvaluationResult(candidate_id=cid, evaluator_id="mock_fast", tier="fast",
                            ok=True, metrics={metric: score, "avg_cost_usd": cost,
                                              "safety_pass": safety,
                                              "sample_size": sample})


def comparator(**cfg):
    base = dict(weights={"dev_benchmark_score": 1.0, "avg_cost_usd": -0.2},
                min_sample_size=4, incumbent_epsilon=0.02)
    base.update(cfg)
    return WeightedComparator(base)


class TestWeights:
    def test_weighted_score_orders_ranking(self):
        comp = comparator()
        out = comp.compare([result("a", 0.6), result("b", 0.8), result("c", 0.7)])
        assert out.ranking[:3] == ["b", "c", "a"]
        assert out.comparator_id == "weighted_v1"

    def test_cost_weight_is_negative(self):
        comp = comparator()
        cheap = result("cheap", 0.7, cost=0.01)
        pricey = result("pricey", 0.7, cost=0.40)
        out = comp.compare([cheap, pricey])
        assert out.ranking[0] == "cheap"


class TestConstraints:
    def test_safety_violation_rejects_not_penalizes(self):
        comp = comparator()
        out = comp.compare([result("good", 0.6), result("unsafe", 0.99, safety=False)],
                           CONSTRAINTS)
        assert out.verdicts["unsafe"] == "constraint_violation"
        assert out.verdicts["good"] != "constraint_violation"
        assert out.ranking[0] == "good"          # 0.99 does not buy a pass
        assert out.ranking[-1] == "unsafe"

    def test_cost_violation_rejects(self):
        comp = comparator()
        out = comp.compare([result("x", 0.9, cost=0.99)], CONSTRAINTS)
        assert out.verdicts["x"] == "constraint_violation"

    def test_missing_constraint_metric_fails_closed(self):
        r = EvaluationResult(candidate_id="blind", evaluator_id="e", tier="fast",
                             ok=True, metrics={"dev_benchmark_score": 0.9})
        out = comparator().compare([r], CONSTRAINTS)
        assert out.verdicts["blind"] == "constraint_violation"
        assert "missing" in out.rationale


class TestIncumbentEpsilon:
    def test_challenger_within_epsilon_does_not_beat_incumbent(self):
        comp = comparator()
        out = comp.compare([result("champ", 0.80), result("chal", 0.81)],
                           incumbent_id="champ")
        assert out.verdicts["chal"] == "worse"   # 0.01 < epsilon 0.02

    def test_challenger_beyond_epsilon_beats_incumbent(self):
        comp = comparator()
        out = comp.compare([result("champ", 0.80), result("chal", 0.83)],
                           incumbent_id="champ")
        assert out.verdicts["chal"] == "better"
        assert out.verdicts["champ"] == "worse"

    def test_low_sample_size_is_incomparable(self):
        comp = comparator()
        out = comp.compare([result("thin", 0.9, sample=2)])
        assert out.verdicts["thin"] == "incomparable"


class TestPromotionGate:
    def test_top_k_epsilon_and_budget_aware(self):
        comp = comparator()
        comparison = comp.compare(
            [result("champ", 0.70), result("a", 0.90), result("b", 0.85),
             result("c", 0.80), result("d", 0.71)], incumbent_id="champ")
        gate = TopKPromotionGate(top_k=2)
        promoted, decisions = gate.select(comparison, ["a", "b", "c", "d"],
                                          slow_budget_remaining=5)
        assert promoted == ["a", "b"]            # ranked order, top-2
        assert decisions["c"] == "held"          # beats champion, no slot
        assert decisions["d"] == "dropped"       # within epsilon

    def test_budget_zero_holds_everything(self):
        comp = comparator()
        comparison = comp.compare([result("champ", 0.7), result("a", 0.9)],
                                  incumbent_id="champ")
        promoted, decisions = TopKPromotionGate(2).select(comparison, ["a"], 0)
        assert promoted == []
        assert decisions["a"] == "held"

    def test_constraint_violators_never_promoted(self):
        comp = comparator()
        comparison = comp.compare(
            [result("champ", 0.7), result("bad", 0.95, safety=False)],
            CONSTRAINTS, incumbent_id="champ")
        promoted, decisions = TopKPromotionGate(2).select(comparison, ["bad"], 5)
        assert promoted == []
        assert decisions["bad"] == "dropped"
