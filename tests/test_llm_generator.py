"""Offline tests for the real demo machinery: LLM generator parsing +
operator structure, thread-safe budget, parallel evaluator, seeded baseline,
and real-wiring construction. NO API calls anywhere in this file.
"""
from __future__ import annotations

import json
import threading
from pathlib import Path

import pytest

from dualloop.models import Candidate, Delta, EvaluationResult, FeedbackSummary
from dualloop.models import FamilyOutcome
from dualloop.plugins.llm_generator import (
    LlmDocsQaGenerator, build_proposer_prompt, classify_failure,
    failure_digests, parse_proposal,
)
from dualloop.plugins.docs_qa_target import DEFAULT_PERSONA
from dualloop.runtime.budget import BudgetExhausted, SessionBudget

GOOD_OUTPUT = f"""Some preamble the model might add.

HYPOTHESIS:
The champion confabulates on false premises; adding an explicit
absence-conclusion procedure should cut confabulation and timeouts.

PERSONA:
{DEFAULT_PERSONA}

Search, then conclude: absence after three failed searches is an answer.
"""


def _champion(family="retrieval-discipline", persona=DEFAULT_PERSONA):
    return Candidate(id="dl-0001", experiment_id="exp", parent_id=None,
                     generation=0, family=family, mode="exploit",
                     hypothesis="champ", delta=Delta(
                         kind="cordis-overlay", target="system-prompt",
                         patch={"persona": persona}))


# ---- parsing ---------------------------------------------------------------

def test_parse_proposal_happy_path():
    p = parse_proposal(GOOD_OUTPUT)
    assert "absence-conclusion" in p.hypothesis
    assert "{{model}}" in p.persona and "{{cwd}}" in p.persona


def test_parse_proposal_strips_markdown_fence():
    out = GOOD_OUTPUT.replace(
        DEFAULT_PERSONA + "\n\nSearch, then conclude: absence after three failed searches is an answer.",
        f"```\n{DEFAULT_PERSONA}\n```")
    p = parse_proposal(out)
    assert not p.persona.startswith("```")


def test_parse_proposal_rejects_missing_markers_and_empty_parts():
    with pytest.raises(ValueError):
        parse_proposal("no markers here")
    with pytest.raises(ValueError):
        parse_proposal("HYPOTHESIS:\n\nPERSONA:\n" + DEFAULT_PERSONA)
    with pytest.raises(ValueError):
        parse_proposal("HYPOTHESIS:\nwhy\nPERSONA:\n")


# ---- failure digests ----------------------------------------------------------

def test_classify_failure_modes():
    assert classify_failure({"timed_out": True}) == "search-to-timeout"
    assert classify_failure({"fabricated": True}) == "confabulation"
    assert classify_failure({"missing_gold_files": ["a.md"],
                             "missing_answer_keys": []}) == "citation-miss"
    assert classify_failure({"missing_answer_keys": ["x"]}) == "wrong-answer"


def test_failure_digests_only_failed_core_questions():
    details = [
        {"id": "ab-01", "type": "abstention", "score": 0.0,
         "fabricated": True, "forbidden_found": ["dsh serve"],
         "trace_n_tool_calls": 29},
        {"id": "sf-01", "type": "single_fact", "score": 0.0},  # not core: excluded
        {"id": "sy-01", "type": "synthesis", "score": 1.0},    # passed: excluded
        {"id": "ab-12", "type": "abstention", "score": 0.0, "timed_out": True,
         "trace_n_tool_calls": 38},
    ]
    lines = failure_digests(details)
    assert len(lines) == 2
    assert "ab-01 (abstention): confabulation" in lines[0]
    assert "ab-12 (abstention): search-to-timeout" in lines[1]


# ---- operator structure ---------------------------------------------------------

def test_family_assignment_is_structural_per_mode():
    gen = LlmDocsQaGenerator(runner=None, families=["a", "b", "c", "d"])
    fb = FeedbackSummary()
    champ = _champion(family="a")
    assert gen._assign_family("exploit", champ, fb, 1, 0) == "a"
    explore_family = gen._assign_family("explore", champ, fb, 1, 0)
    assert explore_family != "a"
    innovate_family = gen._assign_family("innovate", champ, fb, 1, 0)
    assert "+" in innovate_family  # composition of two families


def test_explore_skips_penalized_families():
    gen = LlmDocsQaGenerator(runner=None, families=["a", "b", "c"])
    fb = FeedbackSummary(penalized_families=["b"])
    champ = _champion(family="a")
    for gen_no in range(3):
        assert gen._assign_family("explore", champ, fb, gen_no, 0) == "c"


