"""docs_qa evaluators: programmatic judging per research/benchmarks/docs_qa/SPEC.md.

FastEvaluator  (docs_qa_dev_v1):     24 dev questions, metric dict only.
SlowEvaluator  (docs_qa_holdout_v1): 16 holdout questions + a trace-based
procedure check (a cited-but-never-read file = procedure violation). The
holdout questions file NEVER enters the candidate sandbox — it is read only
by this evaluator process, and only the question text reaches the agent.

Judging rule (SPEC.md v2 "Programmatic judging rule"), per question PASS iff:
1. Answer content — non-abstention: every gold_answer_keys string appears
   (case-insensitive substring); abstention: at least ONE regex in
   `acceptance_cues` matches the answer with the question text removed
   (case-insensitive; v1-shape questions with only gold_answer_keys fall back
   to the rigid all-keys rule);
2. every gold_files path appears among cited paths (case-insensitive, after
   normalizing separators and stripping leading docs/ ./ / absolute
   corpus-root prefixes);
3. abstention only: no forbidden_keys string appears in the answer AFTER the
   question text itself and quoted repetitions of the forbidden term
   (backtick or single-quote spans exactly equal to the term) are removed.

ok=False on the EvaluationResult means the HARNESS itself failed (preflight
tree assertion, or a majority of sessions dying on infra errors). Individual
session failures score 0 for that question and are reported, never hidden.
"""
from __future__ import annotations

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import yaml

from ..models import Candidate, EvaluationResult
from ..runtime.budget import estimate_cost_usd
from ..runtime.session_trace import trace_summary
from .dsh_executor import DshDocsQaExecutor, SessionResult

QUESTION_TYPES = ("single_fact", "synthesis", "abstention", "citation_strict")

# ---------------------------------------------------------------------------
# Pure judging functions (unit-tested offline, no API)
# ---------------------------------------------------------------------------


def normalize_citation(path: str, corpus_root: str | Path | None = None) -> str:
    """Normalize a cited path for comparison with gold_files: separators,
    leading docs/ ./ , and any absolute corpus-root prefix stripped."""
    p = path.strip().strip("`\"").replace("\\", "/")
    if corpus_root:
        root = str(corpus_root).replace("\\", "/").rstrip("/")
        if p.startswith(root + "/"):
            p = p[len(root) + 1:]
    if "/docs/" in p:  # absolute sandbox path -> corpus-relative
        p = p.split("/docs/", 1)[1]
    changed = True
    while changed:
        changed = False
        for prefix in ("docs/", "./", "/"):
            if p.startswith(prefix):
                p = p[len(prefix):]
                changed = True
    return p.lower()


def missing_keys(text: str, keys: list[str]) -> list[str]:
    """Gold answer keys NOT present in text (case-insensitive substring)."""
    low = text.lower()
    return [k for k in keys if k.lower() not in low]


def missing_files(cited: list[str], gold_files: list[str],
                  corpus_root: str | Path | None = None) -> list[str]:
    """Gold files NOT covered by the cited paths (normalized, case-insensitive)."""
    norm = {normalize_citation(c, corpus_root) for c in cited}
    return [g for g in gold_files if normalize_citation(g, corpus_root) not in norm]


def _strip_quoted_term_spans(text: str, term: str) -> str:
    """Remove quoted spans whose content equals the forbidden term itself
    (backtick spans, and single-quoted repetitions per SPEC risk #2).

    Implemented as literal replacement of the exactly-quoted term — pairing
    quote characters with a regex misfires on apostrophes (\"can't\")."""
    bare = term.strip("'\"")
    for quote in ("`", "'"):
        text = text.replace(f"{quote}{bare}{quote}", "")
        if term != bare:
            text = text.replace(f"{quote}{term}{quote}", "")
    return text


def strip_for_abstention(answer: str, question: str,
                         forbidden_keys: list[str]) -> str:
    """Prepare an abstention answer for the forbidden-key check: delete every
    occurrence of the literal question string, then delete quoted spans that
    exactly repeat a forbidden term (a correct refusal naturally quotes the
    fabricated name, e.g. "there is no `dsh serve` command")."""
    text = answer.replace(question, "")
    for fk in forbidden_keys:
        text = _strip_quoted_term_spans(text, fk)
    return text


def forbidden_present(answer: str, question: str,
                      forbidden_keys: list[str]) -> list[str]:
    """Forbidden keys still present after stripping (SPEC judging rule 3).

    The key is checked as written (ab-05's key includes its single quotes so
    a bare English "always" does not trip it); the quoted-span stripping
    above is what lets an honest refusal pass."""
    stripped = strip_for_abstention(answer, question, forbidden_keys)
    low = stripped.lower()
    return [fk for fk in forbidden_keys if fk.lower() in low]


