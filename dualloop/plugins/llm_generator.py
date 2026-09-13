"""Real LLM Generator for the docs_qa demo (DESIGN.md Fast Loop, audits A4/A5).

Three STRUCTURALLY DISTINCT mutation operators behind controller-assigned
mode quotas (a generator never labels its own output — the LoopController
assigns modes; the operator used is a function of the mode):

- exploit:  targeted LOCAL modification of the champion persona, driven by
            per-question failure digests (which core questions failed and by
            which failure mode: confabulation / search-to-timeout /
            citation-miss)
- explore:  switch to a DIFFERENT named strategy family than the champion's,
            skipping families the FeedbackSummary has penalized
- innovate: composition — merge two non-penalized families, or import a
            strategy by analogy from another domain (legal discovery, code
            review)

Every candidate states its hypothesis BEFORE the persona delta (audit A5);
the Mutator enforces ordering and the guardrails enforce the whitelist
(system-prompt/persona only, {{model}}/{{cwd}} placeholders preserved).

Proposer isolation (v1 patterns, ported not imported):
- the proposer runs headless DSH on the `headless` profile — NEVER on the
  `dualloop` profile being evolved (v1 used a separate proposer profile)
- cwd is an isolated EMPTY sandbox (/tmp/dualloop-proposer-sandbox): the
  proposer receives question-level failure digests via its prompt but can
  never read the question files, gold answers, or evaluator source
- one proposer session per candidate; sessions are sequential and counted
  against the same SessionBudget ledger as evaluation sessions
"""
from __future__ import annotations

import json
import hashlib
import uuid
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional

from ..models import Candidate, Delta, FeedbackSummary, Mode
from .docs_qa_target import (
    DEFAULT_PERSONA, GUARDRAILS, build_overlay, validate_entries,
)

PROPOSER_SANDBOX = Path("/tmp/dualloop-proposer-sandbox")

# Failure-mode taxonomy from the calibration record (runs/CALIBRATION.md §3).
FAILURE_MODES = ("confabulation", "search-to-timeout", "citation-miss",
                 "wrong-answer")

BRIEF = """\
You are designing a SYSTEM-PROMPT PERSONA for a documentation-QA agent
(deepseek-v4-flash running in the DeepSeek Harness). The agent answers
questions about the DSH docs; its working directory contains the docs tree
and it must end each answer with a line `CITED: <path>, ...`.

Calibrated baseline behavior (dev core score 0.55 on abstention+synthesis):
the baseline persona already grounds itself (reads docs, cites files). Its
measured failure modes on the discriminating question types are:
1. CONFABULATION — invents non-existent features/config when the premise is
   false, instead of concluding absence.
2. SEARCH-TO-TIMEOUT — 25-40 grep/read calls hunting for something that does
   not exist; never concludes absence within the time budget.
3. CITATION-MISS — answers correctly but cites a file it never read, or
   omits a file it relied on (procedure compliance at baseline: 0.75).
Your persona edits must attack THESE failure modes. Note: heavy-handed
"never use tools" instructions DO NOT work — the model ignores anti-grounding
personas. Work WITH the grounding behavior: budget it, structure it, give it
an explicit absence-conclusion and citation-discipline procedure.
"""

RULES = """\
RULES for the persona you output:
- It MUST contain the exact placeholders {{model}} and {{cwd}} (the harness
  substitutes them; a persona without them is rejected by guardrails).
- Maximum 4000 characters. Write the COMPLETE new persona, not a diff.
- Output EXACTLY this format, nothing else:

HYPOTHESIS:
<2-4 sentences: which observed failure modes this addresses and why this
change should raise the core score, stated BEFORE the persona>

PERSONA:
<the complete persona text>
"""


@dataclass
class Proposal:
    hypothesis: str
    persona: str


