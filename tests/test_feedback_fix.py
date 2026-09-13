"""Offline tests for the gen-3 search-side feedback fix (constraint-rejection
digests into the proposer) and the journal-resume path. NO API calls.

Content policy under test: constraint digests carry candidate id, mode,
family, the violated constraint (metric/value/threshold), failing question
ids and missing citation PATHS — never question text, never gold answer
keys.
"""
from __future__ import annotations

import json

import pytest

from dualloop.contract import Constraint
from dualloop.models import Candidate, Delta, EvaluationResult, FeedbackSummary
from dualloop.plugins.llm_generator import (
    LlmDocsQaGenerator, build_proposer_prompt, constraint_rejection_digests,
)
from dualloop.plugins.docs_qa_target import DEFAULT_PERSONA

CONSTRAINTS = [
    Constraint(metric="single_fact_success", op=">=", value=0.95),
    Constraint(metric="citation_strict_success", op=">=", value=0.95),
    Constraint(metric="sandbox_leak_free", op="==", value=True),
]

GOLD_KEY = "127.0.0.1:3080"          # sf-01's gold answer key — must NOT appear
QUESTION_TEXT = "what URL (host and port) do you open"  # sf-01 question text


def _entry(cid, generation, family, mode, sf_rate, artifact=None):
    return type("E", (), {
        "candidate_id": cid, "generation": generation, "family": family,
        "mode": mode,
        "fast": EvaluationResult(
            candidate_id=cid, evaluator_id="docs_qa_dev_v1", tier="fast",
            ok=True,
            metrics={"core_success": 0.7, "single_fact_success": sf_rate,
                     "citation_strict_success": 1.0, "sandbox_leak_free": True},
            artifacts=[artifact] if artifact else []),
    })()


def _details_payload():
    return {"details": [
        {"id": "sf-01", "type": "single_fact", "score": 0.0,
         "missing_gold_files": ["user/develop/basic/tool.md"],
         "missing_answer_keys": []},
        {"id": "sf-03", "type": "single_fact", "score": 1.0},
        {"id": "ab-01", "type": "abstention", "score": 1.0},
    ]}


def test_constraint_digest_includes_rejection_with_question_and_path(tmp_path):
    artifact = tmp_path / "d.json"
    artifact.write_text(json.dumps(_details_payload()), encoding="utf-8")
    entries = [
        _entry("dl-0002", 1, "retrieval-discipline", "exploit", 2 / 3,
               str(artifact)),
        _entry("dl-0006", 2, "citation-rigor", "explore", 1.0),  # clean: excluded
    ]
    loader = lambda p: json.loads(open(p).read())
    lines = constraint_rejection_digests(entries, CONSTRAINTS, loader)
    assert len(lines) == 1
    line = lines[0]
    assert "dl-0002" in line and "retrieval-discipline" in line
    assert "single_fact_success" in line and "0.95" in line
    assert "sf-01" in line and "user/develop/basic/tool.md" in line


def test_constraint_digest_excludes_gold_data(tmp_path):
    payload = _details_payload()
    payload["details"][0]["missing_answer_keys"] = [GOLD_KEY]
    artifact = tmp_path / "d.json"
    artifact.write_text(json.dumps(payload), encoding="utf-8")
    entries = [_entry("dl-0002", 1, "retrieval-discipline", "exploit", 2 / 3,
                      str(artifact))]
    loader = lambda p: json.loads(open(p).read())
    lines = constraint_rejection_digests(entries, CONSTRAINTS, loader)
    assert lines
    joined = "\n".join(lines)
    assert GOLD_KEY not in joined          # no gold answer keys
    assert QUESTION_TEXT not in joined     # no question text


def test_constraint_digest_fail_soft_without_artifacts():
    entries = [_entry("dl-0002", 1, "fam", "exploit", 0.5, artifact=None)]
    lines = constraint_rejection_digests(entries, CONSTRAINTS,
                                         lambda p: (_ for _ in ()).throw(IOError))
    assert len(lines) == 1 and "REJECTED" in lines[0]  # metric line survives