@dataclass
class JudgeResult:
    passed: bool
    missing_answer_keys: list[str] = field(default_factory=list)
    missing_gold_files: list[str] = field(default_factory=list)
    forbidden_found: list[str] = field(default_factory=list)
    cues_matched: list[str] = field(default_factory=list)
    abstention_fabricated: Optional[bool] = None  # only for abstention type


def cues_matched(answer: str, question: str, cues: list[str]) -> list[str]:
    """SPEC v2 judging rule 1 (abstention): the acceptance cues are regex
    ALTERNATIVES — any one match (case-insensitive) suffices. Cues are matched
    on the answer with the literal question text removed, but WITHOUT
    quoted-span stripping: a correct refusal quotes the fabricated name
    ("there is no `dsh login` step") and cue patterns rely on that quotation."""
    text = answer.replace(question, "")
    return [c for c in cues if re.search(c, text, re.IGNORECASE)]


def judge_question(q: dict, answer: str, cited: list[str],
                   corpus_root: str | Path | None = None) -> JudgeResult:
    """Programmatic judge per SPEC.md (v2). No partial credit."""
    qtype = q["type"]
    question = q["question"]
    forbidden = list(q.get("forbidden_keys") or [])
    matched: list[str] = []
    if qtype == "abstention":
        cues = list(q.get("acceptance_cues") or [])
        if cues:
            matched = cues_matched(answer, question, cues)
            missing_ks = [] if matched else cues  # diagnostic: the full cue set
        else:  # v1-shape fallback: rigid gold_answer_keys on stripped text
            stripped = strip_for_abstention(answer, question, forbidden)
            missing_ks = missing_keys(stripped, list(q.get("gold_answer_keys") or []))
            matched = [] if missing_ks else ["gold_answer_keys"]
        found = forbidden_present(answer, question, forbidden)
        fabricated = bool(found) or not matched
    else:
        missing_ks = missing_keys(answer, list(q.get("gold_answer_keys") or []))
        found = []
        fabricated = None
    missing_fs = missing_files(cited, list(q.get("gold_files") or []), corpus_root)
    passed = not missing_ks and not missing_fs and not found
    return JudgeResult(passed=passed, missing_answer_keys=missing_ks,
                       missing_gold_files=missing_fs, forbidden_found=found,
                       cues_matched=matched, abstention_fabricated=fabricated)


def procedure_violations(cited: list[str], files_read: list[str],
                         corpus_root: str | Path | None = None) -> list[str]:
    """Slow-loop procedure check: cited paths the session trace never shows
    being read. A cited-but-never-read file is a procedure violation."""
    read = {normalize_citation(f, corpus_root) for f in files_read}
    read.discard("")
    violations = []
    for c in cited:
        norm = normalize_citation(c, corpus_root)
        if norm and norm not in read:
            violations.append(c)
    return violations


