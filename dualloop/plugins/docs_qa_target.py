"""Target: the `system-prompt` persona of the `dualloop` DSH profile.

The editable surface of the demo experiment is the agent persona, patched via
a cordis patch overlay on the dualloop profile — v1's proven causal lever
(`evolution/targets/system_prompt.py`, ported not imported).

Candidate = a cordis patch overlay (YAML array), applied with
`dsh --patch <file>`. DSH patch semantics replace a plugin's whole config, so
an overlay must carry the COMPLETE persona. Baseline = empty overlay (profile
unmodified).

Guardrails are fail-closed deterministic code: whitelist id `system-prompt`,
whitelist config key `persona`, forbidden entry keys name/disabled/inject,
required template placeholders {{model}} {{cwd}}.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any, Optional

import yaml

from ..models import Candidate

TARGET_ID = "system-prompt"


def persona_version(persona: str) -> str:
    return hashlib.sha256(persona.encode("utf-8")).hexdigest()

# Baseline persona snapshot (verified via
# `npx @deepseek-ai/dsh --profile dualloop --dump-config`, 2026-09-06).
DEFAULT_PERSONA = (
    "You are a coding agent powered by the {{model}} model. "
    "Your working directory is {{cwd}}."
)

GUARDRAILS: dict[str, Any] = {
    "allowed_ids": [TARGET_ID],
    "allowed_config_keys": ["persona"],
    "forbidden_entry_keys": ["name", "disabled", "inject"],
    "required_placeholders": ["{{model}}", "{{cwd}}"],
    "max_persona_chars": 4000,
}


def build_overlay(persona: str) -> list[dict]:
    return [{"id": TARGET_ID, "config": {"persona": persona}}]


def baseline_overlay() -> list[dict]:
    """Baseline = empty overlay (no --patch; the profile is used as-is)."""
    return []


def extract_persona(entries: list) -> str:
    for e in entries:
        if isinstance(e, dict) and e.get("id") == TARGET_ID:
            return (e.get("config") or {}).get("persona", "")
    return ""


def validate_entries(entries, guardrails: dict | None = None) -> list[str]:
    """Guardrail check: candidate patches may only touch whitelisted id/keys
    and must keep the template placeholders. Fail-closed (returns errors)."""
    g = guardrails or GUARDRAILS
    errors: list[str] = []
    if not isinstance(entries, list):
        return ["overlay top level must be a YAML array"]
    forbidden = set(g.get("forbidden_entry_keys", []))
    for i, e in enumerate(entries):
        if not isinstance(e, dict) or "id" not in e:
            errors.append(f"entry[{i}] missing id")
            continue
        bad = forbidden & set(e)
        if bad:
            errors.append(f"entry[{i}] has forbidden keys: {sorted(bad)}")
        if e["id"] not in g.get("allowed_ids", []):
            errors.append(f"entry[{i}] id not whitelisted: {e['id']}")
        for k in (e.get("config") or {}):
            if k not in g.get("allowed_config_keys", []):
                errors.append(f"entry[{i}] config key not whitelisted: {k}")
    persona = extract_persona(entries)
    if entries and not persona:
        errors.append("missing system-prompt persona")
    if persona:
        if len(persona) > g.get("max_persona_chars", 4000):
            errors.append(f"persona too long ({len(persona)} chars)")
        for ph in g.get("required_placeholders", []):
            if ph not in persona:
                errors.append(f"persona lost placeholder {ph}")
    return errors


def write_overlay(entries: list[dict], path: str | Path) -> Path:
    """Write an overlay as plain YAML (no `!!js` in persona overlays, so
    safe_dump round-trips losslessly)."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(yaml.safe_dump(entries, allow_unicode=True, sort_keys=False),
                 encoding="utf-8")
    return p


class SystemPromptMutator:
    """Mutator plugin (base.Mutator): turns a persona-patch candidate into a
    concrete overlay file the executor can pass via --patch.

    Enforces hypothesis-before-delta (audit A5) and the guardrails; the
    returned artifact carries the ABSOLUTE patch path (v1 lesson: --patch
    resolves relative to the launch cwd, which is the sandbox).
    """

    def __init__(self, patch_dir: str | Path, guardrails: dict | None = None,
                 baseline_persona: str | None = None):
        self.patch_dir = Path(patch_dir)
        self.guardrails = guardrails or GUARDRAILS
        self.baseline_persona = baseline_persona

    def apply(self, candidate: Candidate, parent: Optional[Candidate]) -> Any:
        if not candidate.hypothesis_first or not candidate.hypothesis.strip():
            raise ValueError(
                f"{candidate.id}: hypothesis must be stated before the delta")
        if candidate.generation > 0 and (parent is None or candidate.parent_id != parent.id):
            raise ValueError(f"{candidate.id}: parent does not match")
        if self.baseline_persona is not None and candidate.generation > 0:
            parent_persona = parent.delta.patch.get("persona", self.baseline_persona)
            if candidate.delta.parent_version != persona_version(parent_persona):
                raise ValueError(f"{candidate.id}: parent content version does not match")
        if set(candidate.delta.patch) - {"persona"}:
            raise ValueError(f"{candidate.id}: patch contains forbidden keys")
        if candidate.generation > 0 and (
                candidate.delta.kind != "cordis-overlay" or
                candidate.delta.target != TARGET_ID or
                not isinstance(candidate.delta.patch.get("persona"), str)):
            raise ValueError(f"{candidate.id}: invalid persona patch")
        persona = candidate.delta.patch.get("persona", self.baseline_persona)
        if persona is None:
            # baseline / identity delta: no patch file, profile unmodified
            return {"patch_path": None, "persona": None}
        entries = build_overlay(persona)
        errors = validate_entries(entries, self.guardrails)
        if errors:
            raise ValueError(f"{candidate.id}: guardrail violations: {errors}")
        path = write_overlay(entries, self.patch_dir / f"{candidate.id}.yml")
        return {"patch_path": str(path.resolve()), "persona": persona}
