"""DSH session-log parser: turns the natively persisted session.jsonl.zstd
into a structured trace (tool calls, files read, tokens, latency).

Ported (not imported) from v1 `evolution/runtime/session_trace.py` — the v1
module stays untouched as the archived prototype. Format reference:
docs/subsystems/session.md (mirror pin 0a53fb5):
- first line SessionHeader, then one SessionEvent {type, seq, time(ms), data} per line
- tool/call:   data {turn, step, callId, name, arguments (unparsed JSON string)}
- tool/result: data {turn, step, message: ToolResultMessage, error?} (isError in message)
- assistant/message: data.usage {inputTokens, outputTokens, cacheReadTokens, ...}

Addition over v1: `files_read` extraction — every tool-call argument string
that names a Markdown path, normalized to be corpus-relative when it points
inside the sandbox `docs/` tree. This is the raw material for the slow
evaluator's procedure check (cited-but-never-read = violation).
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

DSH_SESSIONS = Path.home() / ".dsh" / "sessions"

_MD_PATH = re.compile(r"[^\s\"']+\.md\b", re.IGNORECASE)


def _project_dir_for_cwd(cwd: str | Path) -> Path:
    """DSH's directory-name rule (reverse-engineered in v1, multi-candidate +
    suffix fallback): '/' -> '-', alnum/'.'/'-' verbatim, else ~XXXX (upper
    hex), wrapped in '-'. Observed: /tmp/evo-agent-sandbox -> --tmp-evo-agent-sandbox--"""
    enc = "".join(
        ch if (ch.isalnum() or ch in ".-") else ("-" if ch == "/" else "~%04X" % ord(ch))
        for ch in str(cwd))
    for variant in ("-" + enc + "--", "-" + enc + "-", "--" + enc + "--"):
        p = DSH_SESSIONS / variant
        if p.exists():
            return p
    if DSH_SESSIONS.exists():
        tail = enc.strip("-")
        for d in DSH_SESSIONS.iterdir():
            if d.is_dir() and tail in d.name:
                return d
    return DSH_SESSIONS / ("-" + enc + "--")


def latest_session_dir(cwd: str | Path, since_ts: float | None = None) -> Path | None:
    """Newest session dir under the cwd's project dir; since_ts filters out
    sessions older than that moment (mtime)."""
    proj = _project_dir_for_cwd(cwd)
    if not proj.exists():
        return None
    cands = [d for d in proj.iterdir()
             if d.is_dir() and (d / "session.jsonl.zstd").exists()]
    if since_ts is not None:
        cands = [d for d in cands
                 if (d / "session.jsonl.zstd").stat().st_mtime >= since_ts]
    return max(cands, key=lambda d: d.stat().st_mtime) if cands else None


def session_dirs(cwd: str | Path) -> set[Path]:
    """Snapshot session identities, including directories awaiting their log."""
    project = _project_dir_for_cwd(cwd)
    return {p for p in project.iterdir() if p.is_dir()} if project.exists() else set()


def new_session_dir(cwd: str | Path, before: set[Path]) -> Path | None:
    """A receipt must belong to exactly one new session, never a recent old one.

    This binds a sequential invocation to a new local directory. It does not
    reconcile concurrent invocations sharing a cwd or a resumed session.
    """
    added = session_dirs(cwd) - before
    if len(added) != 1:
        return None
    directory = added.pop()
    return directory if (directory / 'session.jsonl.zstd').is_file() else None


def normalize_read_path(raw: str, docs_anchor: str = "/docs/") -> str:
    """Normalize a path found in tool-call arguments for the procedure check.

    Absolute sandbox paths become corpus-relative (everything after `docs/`);
    a leading `docs/` or `./` is stripped; separators normalized. Strings that
    do not look like Markdown paths return "".
    """
    m = _MD_PATH.search(raw)
    if not m:
        return ""
    p = m.group(0).replace("\\", "/")
    if docs_anchor in p:
        p = p.split(docs_anchor, 1)[1]
    for prefix in ("docs/", "./"):
        if p.startswith(prefix):
            p = p[len(prefix):]
    return p


def _extract_md_paths(arguments: str, docs_anchor: str) -> list[str]:
    """Pull Markdown paths out of a tool-call arguments blob (JSON or raw)."""
    found: list[str] = []
    try:
        parsed = json.loads(arguments)
        blobs = []

        def _walk(x):
            if isinstance(x, str):
                blobs.append(x)
            elif isinstance(x, dict):
                for v in x.values():
                    _walk(v)
            elif isinstance(x, list):
                for v in x:
                    _walk(v)

        _walk(parsed)
    except (json.JSONDecodeError, TypeError):
        blobs = [arguments]
    for blob in blobs:
        norm = normalize_read_path(blob, docs_anchor)
        if norm:
            found.append(norm)
    return found


def _count(value) -> bool:
    return type(value) is int and 0 <= value <= 2**53 - 1


def _usage_tokens(usage) -> dict | None:
    """Require explained buckets, following cached DSH's TokenUsage semantics.

    Input is uncached input; cache traffic is separate. Missing optional cache
    buckets imply zero only when an exact total leaves no unexplained tokens.
    Reasoning is a subset of output, not an additional billable bucket.
    """
    fields = {'input': 'inputTokens', 'output': 'outputTokens',
              'cache_read': 'cacheReadTokens', 'cache_write': 'cacheWriteTokens',
              'reasoning': 'reasoningTokens'}
    if (not isinstance(usage, dict) or not {'inputTokens', 'outputTokens'} <= usage.keys()
            or any(not _count(usage.get(key, 0)) for key in fields.values())):
        return None
    tokens = {key: usage.get(field, 0) for key, field in fields.items()}
    total = sum(tokens[key] for key in ('input', 'output', 'cache_read', 'cache_write'))
    if not _count(total) or tokens['reasoning'] > tokens['output']:
        return None
    if 'totalTokens' in usage:
        if not _count(usage['totalTokens']) or usage['totalTokens'] != total:
            return None
    elif not {'cacheReadTokens', 'cacheWriteTokens'} <= usage.keys():
        return None
    return tokens


def parse_session(session_dir: str | Path, max_arg_chars: int = 80,
                  docs_anchor: str = "/docs/") -> dict:
    """Parse one session dir into a structured trace. Fail-soft: any step
    failing returns a dict with an `error` field."""
    f = Path(session_dir) / "session.jsonl.zstd"
    if not f.exists():
        return {"error": f"no log file: {f}"}
    proc = subprocess.run(["zstd", "-dc", str(f)], capture_output=True, text=True)
    if proc.returncode != 0:
        return {"error": f"zstd decode failed: {proc.stderr[-200:]}"}

    tool_calls: list[dict] = []
    result_errors: dict = {}   # by step, coarse pairing of isError
    tokens = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0, "reasoning": 0}
    files_read: set[str] = set()
    n_steps = 0
    usage_messages = 0
    usage_valid = True
    active_turn = active_step = None
    seen_turns, seen_steps = set(), set()
    step_has_usage = False
    t_first = t_last = None

    for line in proc.stdout.splitlines():
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            usage_valid = False
            continue
        if not isinstance(e, dict):
            usage_valid = False
            continue
        etype = e.get("type")
        d = e.get("data", {})
        if not isinstance(d, dict):
            usage_valid = False
            continue
        turn, step = d.get('turn'), d.get('step')
        # Cached DSH also issues model requests outside assistant/message.
        # These require separate receipts; main-loop usage cannot price them.
        if (etype in ('session/title-llm-request', 'web/deepseek-search-llm-request')
                or isinstance(etype, str) and etype.startswith('compaction/')):
            usage_valid = False
        t = e.get("time")
        if isinstance(t, (int, float)):
            t_first = t if t_first is None else min(t_first, t)
            t_last = t if t_last is None else max(t_last, t)
        if etype == 'turn/start':
            if not _count(turn) or turn in seen_turns or active_turn is not None:
                usage_valid = False
            else:
                seen_turns.add(turn)
                active_turn = turn
        elif etype == 'turn/end':
            if not _count(turn) or turn != active_turn or active_step is not None:
                usage_valid = False
            active_turn = None
        elif etype == "step/start":
            n_steps += 1
            if (not _count(turn) or not _count(step) or turn != active_turn
                    or active_step is not None or (turn, step) in seen_steps):
                usage_valid = False
            else:
                seen_steps.add((turn, step))
                active_step = (turn, step)
                step_has_usage = False
        elif etype == 'step/end':
            if (not _count(turn) or not _count(step)
                    or active_step != (turn, step) or not step_has_usage):
                usage_valid = False
            active_step = None
        elif etype in ('llm/retry', 'llm/retry-started'):
            # Retries may have billed earlier attempts without a final message.
            # Until attempt-level reconciliation is implemented, fail closed.
            usage_valid = False
        elif etype == 'assistant/chunk':
            chunk = d.get('chunk')
            if (not _count(turn) or not _count(step) or active_step != (turn, step)
                    or step_has_usage or not isinstance(chunk, dict)):
                usage_valid = False
            elif chunk.get('type') == 'usage' and _usage_tokens(chunk.get('usage')) is None:
                usage_valid = False
            elif chunk.get('type') == 'finish':
                reason = chunk.get('reason')
                if not isinstance(reason, dict) or reason.get('kind') in ('error', 'aborted'):
                    usage_valid = False
        elif etype == "tool/call":
            # Default DSH child-session tools can incur usage in another log,
            # including send_message waking a pre-existing child session.
            if d.get('name') in ('subagent', 'subagent_fork', 'send_message'):
                usage_valid = False
            args = str(d.get("arguments"))
            tool_calls.append({
                "name": d.get("name"),
                "args": args[:max_arg_chars],
                "step": d.get("step"),
            })
            for p in _extract_md_paths(args, docs_anchor):
                files_read.add(p)
        elif etype == "tool/result":
            msg = d.get("message") or {}
            is_err = bool(d.get("error")) or bool(msg.get("isError"))
            result_errors[d.get("step")] = is_err
        elif etype == "assistant/message":
            usage_messages += 1
            if (not _count(turn) or not _count(step) or active_step != (turn, step)
                    or step_has_usage or d.get('interrupted')):
                usage_valid = False
            step_has_usage = True
            observed = _usage_tokens(d.get('usage'))
            if observed is None:
                usage_valid = False
                continue
            for key, value in observed.items():
                tokens[key] += value

    for tc in tool_calls:
        tc["is_error"] = result_errors.get(tc["step"], False)
    n_errors = sum(1 for tc in tool_calls if tc["is_error"])
    return {
        "tool_calls": tool_calls,
        "n_tool_calls": len(tool_calls),
        "n_tool_errors": n_errors,
        "tool_error_rate": round(n_errors / len(tool_calls), 4) if tool_calls else 0.0,
        "n_steps": n_steps,
        "files_read": sorted(files_read),
        "tokens": tokens,
        # Zero totals are only observed zero when every model step has valid
        # usage. Retain partial totals for diagnostics without pricing them.
        "usage_complete": (usage_valid and usage_messages > 0 and usage_messages == n_steps
                           and active_turn is None and active_step is None),
        "wall_ms": int(t_last - t_first) if t_first and t_last else None,
    }


def trace_summary(trace: dict, max_calls: int = 12) -> str:
    """One-line human summary for journals/reports."""
    if "error" in trace:
        return f"(trace: {trace['error']})"
    seq = " → ".join(f"{t['name']}{'!' if t.get('is_error') else ''}"
                     for t in trace["tool_calls"][:max_calls])
    if trace["n_tool_calls"] > max_calls:
        seq += f" → …(+{trace['n_tool_calls'] - max_calls})"
    return (f"steps={trace['n_steps']} tools={trace['n_tool_calls']} "
            f"err={trace['n_tool_errors']} tok={trace['tokens']['input']}"
            f"+{trace['tokens']['output']} files={len(trace['files_read'])} | {seq}")