def test_proposer_prompt_mentions_operator_and_rules():
    fb = FeedbackSummary()
    for mode, marker in (("exploit", "OPERATOR — EXPLOIT"),
                         ("explore", "OPERATOR — EXPLORE"),
                         ("innovate", "OPERATOR — INNOVATE")):
        prompt = build_proposer_prompt(mode, "b", "a", DEFAULT_PERSONA, fb,
                                       ["- ab-01: confabulation"], ["a", "b"])
        assert marker in prompt
        assert "{{model}}" in prompt and "{{cwd}}" in prompt
        assert "HYPOTHESIS:" in prompt and "PERSONA:" in prompt


# ---- generator end-to-end with a fake runner -------------------------------------

class FakeRunner:
    def __init__(self, output=GOOD_OUTPUT):
        self.output = output
        self.prompts: list[str] = []

    def run(self, prompt: str) -> str:
        self.prompts.append(prompt)
        return self.output


def test_propose_assigns_modes_and_parses_candidates():
    runner = FakeRunner()
    gen = LlmDocsQaGenerator(runner=runner, families=["a", "b", "c", "d"])
    quotas = {"exploit": 2, "explore": 1, "innovate": 1}
    seq = iter(range(1, 10))
    candidates = gen.propose(_champion(), FeedbackSummary(), quotas, 1,
                             lambda: f"dl-{next(seq):04d}")
    assert [c.mode for c in candidates] == ["exploit", "exploit", "explore",
                                            "innovate"]
    assert all(c.hypothesis_first and c.hypothesis for c in candidates)
    assert all("{{model}}" in c.delta.patch["persona"] for c in candidates)
    # exploit slots keep the champion family; explore leaves it; innovate composes
    assert candidates[0].family == "retrieval-discipline"
    assert candidates[2].family != "retrieval-discipline"
    assert "+" in candidates[3].family
    assert len(runner.prompts) == 4
    assert "OPERATOR — EXPLOIT" in runner.prompts[0]
    assert "OPERATOR — EXPLORE" in runner.prompts[2]
    assert "OPERATOR — INNOVATE" in runner.prompts[3]


def test_propose_skips_guardrail_violations_after_retries():
    runner = FakeRunner(output="HYPOTHESIS:\nbad\nPERSONA:\nno placeholders here")
    gen = LlmDocsQaGenerator(runner=runner, families=["a", "b"], max_retries=1)
    candidates = gen.propose(_champion(), FeedbackSummary(), {"exploit": 1}, 1,
                             lambda: "dl-0099")
    assert candidates == []
    assert len(runner.prompts) == 2  # one retry, then the slot is lost


def test_digests_come_from_champion_journal_artifact(tmp_path):
    details = {"details": [{"id": "ab-01", "type": "abstention", "score": 0.0,
                            "fabricated": True, "trace_n_tool_calls": 9}]}
    artifact = tmp_path / "d.json"
    artifact.write_text(json.dumps(details), encoding="utf-8")

    class FakeJournal:
        def latest(self):
            return {"dl-0001": type("E", (), {
                "fast": EvaluationResult(
                    candidate_id="dl-0001", evaluator_id="x", tier="fast",
                    ok=True, artifacts=[str(artifact)])})()}

    gen = LlmDocsQaGenerator(runner=FakeRunner(), families=["a", "b"],
                             journal=FakeJournal())
    digests = gen._digests_for(_champion())
    assert digests and "confabulation" in digests[0]


# ---- thread-safe budget -----------------------------------------------------------