def test_proposer_prompt_carries_constraint_section_and_instruction():
    prompt = build_proposer_prompt(
        "exploit", "retrieval-discipline", "retrieval-discipline",
        DEFAULT_PERSONA, FeedbackSummary(), ["- ab-01: confabulation"],
        ["a", "b"],
        constraint_digests=["- dl-0002 (gen1 exploit, retrieval-discipline): "
                            "REJECTED single_fact_success=0.6667 violates >= 0.95"])
    assert "JOURNALED CONSTRAINT VIOLATIONS" in prompt
    assert "dl-0002" in prompt
    assert "do NOT repeat" in prompt
    assert "HYPOTHESIS must explicitly say how" in prompt


class _FakeRunner:
    def __init__(self):
        self.prompts = []

    def run(self, prompt):
        self.prompts.append(prompt)
        return ("HYPOTHESIS:\nfixes the recorded sf-01 citation miss\n\n"
                f"PERSONA:\n{DEFAULT_PERSONA}")


def test_generator_feeds_constraint_digests_to_proposer(tmp_path):
    artifact = tmp_path / "d.json"
    artifact.write_text(json.dumps(_details_payload()), encoding="utf-8")
    violator = _entry("dl-0002", 1, "retrieval-discipline", "exploit", 2 / 3,
                      str(artifact))
    champ = _entry("dl-0001", 0, "baseline", "exploit", 1.0)

    class FakeJournal:
        def latest(self):
            return {"dl-0002": violator, "dl-0001": champ}

    runner = _FakeRunner()
    gen = LlmDocsQaGenerator(runner=runner, families=["a", "b", "c"],
                             journal=FakeJournal(), constraints=CONSTRAINTS)
    champion = Candidate(id="dl-0001", experiment_id="x", parent_id=None,
                         generation=0, family="baseline", mode="exploit",
                         hypothesis="h", delta=Delta(kind="i", target="t",
                                                     patch={}))
    gen.propose(champion, FeedbackSummary(), {"exploit": 1}, 3, lambda: "dl-0008")
    assert len(runner.prompts) == 1
    assert "dl-0002" in runner.prompts[0]
    assert "JOURNALED CONSTRAINT VIOLATIONS" in runner.prompts[0]


# ---- resume path ------------------------------------------------------------

def _champion_entry_dict(cid="dl-0007", generation=2):
    fast = EvaluationResult(candidate_id=cid, evaluator_id="docs_qa_dev_v1",
                            tier="fast", ok=True,
                            metrics={"core_success": 0.7,
                                     "single_fact_success": 1.0,
                                     "citation_strict_success": 1.0,
                                     "sandbox_leak_free": True})
    slow = EvaluationResult(candidate_id=cid, evaluator_id="docs_qa_holdout_v1",
                            tier="slow", ok=True, metrics={"core_success": 0.75})
    return {
        "experiment_id": "docs-qa-persona-quality", "candidate_id": cid,
        "parent_id": "dl-0001", "generation": generation,
        "family": "citation-rigor+retrieval-discipline", "mode": "innovate",
        "hypothesis": "compose the two strongest families",
        "delta_ref": "abc", "fast": fast.to_dict(), "fast_rank": 1,
        "promotion_decision": "promoted_to_slow", "slow": slow.to_dict(),
        "slow_decision": "champion", "constraint_violations": [],
        "failure_reason": None, "status": "champion", "ts": 1.0,
    }


def _write_journal(root, entries):
    root.mkdir(parents=True, exist_ok=True)
    with (root / "history.jsonl").open("w", encoding="utf-8") as f:
        for e in entries:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")


def test_resume_state_reconstructs_champion_from_journal(tmp_path):
    from dualloop.journal import JsonlJournal
    from dualloop.real_wiring import _build_resume_state

    journal_dir = tmp_path / "journal"
    _write_journal(journal_dir, [_champion_entry_dict()])
    (journal_dir / "patches").mkdir()
    (journal_dir / "patches" / "dl-0007.yml").write_text(
        "- id: system-prompt\n  config:\n    persona: 'P {{model}} {{cwd}}'\n",
        encoding="utf-8")
    journal = JsonlJournal(journal_dir)
    champ, fast, slow = _build_resume_state({}, journal_dir, journal)
    assert champ.id == "dl-0007" and champ.generation == 2
    assert champ.delta.patch["persona"] == "P {{model}} {{cwd}}"
    assert fast.metrics["core_success"] == 0.7
    assert slow.metrics["core_success"] == 0.75