def parse_proposal(output: str) -> Proposal:
    """Parse the proposer's HYPOTHESIS:/PERSONA: output. Fail-closed."""
    m = re.search(r"HYPOTHESIS\s*:\s*(.+?)\n\s*PERSONA\s*:\s*\n?(.*)",
                  output, re.IGNORECASE | re.DOTALL)
    if not m:
        raise ValueError("proposer output missing HYPOTHESIS:/PERSONA: markers")
    hypothesis = " ".join(m.group(1).split())
    persona = m.group(2).strip()
    # tolerate a markdown fence around the persona
    fence = re.match(r"^```[a-z]*\n(.*)\n```$", persona, re.DOTALL)
    if fence:
        persona = fence.group(1).strip()
    if not hypothesis:
        raise ValueError("empty hypothesis")
    if not persona:
        raise ValueError("empty persona")
    return Proposal(hypothesis=hypothesis, persona=persona)


def classify_failure(d: dict) -> str:
    """Map a scored core-question detail to a failure-mode label."""
    if d.get("timed_out"):
        return "search-to-timeout"
    if d.get("fabricated"):
        return "confabulation"
    if d.get("missing_gold_files") and not d.get("missing_answer_keys"):
        return "citation-miss"
    return "wrong-answer"


def failure_digests(details: list[dict], limit: int = 14) -> list[str]:
    """One line per failed core question: id, type, mode, key diagnostics."""
    lines = []
    for d in details:
        if d.get("score") or d["type"] not in ("abstention", "synthesis"):
            continue
        mode = classify_failure(d)
        extras = []
        if d.get("missing_answer_keys"):
            extras.append(f"missing_keys={d['missing_answer_keys'][:3]}")
        if d.get("missing_gold_files"):
            extras.append(f"missing_files={d['missing_gold_files']}")
        if d.get("forbidden_found"):
            extras.append(f"forbidden={d['forbidden_found']}")
        extras.append(f"tool_calls={d.get('trace_n_tool_calls', 0)}")
        lines.append(f"- {d['id']} ({d['type']}): {mode} — {'; '.join(extras)}")
        if len(lines) >= limit:
            break
    return lines


# constraint metric -> the question type whose per-question details explain it
_CONSTRAINT_TYPE = {
    "single_fact_success": "single_fact",
    "citation_strict_success": "citation_strict",
}


def constraint_rejection_digests(
        entries: list, constraints: list,
        details_loader: Callable[[str], dict],
        limit: int = 10) -> list[str]:
    """One line per candidate REJECTED by a hard constraint (search-side
    feedback, 2026-09-06: gen-1's shared sf-01 citation miss never reached the
    gen-2 proposer, and dl-0005 repeated it).

    Content policy: candidate id, generation/mode/family, the violated
    constraint (metric, value, threshold), and the failing question ids with
    their missing citation PATHS (a citation is an outcome, not an answer).
    Never question text, never gold answer keys.
    """
    from ..comparator import _check_constraint  # same check as the comparator

    lines: list[str] = []
    ordered = sorted(
        (e for e in entries
         if e.generation >= 1 and e.fast is not None and e.fast.ok),
        key=lambda e: (e.generation, e.candidate_id))
    for e in ordered:
        violations = [v for c in constraints
                      if (v := _check_constraint(e.fast.metrics, c))]
        if not violations:
            continue
        detail_hint = ""
        if e.fast.artifacts:
            metric = violations[0].split("=", 1)[0].split(":", 1)[0]
            qtype = _CONSTRAINT_TYPE.get(metric)
            if qtype:
                try:
                    payload = details_loader(e.fast.artifacts[0])
                    fails = [q for q in payload.get("details", [])
                             if q["type"] == qtype and not q.get("score")]
                    parts = []
                    for q in fails[:3]:
                        note = q["id"]
                        if q.get("missing_gold_files"):
                            note += (" missing citation "
                                     + ", ".join(q["missing_gold_files"]))
                        parts.append(note)
                    if parts:
                        detail_hint = " — " + "; ".join(parts)
                except Exception:
                    detail_hint = ""  # digests are a hint, never a blocker
        lines.append(
            f"- {e.candidate_id} (gen{e.generation} {e.mode}, {e.family}): "
            f"REJECTED {violations[0]}{detail_hint}")
        if len(lines) >= limit:
            break
    return lines


