"""Experiment journal: append-only JSONL + per-candidate detail files +
deprecated-ids blocklist (port of v1 `deprecated.txt` semantics).

- Append-only, complete history; nothing is ever deleted or rewritten.
- `deprecated.txt` lists contaminated/invalid candidate ids (one per line,
  `#` comments allowed). Entries stay on disk; they are excluded from every
  read view (contamination ledger, DESIGN.md "Metrics & Validation" #5).
- v1 lesson preserved: write-back scenarios must use `_read_raw()`, never
  the filtered view, or deprecated entries would be silently erased.
"""
from __future__ import annotations

import json
from pathlib import Path

from .models import JournalEntry


class JsonlJournal:
    def __init__(self, root: str | Path, *, create: bool = True):
        self.root = Path(root)
        self.entries_dir = self.root / "entries"
        if create:
            self.entries_dir.mkdir(parents=True, exist_ok=True)
        self.history_path = self.root / "history.jsonl"
        self.deprecated_path = self.root / "deprecated.txt"

    # ---- writes (append-only) ----

    def record(self, entry: JournalEntry) -> None:
        """Append one state transition. One JournalEntry per line; the
        per-candidate detail file holds the latest snapshot."""
        with self.history_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry.to_dict(), ensure_ascii=False) + "\n")
        detail = self.entries_dir / f"{entry.candidate_id}.json"
        detail.write_text(
            json.dumps(entry.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def deprecate(self, candidate_id: str, reason: str = "") -> None:
        """Add an id to the contamination blocklist (also append-only)."""
        with self.deprecated_path.open("a", encoding="utf-8") as f:
            line = candidate_id if not reason else f"{candidate_id}  # {reason}"
            f.write(line + "\n")

    # ---- reads ----

    def _read_raw(self) -> list[JournalEntry]:
        if not self.history_path.exists():
            return []
        return [
            JournalEntry.from_dict(json.loads(line))
            for line in self.history_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    def deprecated_ids(self) -> set[str]:
        if not self.deprecated_path.exists():
            return set()
        ids = set()
        for line in self.deprecated_path.read_text(encoding="utf-8").splitlines():
            line = line.split("#", 1)[0].strip()
            if line:
                ids.add(line)
        return ids

    def read(self) -> list[JournalEntry]:
        """Read view: every transition, minus blocklisted candidate ids."""
        bad = self.deprecated_ids()
        return [e for e in self._read_raw() if e.candidate_id not in bad]

    def latest(self) -> dict[str, JournalEntry]:
        """Current state per candidate (last transition wins)."""
        out: dict[str, JournalEntry] = {}
        for e in self.read():
            out[e.candidate_id] = e
        return out

    # ---- queries ----

    def by_experiment(self, experiment_id: str) -> list[JournalEntry]:
        return [e for e in self.read() if e.experiment_id == experiment_id]

    def by_generation(self, generation: int,
                      experiment_id: str | None = None) -> list[JournalEntry]:
        return [e for e in self.read()
                if e.generation == generation
                and (experiment_id is None or e.experiment_id == experiment_id)]

    def by_family(self, family: str,
                  experiment_id: str | None = None) -> list[JournalEntry]:
        return [e for e in self.read()
                if e.family == family
                and (experiment_id is None or e.experiment_id == experiment_id)]

    def for_candidate(self, candidate_id: str) -> list[JournalEntry]:
        """Full transition history of one candidate (respects blocklist)."""
        return [e for e in self.read() if e.candidate_id == candidate_id]
