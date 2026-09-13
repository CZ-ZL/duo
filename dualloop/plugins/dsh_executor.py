"""Sandboxed DSH executor: runs the candidate agent on ONE docs_qa question.

Port of v1's proven pattern (`evolution/evaluators/memory_recall_v2.py`,
ported not imported):
- spawn `npx @deepseek-ai/dsh --profile dualloop [--patch ABS]` headless
- NODE_OPTIONS="--max-old-space-size=4096"
- cwd = a FRESH sandbox dir containing ONLY the docs corpus (English *.md;
  *.zh.md / *.i18n.yaml stripped) so citation paths are relative to docs/
  and nothing the candidate can read is part of the exam's answer key
  (v1 leak incident: evaluator code and gold answers must be unreachable)
- per-session timeout with complete cost evidence = valid score-0 BEHAVIOR;
  non-zero exit / spawn failure = ok=False (infra)
- --patch is passed as an ABSOLUTE path (v1 lesson: it resolves relative to
  the launch cwd, which is the sandbox)
- the session trace (session.jsonl.zstd) is harvested into metrics
"""
from __future__ import annotations

import os
import hashlib
import uuid
import re
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from ..runtime.budget import BudgetExhausted, CostUnknown, SessionBudget, trace_cost_usd
from ..runtime.session_trace import new_session_dir, session_dirs, parse_session, trace_summary

# Marker strings that must never be readable inside a candidate sandbox
# (v1 评估泄漏事故 regression: anything the agent can read is part of the exam).
LEAK_MARKERS = ("gold_answer_keys", "gold_files", "forbidden_keys")

PROMPT_TEMPLATE = """\
QUESTION: {question}

The question is about the DeepSeek Harness (DSH) project. Your working
directory contains a copy of its documentation tree at ./docs/ (English
Markdown pages).

Output contract: give your final answer, then on its own line list the docs
files your answer relies on, paths relative to docs/, in exactly this form:
CITED: subsystems/jobs.md, architecture.md
If your answer relies on no file, write: CITED: none
"""