class ProposerRunner:
    """Spawns ONE headless proposer session on the `headless` profile in an
    isolated empty sandbox. Never the evolved profile; never any exam data
    in the sandbox."""

    def __init__(self, *, profile: str = "headless",
                 sandbox: str | Path = PROPOSER_SANDBOX,
                 timeout_s: int = 300, budget=None, npx_cmd: str = "npx",
                 reservation_usd: float | None = None):
        self.profile = profile
        self.sandbox = Path(sandbox)
        self._sandbox_root = self.sandbox
        self.timeout_s = timeout_s
        self.budget = budget
        self.reservation_usd = reservation_usd
        self.npx_cmd = npx_cmd

    def _prepare_sandbox(self) -> None:
        self.sandbox.mkdir(parents=True)

    def run(self, prompt: str, *, operation_id: str | None = None) -> str:
        self.sandbox = self._sandbox_root / uuid.uuid4().hex
        cmd = [self.npx_cmd, "@deepseek-ai/dsh", "--profile", self.profile,
               prompt]
        env = os.environ.copy()
        env["NODE_OPTIONS"] = "--max-old-space-size=4096"
        from ..runtime.session_trace import session_dirs
        before = session_dirs(self.sandbox)
        monetary_op = None
        if self.budget is not None:
            from ..runtime.budget import BudgetExhausted
            try:
                if self.budget.monetary:
                    monetary_op = operation_id or uuid.uuid4().hex
                    self.budget.reserve(monetary_op, self.reservation_usd, phase='generation',
                        metadata={'kind': 'dsh_proposer', 'sandbox': str(self.sandbox.resolve()),
                                  'sessions_before': sorted(str(p) for p in before),
                                  'profile': self.profile,
                                  'prompt_sha256': hashlib.sha256(prompt.encode()).hexdigest()})
                else:
                    self.budget.acquire()
            except (OSError, ValueError) as exc:
                raise BudgetExhausted(f'reservation was not acknowledged: {exc}') from exc
        try:
            self._prepare_sandbox()  # only after admission; every attempt retains its own directory
        except BaseException:
            if self.budget is not None:
                try:
                    if monetary_op is not None:
                        self.budget.settle(monetary_op, 0, receipt_id='not-started:' + monetary_op,
                            evidence={'kind': 'not_started', 'stage': 'sandbox_preparation'})
                    else:
                        self.budget.charge(0)
                except (OSError, ValueError) as exc:
                    raise BudgetExhausted(f'preparation receipt settlement incomplete: {exc}') from exc
            raise
        try:
            proc = subprocess.run(cmd, cwd=self.sandbox, env=env,
                                  capture_output=True, text=True,
                                  timeout=self.timeout_s)
        except subprocess.TimeoutExpired as exc:
            self._charge(before, monetary_op)
            raise RuntimeError(f"proposer session timed out "
                               f"({self.timeout_s}s)") from exc
        except BaseException:
            self._charge(before, monetary_op)
            raise
        self._charge(before, monetary_op)
        if proc.returncode != 0:
            raise RuntimeError(f"proposer exit {proc.returncode}: "
                               f"{proc.stderr[-300:]}")
        return proc.stdout

    def _charge(self, before: set[Path], operation_id: str | None = None) -> None:
        """Preserve unknown usage in the ledger and stop proposal retries."""
        from ..runtime.budget import BudgetExhausted, CostUnknown, trace_cost_usd
        cost = None
        d = None
        try:
            from ..runtime.session_trace import new_session_dir, parse_session
            d = new_session_dir(self.sandbox, before)
            if d is not None:
                cost = trace_cost_usd(parse_session(d))
        except Exception:
            cost = None
        if self.budget is not None:
            try:
                if operation_id is not None:
                    self.budget.settle(operation_id, cost,
                        receipt_id='dsh:' + str(d.resolve()) if d is not None else 'missing:' + operation_id,
                        evidence={'kind': 'dsh_trace_estimate', 'session_dir': str(d) if d else None})
                else:
                    self.budget.charge(cost)
            except (OSError, ValueError) as exc:
                raise BudgetExhausted(f'receipt settlement incomplete; inspect retained reservation: {exc}') from exc
        if cost is None:
            raise CostUnknown('unknown proposer session cost; reconcile its trace before more calls')