def test_resume_state_requires_a_champion(tmp_path):
    from dualloop.journal import JsonlJournal
    from dualloop.real_wiring import _build_resume_state
    journal_dir = tmp_path / "journal"
    _write_journal(journal_dir, [])
    with pytest.raises(RuntimeError, match="no champion"):
        _build_resume_state({}, journal_dir, JsonlJournal(journal_dir))


def test_controller_resume_continues_at_next_generation(tmp_path):
    """A resumed controller skips the baseline, keeps the incumbent champion,
    continues candidate ids past the journal, and runs only new generations."""
    from dualloop.controller import LoopController
    from dualloop.contract import PluginRegistry
    from dualloop.feedback import FeedbackEngine
    from dualloop.journal import JsonlJournal
    from dualloop.comparator import TopKPromotionGate, WeightedComparator
    from dualloop.plugins.mock import (
        MockExecutor, MockFastEvaluator, MockGenerator, MockMutator,
        MockObjectiveProvider, MockObserver, MockSlowEvaluator,
    )

    _write_journal(tmp_path / "journal", [_champion_entry_dict()])
    journal = JsonlJournal(tmp_path / "journal")
    champ_entry = journal.latest()["dl-0007"]
    champion = Candidate(
        id="dl-0007", experiment_id=champ_entry.experiment_id, parent_id="dl-0001",
        generation=2, family="citation-rigor+retrieval-discipline",
        mode="innovate", hypothesis="h",
        delta=Delta(kind="cordis-overlay", target="system-prompt",
                    patch={"persona": DEFAULT_PERSONA}))
    config = {"id": "docs-qa-persona-quality", "version": 2,
              "target": {"kind": "dsh-persona", "ref": "system-prompt",
                         "editable_space": ["persona"]},
              "baseline": {"ref": "profile:dualloop"},
              "upper_objective": {"metric": "core_success",
                                  "direction": "maximize",
                                  "evaluator": "mock_slow"},
              "lower_objectives": [{"metric": "dev_benchmark_score",
                                    "direction": "maximize",
                                    "evaluator": "mock_fast"}],
              "constraints": [],
              "comparison": {"plugin": "weighted_v1",
                             "config": {"weights": {"dev_benchmark_score": 1.0}}},
              "budget": {"max_fast_evals": 400, "max_slow_evals": 100,
                         "max_cost": 12.0}}
    provider = MockObjectiveProvider(config)
    registry = PluginRegistry(evaluators={"mock_fast", "mock_slow"},
                              comparators={"weighted_v1"},
                              executors={"mock"},
                              baselines={"profile:dualloop"})
    controller = LoopController(
        provider=provider,
        generator=MockGenerator(seed=1, families=["a", "b"]),
        mutator=MockMutator(), executor=MockExecutor(),
        fast_evaluator=MockFastEvaluator(seed=1, trap_family=""),
        slow_evaluator=MockSlowEvaluator(seed=1, trap_family=""),
        comparator=WeightedComparator({"weights": {"dev_benchmark_score": 1.0}}),
        slow_comparator=WeightedComparator({"weights": {"core_success": 1.0}}),
        gate=TopKPromotionGate(top_k=1),
        journal=journal, observer=MockObserver(),
        feedback_engine=FeedbackEngine(), registry=registry,
        quotas={"exploit": 1, "explore": 1}, generations=3,
        resume_state=(champion, champ_entry.fast, champ_entry.slow))
    summary = controller.run()
    # exactly ONE new generation ran (gen 3), not 1-3
    assert summary.generations_run == 3
    assert summary.fast_evals == 2  # 1 exploit + 1 explore, nothing re-run
    # candidate ids continued past the journal's max (dl-0007)
    new_ids = {e.candidate_id for e in journal.latest().values()}
    assert "dl-0008" in new_ids and "dl-0009" in new_ids
    assert "dl-0001" not in new_ids  # baseline was not re-created
    # the incumbent was the parent of the new generation
    gen3 = [e for e in journal.latest().values() if e.generation == 3]
    assert all(e.parent_id == "dl-0007" for e in gen3)