def test_budget_acquire_is_thread_safe_under_contention(tmp_path):
    budget = SessionBudget(tmp_path / "b.json", cap=10)
    acquired = []
    lock = threading.Lock()

    def worker():
        try:
            budget.acquire()
            with lock:
                acquired.append(1)
        except BudgetExhausted:
            pass

    threads = [threading.Thread(target=worker) for _ in range(30)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(acquired) == 10                      # exactly the cap, no overshoot
    assert budget.sessions_used == 10
    with pytest.raises(BudgetExhausted):
        budget.acquire()


# ---- parallel evaluator with a fake executor ---------------------------------------

def test_parallel_evaluator_runs_all_questions_and_charges(tmp_path):
    from dualloop.plugins.docs_qa_evaluator import (
        DocsQaFastEvaluator, load_questions,
    )
    from dualloop.plugins.dsh_executor import SessionResult
    from pathlib import Path as _P

    bench = _P(__file__).resolve().parent.parent / "research" / "benchmarks" / "docs_qa"
    questions = load_questions(bench / "questions.dev.yml")

    class FakeExecutor:
        def __init__(self):
            self.in_flight = 0
            self.max_in_flight = 0
            self.lock = threading.Lock()
            self.calls = []

        def run_question(self, question, patch_path=None, label="q"):
            with self.lock:
                self.in_flight += 1
                self.max_in_flight = max(self.max_in_flight, self.in_flight)
                self.calls.append(label)
            import time as _t
            _t.sleep(0.01)
            with self.lock:
                self.in_flight -= 1
            return SessionResult(ok=True, answer="nothing useful", cited=[],
                                 latency_s=0.01, cost_usd=0.001,
                                 trace={"tool_calls": [], "n_steps": 1, "n_tool_calls": 1,
                                        "n_tool_errors": 0,
                                        "files_read": ["architecture.md"],
                                        "tokens": {"input": 10, "output": 5}})

        def preflight(self, patch_path=None):
            return []

    budget = SessionBudget(tmp_path / "b.json", cap=1000)
    fake = FakeExecutor()
    # budget is charged by the real executor, not the evaluator; emulate by
    # wrapping: the real DshDocsQaExecutor owns acquire/charge per session
    ev = DocsQaFastEvaluator(executor=fake, questions_path=bench / "questions.dev.yml",
                             corpus_root="/nonexistent", preflight=False,
                             pool_size=4,
                             details_dir=tmp_path / "details")
    cand = _champion()
    result = ev.evaluate(cand, {"patch_path": None})
    assert result.ok
    assert len(fake.calls) == len(questions) == 32
    assert fake.max_in_flight > 1            # actually parallel
    assert fake.max_in_flight <= 4           # bounded by the pool
    assert result.metrics["sample_size"] == 32.0
    assert "core_success" in result.metrics
    # deterministic question order in the written details
    written = json.loads((tmp_path / "details" /
                          f"{cand.id}_docs_qa_dev_v1.json").read_text())
    assert [d["id"] for d in written["details"]] == [q["id"] for q in questions]


# ---- seeded baseline + real wiring --------------------------------------------------

def _synthetic_details(path, tier="fast"):
    det = []
    for qtype, score in (("single_fact", 1.0), ("citation_strict", 1.0),
                         ("abstention", 1.0), ("abstention", 0.0),
                         ("synthesis", 1.0), ("synthesis", 0.0)):
        det.append({"id": f"{qtype}-{score}", "type": qtype, "score": score,
                    "latency_s": 1.0, "tokens_total": 10, "cost_usd": 0.001,
                    "pressure": False, "trace_n_tool_calls": 1,
                    "trace_n_tool_errors": 0, "n_files_read": 1, "n_cited": 1,
                    "n_cited_gold": 1, "timed_out": False, "fabricated": None,
                    "procedure_violations": [] if tier == "slow" else None})
    if tier == "slow":
        det[3]["procedure_violations"] = ["architecture.md"]  # one violation
    path.write_text(json.dumps({"evaluator_id": f"seed_{tier}", "tier": tier,
                                "details": det}), encoding="utf-8")
    return path


def test_seed_baseline_result_recomputes_metrics(tmp_path):
    from dualloop.real_wiring import seed_baseline_result
    fast = seed_baseline_result(_synthetic_details(tmp_path / "f.json"), "fast")
    assert fast.metrics["core_success"] == pytest.approx(0.5, abs=1e-3)
    assert fast.metrics["sandbox_leak_free"] is True
    assert fast.cost_usd == 0.0  # calibration spend, not this run's budget
    slow = seed_baseline_result(_synthetic_details(tmp_path / "s.json", "slow"),
                                "slow")
    assert "procedure_compliance" in slow.metrics
    assert slow.metrics["procedure_violations"] == 1.0


def test_controller_runs_with_seeded_baseline_and_zero_generations(tmp_path):
    """End-to-end seeding: a controller with a frozen baseline and no
    generations completes optimize mode without spawning anything."""
    from dualloop.controller import LoopController
    from dualloop.contract import PluginRegistry
    from dualloop.feedback import FeedbackEngine
    from dualloop.journal import JsonlJournal
    from dualloop.comparator import TopKPromotionGate, WeightedComparator
    from dualloop.plugins.mock import (
        MockExecutor, MockFastEvaluator, MockGenerator, MockMutator,
        MockObjectiveProvider, MockObserver, MockSlowEvaluator,
    )
    from dualloop.real_wiring import seed_baseline_result

    fast = seed_baseline_result(_synthetic_details(tmp_path / "f.json"), "fast")
    slow = seed_baseline_result(_synthetic_details(tmp_path / "s.json", "slow"),
                                "slow")
    config = Path(__file__).resolve().parent.parent / "research" / "experiments" / "docs_qa.yml"
    import yaml
    contract_source = yaml.safe_load(config.read_text())["contract"]
    provider = MockObjectiveProvider(contract_source)
    registry = PluginRegistry(
        evaluators={"docs_qa_dev_v1", "docs_qa_holdout_v1"},
        comparators={"weighted_v1"}, executors={"dsh_docs_qa"},
        baselines={"profile:dualloop"})
    controller = LoopController(
        provider=provider,
        generator=MockGenerator(seed=1, families=["a"]),
        mutator=MockMutator(), executor=MockExecutor(),
        fast_evaluator=MockFastEvaluator(seed=1, trap_family=""),
        slow_evaluator=MockSlowEvaluator(seed=1, trap_family=""),
        comparator=WeightedComparator({"weights": {"core_success": 1.0}}),
        slow_comparator=WeightedComparator({"weights": {"core_success": 1.0}}),
        gate=TopKPromotionGate(top_k=2),
        journal=JsonlJournal(tmp_path / "journal"),
        observer=MockObserver(), feedback_engine=FeedbackEngine(),
        registry=registry, quotas={"exploit": 1}, generations=0,
        baseline_results=(fast, slow))
    summary = controller.run()
    assert summary.mode == "optimize"
    assert summary.champion_id is not None
    assert summary.fast_evals == 0 and summary.slow_evals == 0  # nothing spent
    latest = controller.journal.latest()[summary.champion_id]
    assert latest.status == "champion"
    assert latest.fast.metrics["core_success"] == pytest.approx(0.5, abs=1e-3)
    assert latest.slow.metrics["procedure_compliance"] < 1.0


def test_build_controller_wiring_with_self_contained_seed(tmp_path):
    """Exercise real construction without reading historical experiment output."""
    import yaml
    from dualloop.controller import build_controller
    from dualloop.plugins.llm_generator import LlmDocsQaGenerator
    config = yaml.safe_load((Path(__file__).resolve().parent.parent / 'research/experiments/docs_qa.yml').read_text())
    config['session_budget_file'] = str(tmp_path / 'budget.json')
    config['session_reservations_usd'] = {'generation': 0.1, 'evaluation': 0.2}
    config['resume'] = False
    config['fast_question_ids'] = None
    config['frozen_baseline'] = {
        'fast_details': str(_synthetic_details(tmp_path / 'fast.json')),
        'slow_details': str(_synthetic_details(tmp_path / 'slow.json', 'slow')),
    }
    controller = build_controller(config, tmp_path / 'journal')
    assert isinstance(controller.generator, LlmDocsQaGenerator)
    fast, slow = controller._baseline_results
    assert fast.metrics['sample_size'] == 6
    assert fast.metrics['core_success'] == 0.5
    assert slow.metrics['core_success'] == 0.5
    assert slow.metrics['procedure_compliance'] < 1


def test_build_controller_dispatches_to_real_wiring(tmp_path):
    import yaml
    from pathlib import Path as _P
    from dualloop.controller import build_controller
    from dualloop.plugins.llm_generator import LlmDocsQaGenerator
    exp = _P(__file__).resolve().parent.parent / "research" / "experiments" / "docs_qa.yml"
    config = yaml.safe_load(exp.read_text(encoding="utf-8"))
    config["session_budget_file"] = str(tmp_path / "demo_budget.json")
    # Offline construction bounds, not authorization or an edit to the historical experiment.
    config["session_reservations_usd"] = {"generation": 0.1, "evaluation": 0.2}
    config["resume"] = False  # fresh-start wiring; resume is covered separately
    controller = build_controller(config, tmp_path / "journal")
    assert isinstance(controller.generator, LlmDocsQaGenerator)
    assert controller._baseline_results is not None
    fast, slow = controller._baseline_results
    # seeded from the frozen calibration measurements; fast is filtered to
    # the A1 stratified-16 subset (core = 6 ab + 4 sy), slow stays full
    assert fast.metrics["core_success"] == pytest.approx(0.60, abs=1e-3)
    assert fast.metrics["sample_size"] == 16.0
    assert fast.metrics["single_fact_success"] == 1.0
    assert fast.metrics["citation_strict_success"] == 1.0
    assert slow.metrics["core_success"] == pytest.approx(0.5625, abs=1e-3)
    assert slow.metrics["procedure_compliance"] == pytest.approx(0.7455,
                                                                abs=1e-3)