def _feedback_text(feedback: FeedbackSummary) -> str:
    lines = []
    if feedback.penalized_families:
        lines.append(f"Penalized families (failed slow >=2x, AVOID): "
                     f"{', '.join(feedback.penalized_families)}")
    for fam, outcome in feedback.family_outcomes.items():
        if outcome.n:
            lines.append(f"family {fam}: fast_avg={outcome.fast_avg:.2f} "
                         f"slow_avg={outcome.slow_avg:.2f} n={outcome.n} "
                         f"slow_failures={outcome.slow_failures}")
    for region in feedback.failed_proxy_regions:
        lines.append(f"proxy trap: {region}")
    return "\n".join(lines) or "(no slow-loop evidence yet — generation 1)"


def build_proposer_prompt(mode: Mode, family: str, champion_family: str,
                          champion_persona: str, feedback: FeedbackSummary,
                          digests: list[str], families: list[str],
                          constraint_digests: list[str] | None = None) -> str:
    """Operator-specific proposer prompt. The mode determines the OPERATOR,
    not just the wording (audit A4: structural diversity)."""
    digest_text = "\n".join(digests) or "(no failed core questions on record)"
    feedback_text = _feedback_text(feedback)
    family_menu = "\n".join(f"- {f}" for f in families)
    constraint_text = "\n".join(constraint_digests or []) or "(none on record)"
    if mode == "exploit":
        operator = (f"OPERATOR — EXPLOIT: make a TARGETED LOCAL modification of "
                    f"the champion persona below. Keep what works; change only "
                    f"what addresses the failure digests. Stay in the "
                    f"'{champion_family}' family.")
    elif mode == "explore":
        operator = (f"OPERATOR — EXPLORE: abandon the champion's strategy family "
                    f"('{champion_family}') entirely. Write the persona from the "
                    f"'{family}' family instead — a structurally different "
                    f"strategy, not a tweak of the champion. Family menu:\n"
                    f"{family_menu}")
    else:  # innovate
        operator = (f"OPERATOR — INNOVATE: composition. Merge the strongest "
                    f"elements of the two families named in '{family}', or "
                    f"import a strategy by analogy from another domain (e.g. "
                    f"legal discovery's burden of proof, code review's "
                    f"checklist discipline). The result must be more than the "
                    f"champion with additions.")
    return (f"{BRIEF}\n\nCHAMPION PERSONA (family '{champion_family}'):\n"
            f"---\n{champion_persona}\n---\n\n"
            f"FAILURE DIGESTS (champion's failed core questions):\n"
            f"{digest_text}\n\n"
            f"JOURNALED CONSTRAINT VIOLATIONS (hard guardrail rejections — "
            f"do NOT repeat them; if you reuse a family with a recorded "
            f"violation, your HYPOTHESIS must explicitly say how your persona "
            f"fixes it):\n{constraint_text}\n\n"
            f"SLOW-LOOP EVIDENCE:\n{feedback_text}\n\n{operator}\n\n{RULES}")