_CITED_RE = re.compile(r"^\s*CITED\s*:\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE)


@dataclass
class SessionResult:
    """Outcome of one headless question session.

    ok=False means INFRA failure (non-zero exit / spawn failure) — an invalid
    measurement. A timeout is ok=True with timed_out=True: valid score-0
    behavior (v1 semantics), provided cost evidence is complete. Unknown
    session cost raises CostUnknown before any SessionResult is returned."""
    ok: bool
    timed_out: bool = False
    answer: str = ""
    cited: list[str] = field(default_factory=list)
    stdout: str = ""
    latency_s: float = 0.0
    trace: dict = field(default_factory=dict)
    session_dir: Optional[str] = None
    cost_usd: float = 0.0
    error: Optional[str] = None


def parse_answer(stdout: str) -> tuple[str, list[str]]:
    """Split raw stdout into (answer text, cited paths).

    The answer text excludes the CITED line itself so cited paths cannot
    accidentally satisfy (or trip) answer-key checks."""
    cited: list[str] = []
    answer_lines: list[str] = []
    for line in stdout.splitlines():
        m = _CITED_RE.match(line)
        if m:
            payload = m.group(1).strip().rstrip(".")
            if payload.lower() not in ("none", ""):
                cited.extend(p.strip().strip("`\"") for p in payload.split(",")
                             if p.strip())
            continue
        answer_lines.append(line)
    return "\n".join(answer_lines).strip(), cited


def copy_corpus(corpus_dir: Path, dest: Path) -> None:
    """Copy the docs corpus into dest, English *.md only (*.zh.md, *.i18n.yaml,
    and non-Markdown assets like images are all stripped per SPEC)."""
    def _ignore(_dir, names):
        return [n for n in names
                if n.endswith(".zh.md") or n.endswith(".i18n.yaml")
                or ("." in n and not n.endswith(".md"))]
    shutil.copytree(corpus_dir, dest, ignore=_ignore)


def assert_sandbox_clean(sandbox: Path) -> list[str]:
    """Leak regression check: the sandbox must contain nothing but the docs
    corpus — no evaluator code, question files, or gold answers (v1 incident).
    Returns a list of violations; empty = clean."""
    violations: list[str] = []
    for p in sandbox.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(sandbox)
        if rel.parts and rel.parts[0] != "docs":
            violations.append(f"unexpected file in sandbox: {rel}")
            continue
        if p.suffix != ".md" or p.name.endswith(".zh.md"):
            violations.append(f"non-corpus file in sandbox: {rel}")
            continue
        try:
            head = p.read_text(encoding="utf-8", errors="ignore")[:200_000]
        except OSError:
            continue
        for marker in LEAK_MARKERS:
            if marker in head:
                violations.append(f"leak marker '{marker}' readable at {rel}")
    return violations


class DshDocsQaExecutor:
    """Runs one docs_qa question per headless DSH session in a fresh sandbox."""

    def __init__(self, *, corpus_dir: str | Path,
                 sandbox_root: str | Path = "/tmp/dualloop-sandbox",
                 profile: str = "dualloop", timeout_s: int = 180,
                 budget: Optional[SessionBudget] = None,
                 npx_cmd: str = "npx", reservation_usd: float | None = None):
        self.corpus_dir = Path(corpus_dir)
        self.sandbox_root = Path(sandbox_root)
        self.profile = profile
        self.timeout_s = timeout_s
        self.budget = budget
        self.reservation_usd = reservation_usd
        self.npx_cmd = npx_cmd
        self._seq = 0
        self._seq_lock = threading.Lock()

    # -- Executor protocol (base.Executor): the mutator's artifact carries
    # the patch path; actual sessions are spawned per-question by evaluators.
    def run(self, candidate, applied: Any) -> Any:
        return applied

    def _fresh_sandbox(self, label: str) -> Path:
        with self._seq_lock:
            self._seq += 1
            seq = self._seq
        safe = re.sub(r"[^A-Za-z0-9_.-]", "-", label)
        sandbox = self.sandbox_root / f"{safe}-{seq:03d}-{uuid.uuid4().hex}"
        sandbox.mkdir(parents=True)
        copy_corpus(self.corpus_dir, sandbox / "docs")
        return sandbox

    def preflight(self, patch_path: str | None = None) -> list[str]:
        """--dump-config tree assertion (v1 postmortem-0002 lesson: an
        evaluation passing != the patch took effect). No API call; fail-soft
        (returns warnings)."""
        problems: list[str] = []
        cmd = [self.npx_cmd, "@deepseek-ai/dsh", "--profile", self.profile]
        if patch_path:
            cmd += ["--patch", str(Path(patch_path).resolve())]
        cmd.append("--dump-config")
        env = os.environ.copy()
        env["NODE_OPTIONS"] = "--max-old-space-size=4096"
        try:
            proc = subprocess.run(cmd, cwd="/tmp", env=env, capture_output=True,
                                  text=True, timeout=180)
        except Exception as exc:
            return [f"preflight dump-config failed to run: {exc!r}"]
        if proc.returncode != 0:
            return [f"dump-config non-zero exit: {proc.stderr[-200:]}"]
        out = proc.stdout
        if "- id: system-prompt" not in out:
            problems.append("system-prompt id missing from composed tree")
        if "policy: never" not in out:
            problems.append("approval policy is not pinned to 'never'")
        if patch_path:
            import yaml
            entries = yaml.safe_load(Path(patch_path).read_text(encoding="utf-8")) or []
            persona = next((e.get("config", {}).get("persona", "")
                            for e in entries
                            if isinstance(e, dict) and e.get("id") == "system-prompt"), "")
            # YAML folding re-wraps the persona; compare with whitespace collapsed
            probe = " ".join(persona.split())[:60]
            flat = " ".join(out.split())
            if probe and probe not in flat:
                problems.append("candidate persona not visible in composed tree "
                                "(patch silently ineffective?)")
        return problems

    def run_question(self, question: str, patch_path: str | None = None,
                     label: str = "q", operation_id: str | None = None) -> SessionResult:
        sandbox = self._fresh_sandbox(label)
        leak = assert_sandbox_clean(sandbox)
        if leak:
            return SessionResult(ok=False, error=f"sandbox leak check failed: {leak}")

        cmd = [self.npx_cmd, "@deepseek-ai/dsh", "--profile", self.profile]
        if patch_path:
            cmd += ["--patch", str(Path(patch_path).resolve())]  # absolute (v1)
        cmd.append(PROMPT_TEMPLATE.format(question=question))
        env = os.environ.copy()
        env["NODE_OPTIONS"] = "--max-old-space-size=4096"

        before = session_dirs(sandbox)
        monetary_op = None
        if self.budget is not None:
            try:
                if self.budget.monetary:
                    monetary_op = operation_id or uuid.uuid4().hex
                    self.budget.reserve(monetary_op, self.reservation_usd, phase='evaluation',
                        metadata={'kind': 'dsh_evaluation', 'sandbox': str(sandbox.resolve()),
                                  'sessions_before': sorted(str(p) for p in before),
                                  'profile': self.profile, 'question_id': label,
                                  'request_sha256': hashlib.sha256('\0'.join(cmd).encode()).hexdigest()})
                else:
                    self.budget.acquire()
            except (OSError, ValueError) as exc:
                raise BudgetExhausted(f'reservation was not acknowledged: {exc}') from exc

        t0 = time.time()
        error = None
        try:
            proc = subprocess.run(cmd, cwd=sandbox, env=env, capture_output=True,
                                  text=True, timeout=self.timeout_s)
            latency = time.time() - t0
            timed_out = False
            if proc.returncode != 0:
                error = f"exit {proc.returncode}: {proc.stderr[-300:]}"
            stdout = proc.stdout
        except subprocess.TimeoutExpired:
            latency = time.time() - t0
            timed_out = True
            stdout = ""
        except BaseException:
            self._account_session_cost(sandbox, before, monetary_op)
            raise

        trace, cost = self._account_session_cost(sandbox, before, monetary_op)
        if error is not None:
            return SessionResult(ok=False, latency_s=round(latency, 1),
                                 trace=trace, cost_usd=cost, error=error,
                                 session_dir=trace.get('session_dir'))
        if timed_out:
            return SessionResult(ok=True, timed_out=True, latency_s=round(latency, 1),
                                 trace=trace, cost_usd=cost,
                                 session_dir=trace.get('session_dir'))
        answer, cited = parse_answer(stdout)
        return SessionResult(ok=True, answer=answer, cited=cited, stdout=stdout,
                             latency_s=round(latency, 1), trace=trace, cost_usd=cost,
                             session_dir=trace.get('session_dir'))

    def _account_session_cost(self, sandbox: Path, before: set[Path],
                              operation_id: str | None = None) -> tuple[dict, float]:
        try:
            trace = self._grab_trace(sandbox, before)
        except Exception:
            trace = {'error': 'trace collection failed'}
        if not isinstance(trace, dict):
            trace = {'error': 'invalid trace collection result'}
        cost = trace_cost_usd(trace)
        if self.budget is not None:
            try:
                if operation_id is not None:
                    directory = trace.get('session_dir')
                    self.budget.settle(operation_id, cost,
                        receipt_id='dsh:' + str(Path(directory).resolve()) if directory else 'operation:' + operation_id,
                        evidence={'kind': 'dsh_trace_estimate', 'session_dir': directory})
                else:
                    self.budget.charge(cost)
            except (OSError, ValueError) as exc:
                raise BudgetExhausted(f'receipt settlement incomplete; inspect retained reservation: {exc}') from exc
        if cost is None:
            raise CostUnknown('unknown evaluation session cost; reconcile its trace before more calls')
        return trace, cost

    def _grab_trace(self, sandbox: Path, before: set[Path], retries: int = 4) -> dict:
        for _ in range(retries):
            d = new_session_dir(sandbox, before)
            if d is not None:
                return {**parse_session(d), 'session_dir': str(d)}
            time.sleep(0.5)
        return {"error": "trace not found"}


__all__ = ["SessionResult", "DshDocsQaExecutor", "PROMPT_TEMPLATE",
           "parse_answer", "copy_corpus", "assert_sandbox_clean",
           "LEAK_MARKERS", "trace_summary"]