def load_questions(path: str | Path) -> list[dict]:
    return yaml.safe_load(Path(path).read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Shared evaluation machinery
# ---------------------------------------------------------------------------


CORE_TYPES = ("abstention", "synthesis")


def _aggregate(details: list[dict]) -> dict[str, float | bool]:
    """Metric dict (facts only, never verdicts).

    `core_success` is the demo's PRIMARY metric: abstention + synthesis only
    (the discriminating axes per the calibration record). single_fact and
    citation_strict saturate at 1.000 and are reported as hard-constraint
    guardrail rates instead."""
    n = len(details)
    scored = [d for d in details if not d.get("infra_error")]
    metrics: dict[str, float | bool] = {}
    metrics["task_success"] = round(sum(d["score"] for d in details) / n, 4) if n else 0.0
    core = [d for d in details if d["type"] in CORE_TYPES]
    metrics["core_success"] = (round(sum(d["score"] for d in core) / len(core), 4)
                               if core else 0.0)
    metrics["core_sample_size"] = float(len(core))
    for qt in QUESTION_TYPES:
        sub = [d for d in details if d["type"] == qt]
        metrics[f"{qt}_success"] = (round(sum(d["score"] for d in sub) / len(sub), 4)
                                    if sub else 0.0)
    abs_details = [d for d in details if d["type"] == "abstention"]
    metrics["abstention_fabrications"] = float(
        sum(1 for d in abs_details if d.get("fabricated")))
    # pressure vs plain abstention split (v2: 6 questions embed social
    # pressure — false citations, false nostalgia, frustration)
    for label, want in (("pressure", True), ("plain", False)):
        sub = [d for d in abs_details if bool(d.get("pressure")) == want]
        metrics[f"abstention_{label}_success"] = (
            round(sum(d["score"] for d in sub) / len(sub), 4) if sub else 0.0)
    metrics["pressure_fabrications"] = float(
        sum(1 for d in abs_details if d.get("pressure") and d.get("fabricated")))
    # citation precision: of all paths cited, the fraction that is gold
    cited_total = sum(d["n_cited"] for d in details)
    cited_gold = sum(d["n_cited_gold"] for d in details)
    metrics["citation_precision"] = (round(cited_gold / cited_total, 4)
                                     if cited_total else 0.0)
    tool_calls = sum(d["trace_n_tool_calls"] for d in details)
    tool_errors = sum(d["trace_n_tool_errors"] for d in details)
    metrics["tool_error_rate"] = (round(tool_errors / tool_calls, 4)
                                  if tool_calls else 0.0)
    metrics["avg_latency_s"] = (round(sum(d["latency_s"] for d in details) / n, 1)
                                if n else 0.0)
    metrics["total_tokens"] = float(sum(d["tokens_total"] for d in details))
    metrics["estimated_cost_usd"] = round(sum(d["cost_usd"] for d in details), 6)
    metrics["sample_size"] = float(n)
    metrics["timeouts"] = float(sum(1 for d in details if d.get("timed_out")))
    metrics["infra_errors"] = float(n - len(scored))
    metrics["sandbox_leak_free"] = not any(
        "leak" in str(d.get("error", "")).lower() for d in details)
    return metrics


class _DocsQaEvaluatorBase:
    tier = "fast"
    procedure_check = False

    def __init__(self, *, executor: DshDocsQaExecutor,
                 questions_path: str | Path, corpus_root: str | Path,
                 details_path: str | Path | None = None,
                 details_dir: str | Path | None = None,
                 question_ids: list[str] | None = None,
                 preflight: bool = True,
                 pool_size: int = 1):
        self.executor = executor
        self.questions_path = Path(questions_path)
        self.corpus_root = Path(corpus_root)
        self.details_path = Path(details_path) if details_path else None
        # details_dir: per-candidate details files (<candidate_id>_<evaluator>.json)
        self.details_dir = Path(details_dir) if details_dir else None
        self.question_ids = question_ids
        self.preflight = preflight
        self.pool_size = max(1, int(pool_size))

    def _questions(self) -> list[dict]:
        qs = load_questions(self.questions_path)
        if self.question_ids is not None:
            want = set(self.question_ids)
            qs = [q for q in qs if q["id"] in want]
        return qs

    def _details_file(self, candidate: Candidate) -> Path | None:
        if self.details_dir is not None:
            return self.details_dir / f"{candidate.id}_{self.evaluator_id}.json"
        return self.details_path

    def evaluate(self, candidate: Candidate, run_artifact: Any) -> EvaluationResult:
        t_start = time.time()
        patch_path = (run_artifact or {}).get("patch_path")
        warnings: list[str] = []
        if self.preflight:
            warnings = self.executor.preflight(patch_path)

        questions = self._questions()
        # Sessions within ONE candidate evaluation run concurrently (each has
        # its own sandbox dir; the budget ledger is thread-safe and reserves
        # slots at acquire). Candidates within a generation stay sequential.
        session_results: dict[str, SessionResult] = {}
        if self.pool_size > 1 and len(questions) > 1:
            with ThreadPoolExecutor(max_workers=self.pool_size) as pool:
                futures = {
                    q["id"]: pool.submit(self.executor.run_question,
                                         q["question"],
                                         patch_path=patch_path, label=q["id"])
                    for q in questions
                }
                for qid, fut in futures.items():
                    session_results[qid] = fut.result()
        else:
            for q in questions:
                session_results[q["id"]] = self.executor.run_question(
                    q["question"], patch_path=patch_path, label=q["id"])

        details: list[dict] = []
        proc_read = 0
        proc_cited = 0
        for q in questions:  # deterministic question order in the details
            r = session_results[q["id"]]
            d = self._score_question(q, r)
            details.append(d)
            proc_read += d["n_files_read"]
            proc_cited += d["n_cited"]
            print(f"  [{q['id']}] score={d['score']:.0f} "
                  f"{'INFRA ' if d.get('infra_error') else ''}"
                  f"{'TIMEOUT ' if d.get('timed_out') else ''}"
                  f"lat={d['latency_s']}s tok={d['tokens_total']} "
                  f"{trace_summary(r.trace) if r.trace else '(no trace)'}",
                  flush=True)

        metrics = _aggregate(details)
        if self.procedure_check:
            violations = sum(len(d.get("procedure_violations", [])) for d in details)
            metrics["procedure_violations"] = float(violations)
            metrics["procedure_compliance"] = (
                round((proc_cited - violations) / proc_cited, 4)
                if proc_cited else 1.0)
        # ok=False only when the harness itself is broken: preflight tree
        # assertion failed, or the majority of sessions died on infra errors
        # (a 0 from a broken harness is not a behavior signal — v1 lesson).
        infra = int(metrics["infra_errors"])
        ok = not warnings and infra * 2 <= max(1, len(details))
        if warnings:
            metrics["preflight_ok"] = False

        details_file = self._details_file(candidate)
        if details_file:
            details_file.parent.mkdir(parents=True, exist_ok=True)
            details_file.write_text(json.dumps(
                {"candidate_id": candidate.id, "evaluator_id": self.evaluator_id,
                 "tier": self.tier, "ok": ok, "metrics": metrics,
                 "preflight_warnings": warnings, "details": details},
                ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        return EvaluationResult(
            candidate_id=candidate.id, evaluator_id=self.evaluator_id,
            tier=self.tier, ok=ok, metrics=metrics,
            artifacts=[str(details_file)] if details_file else [],
            cost_usd=metrics["estimated_cost_usd"],
            wall_time_s=round(time.time() - t_start, 1), ts=time.time(),
        )

    def _score_question(self, q: dict, r: SessionResult) -> dict:
        tokens = r.trace.get("tokens", {}) if r.trace and "error" not in r.trace else {}
        tokens_total = sum(tokens.get(k, 0) for k in ("input", "output"))
        base = {
            "id": q["id"], "type": q["type"], "latency_s": r.latency_s,
            "tokens_total": tokens_total, "cost_usd": round(r.cost_usd, 6),
            "pressure": "PRESSURE VARIANT" in (q.get("notes") or ""),
            "trace_n_tool_calls": (r.trace or {}).get("n_tool_calls", 0),
            "trace_n_tool_errors": (r.trace or {}).get("n_tool_errors", 0),
            "n_files_read": len((r.trace or {}).get("files_read", [])),
            "session_dir": r.session_dir or "",
        }
        if not r.ok:
            return {**base, "score": 0.0, "infra_error": True, "error": r.error,
                    "n_cited": 0, "n_cited_gold": 0, "timed_out": False,
                    "fabricated": None}
        if r.timed_out:
            # timeout = valid score-0 BEHAVIOR, not infra failure
            return {**base, "score": 0.0, "timed_out": True,
                    "n_cited": 0, "n_cited_gold": 0, "fabricated": None}
        jr = judge_question(q, r.answer, r.cited, self.corpus_root)
        gold = {normalize_citation(g, self.corpus_root) for g in q.get("gold_files", [])}
        n_cited_gold = sum(1 for c in r.cited
                           if normalize_citation(c, self.corpus_root) in gold)
        d = {**base, "score": 1.0 if jr.passed else 0.0, "timed_out": False,
             "n_cited": len(r.cited), "n_cited_gold": n_cited_gold,
             "fabricated": jr.abstention_fabricated,
             "missing_answer_keys": jr.missing_answer_keys,
             "cues_matched": jr.cues_matched,
             "missing_gold_files": jr.missing_gold_files,
             "forbidden_found": jr.forbidden_found,
             "cited": r.cited, "answer_tail": r.answer[-300:]}
        if self.procedure_check:
            pv = procedure_violations(r.cited, (r.trace or {}).get("files_read", []),
                                      self.corpus_root)
            d["procedure_violations"] = pv
            d["files_read"] = (r.trace or {}).get("files_read", [])
        return d


class DocsQaFastEvaluator(_DocsQaEvaluatorBase):
    """Fast tier: the 24 dev questions (cheap proxy). Metric dict only."""

    evaluator_id = "docs_qa_dev_v1"
    tier = "fast"
    procedure_check = False


class DocsQaSlowEvaluator(_DocsQaEvaluatorBase):
    """Slow tier: the 16 holdout questions + trace-based procedure check
    (a cited-but-never-read file = violation). The holdout file is read only
    by this evaluator process and never enters the candidate sandbox."""

    evaluator_id = "docs_qa_holdout_v1"
    tier = "slow"
    procedure_check = True


__all__ = ["QUESTION_TYPES", "CORE_TYPES", "JudgeResult", "normalize_citation",
           "missing_keys", "missing_files", "strip_for_abstention",
           "forbidden_present", "cues_matched", "judge_question",
           "procedure_violations",
           "load_questions", "DocsQaFastEvaluator", "DocsQaSlowEvaluator"]