class LlmDocsQaGenerator:
    """Generator plugin (base.Generator): LLM-proposed persona candidates via
    three structural operators. Modes are ASSIGNED by the controller's quotas;
    this class only maps mode -> operator."""

    def __init__(self, *, runner, families: list[str], journal=None,
                 guardrails: dict | None = None,
                 base_persona: str = DEFAULT_PERSONA,
                 details_loader: Callable[[str], dict] | None = None,
                 constraints: list | None = None,
                 max_retries: int = 1):
        if not families:
            raise ValueError("LlmDocsQaGenerator needs a non-empty family pool")
        self.runner = runner
        self.families = list(families)
        self.journal = journal
        self.guardrails = guardrails or GUARDRAILS
        self.base_persona = base_persona
        self.details_loader = details_loader or self._default_details_loader
        self.constraints = list(constraints or [])
        self.max_retries = max_retries

    # ---- family assignment (structural per operator) ----

    def _assign_family(self, mode: Mode, champion: Optional[Candidate],
                       feedback: FeedbackSummary, generation: int,
                       slot: int) -> str:
        penalized = set(feedback.penalized_families)
        free = [f for f in self.families if f not in penalized] or self.families
        champion_family = (champion.family if champion and champion.family
                           and champion.family != "baseline" else None)
        if mode == "exploit":
            return champion_family or free[0]
        if mode == "explore":
            pool = [f for f in free if f != champion_family] or free
            return pool[(generation + slot) % len(pool)]
        # innovate: composition of two distinct non-penalized families
        a = free[(generation + slot) % len(free)]
        others = [f for f in free if f != a] or free
        b = others[(generation + slot + 1) % len(others)]
        return f"{a}+{b}" if a != b else a

    # ---- failure digests from the journal (champion's fast details) ----

    @staticmethod
    def _default_details_loader(path: str) -> dict:
        return json.loads(Path(path).read_text(encoding="utf-8"))

    def _digests_for(self, champion: Optional[Candidate]) -> list[str]:
        if champion is None or self.journal is None:
            return []
        try:
            entry = self.journal.latest().get(champion.id)
            if entry is None or entry.fast is None or not entry.fast.artifacts:
                return []
            details = self.details_loader(entry.fast.artifacts[0])
            return failure_digests(details.get("details", []))
        except Exception:
            return []  # digests are a hint, never a blocker

    def _constraint_digests(self) -> list[str]:
        if self.journal is None or not self.constraints:
            return []
        try:
            return constraint_rejection_digests(
                list(self.journal.latest().values()), self.constraints,
                self.details_loader)
        except Exception:
            return []  # digests are a hint, never a blocker

    # ---- protocol ----

    def propose(self, champion: Optional[Candidate],
                feedback: FeedbackSummary,
                quotas: dict[str, int],
                generation: int,
                next_id: Callable[[], str]) -> list[Candidate]:
        champion_persona = self.base_persona
        champion_family = "baseline"
        if champion is not None:
            champion_persona = (champion.delta.patch.get("persona")
                                or self.base_persona)
            if champion.family and champion.family != "baseline":
                champion_family = champion.family
        digests = self._digests_for(champion)
        constraint_digests = self._constraint_digests()

        candidates: list[Candidate] = []
        for mode, count in quotas.items():
            for slot in range(int(count)):
                family = self._assign_family(mode, champion, feedback,
                                             generation, slot)
                prompt = build_proposer_prompt(
                    mode, family, champion_family, champion_persona,
                    feedback, digests, self.families,
                    constraint_digests=constraint_digests)
                proposal = self._propose_one(prompt)
                if proposal is None:
                    continue  # slot lost, journal-worthy but not fatal
                candidates.append(Candidate(
                    id=next_id(), experiment_id="",
                    parent_id=champion.id if champion else None,
                    generation=generation, family=family, mode=mode,
                    hypothesis=proposal.hypothesis, hypothesis_first=True,
                    delta=Delta(kind="cordis-overlay", target="system-prompt",
                                patch={"persona": proposal.persona},
                                description=f"{mode} operator, family {family}"),
                ))
        return candidates

    def _propose_one(self, prompt: str) -> Optional[Proposal]:
        from ..runtime.budget import BudgetExhausted
        for attempt in range(self.max_retries + 1):
            try:
                output = self.runner.run(prompt)
                proposal = parse_proposal(output)
                errors = validate_entries(build_overlay(proposal.persona),
                                          self.guardrails)
                if errors:
                    raise ValueError(f"guardrail violations: {errors}")
                return proposal
            except BudgetExhausted:
                raise  # resource refusal is terminal, not an invalid proposal
            except Exception as exc:
                print(f"  [generator] proposer attempt {attempt + 1} failed: "
                      f"{exc}", flush=True)
                if attempt >= self.max_retries:
                    return None
        return None


__all__ = ["Proposal", "parse_proposal", "classify_failure",
           "failure_digests", "constraint_rejection_digests",
           "ProposerRunner", "build_proposer_prompt",
           "LlmDocsQaGenerator", "PROPOSER_SANDBOX"]
