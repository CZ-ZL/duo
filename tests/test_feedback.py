"""FeedbackEngine conservatism (audit A3): both directions of the >=2 slow
failure rule, insufficient-data labeling, bounded emphasis shifts. Feedback
steers generation, never measurement."""
from dualloop.feedback import FeedbackEngine
from dualloop.models import EvaluationResult, JournalEntry

BASE = {"exploit": 3, "explore": 3, "innovate": 2}


def ev(cid, tier, metric, value):
    return EvaluationResult(candidate_id=cid, evaluator_id=f"mock_{tier}",
                            tier=tier, ok=True,
                            metrics={metric: value, "sample_size": 30})


def slow_rejected(cid, family, gen, mode="explore", fast_score=0.9, slow_score=0.3):
    return JournalEntry(
        experiment_id="e", candidate_id=cid, parent_id=None, generation=gen,
        family=family, mode=mode, hypothesis="h", delta_ref="d",
        fast=ev(cid, "fast", "dev_benchmark_score", fast_score),
        slow=ev(cid, "slow", "task_success_rate", slow_score),
        slow_decision="rejected", status="rejected")


def slow_champion(cid, family, gen, fast_score=0.8, slow_score=0.7):
    return JournalEntry(
        experiment_id="e", candidate_id=cid, parent_id=None, generation=gen,
        family=family, mode="explore", hypothesis="h", delta_ref="d",
        fast=ev(cid, "fast", "dev_benchmark_score", fast_score),
        slow=ev(cid, "slow", "task_success_rate", slow_score),
        slow_decision="champion", status="champion")


def engine(**kw):
    return FeedbackEngine(**kw)


class TestConservativePenalization:
    def test_one_slow_failure_does_NOT_penalize(self):
        entries = [slow_rejected("c1", "trap", 1)]
        fb = engine().compute(entries, ["dev_benchmark_score"],
                              "task_success_rate", BASE)
        assert fb.family_outcomes["trap"].slow_failures == 1
        assert fb.family_outcomes["trap"].penalized is False
        assert fb.penalized_families == []
        assert fb.failed_proxy_regions == []
        assert fb.suggested_emphasis == BASE      # emphasis untouched

    def test_two_slow_failures_penalize(self):
        entries = [slow_rejected("c1", "trap", 1), slow_rejected("c2", "trap", 2)]
        fb = engine().compute(entries, ["dev_benchmark_score"],
                              "task_success_rate", BASE)
        out = fb.family_outcomes["trap"]
        assert out.slow_failures == 2 and out.penalized is True
        assert fb.penalized_families == ["trap"]
        assert any("proxy-trap" in r or "trap" in r for r in fb.failed_proxy_regions)
        assert out.fast_avg > out.slow_avg        # proxy trap shape

    def test_threshold_is_configurable(self):
        entries = [slow_rejected("c1", "trap", 1)]
        fb = engine(slow_failure_threshold=1).compute(
            entries, ["dev_benchmark_score"], "task_success_rate", BASE)
        assert fb.penalized_families == ["trap"]

    def test_emphasis_shift_bounded_to_one_slot(self):
        # THREE penalized families, but the shift is still bounded to +/-1.
        entries = []
        for fam in ("trap-a", "trap-b", "trap-c"):
            entries += [slow_rejected(f"{fam}1", fam, 1),
                        slow_rejected(f"{fam}2", fam, 2)]
        fb = engine().compute(entries, ["dev_benchmark_score"],
                              "task_success_rate", BASE)
        emph = fb.suggested_emphasis
        moved_from_explore = BASE["explore"] - emph["explore"]
        gained_exploit = emph["exploit"] - BASE["exploit"]
        assert moved_from_explore <= 1 and gained_exploit <= 1
        assert sum(emph.values()) == sum(BASE.values())   # quotas conserved

    def test_mixed_family_one_failure_each_not_penalized(self):
        entries = [slow_rejected("c1", "trap", 1),
                   slow_champion("c2", "trap", 2)]
        fb = engine().compute(entries, ["dev_benchmark_score"],
                              "task_success_rate", BASE)
        assert fb.penalized_families == []        # 1 failure + 1 success


class TestInsufficientData:
    def test_correlation_below_min_sample_size_is_insufficient_data(self):
        entries = [slow_champion(f"c{i}", f"f{i}", 1) for i in range(3)]
        fb = engine(min_sample_size=4).compute(
            entries, ["dev_benchmark_score"], "task_success_rate", BASE)
        assert fb.fast_slow_correlation["dev_benchmark_score"] == "insufficient_data"

    def test_correlation_computed_with_enough_samples(self):
        entries = [slow_champion(f"c{i}", f"f{i}", 1,
                                 fast_score=0.5 + i * 0.05,
                                 slow_score=0.5 + i * 0.04) for i in range(5)]
        fb = engine(min_sample_size=4).compute(
            entries, ["dev_benchmark_score"], "task_success_rate", BASE)
        corr = fb.fast_slow_correlation["dev_benchmark_score"]
        assert isinstance(corr, float) and corr > 0.9


class TestChampionLineage:
    def test_lineage_ordered_by_time(self):
        entries = [slow_champion("c1", "a", 1), slow_champion("c2", "b", 2)]
        fb = engine().compute(entries, ["dev_benchmark_score"],
                              "task_success_rate", BASE)
        assert fb.champion_lineage == ["c1", "c2"]
