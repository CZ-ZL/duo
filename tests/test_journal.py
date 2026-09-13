"""Journal: append-only JSONL, per-candidate detail files, deprecated.txt
blocklist excluded from all read views (port of v1 semantics), queries."""
import json

from dualloop.journal import JsonlJournal
from dualloop.models import Delta, JournalEntry


def entry(cid, gen=1, family="fam-a", exp="exp-1", status="proposed"):
    return JournalEntry(experiment_id=exp, candidate_id=cid, parent_id=None,
                        generation=gen, family=family, mode="explore",
                        hypothesis="h", delta_ref="d", status=status)


class TestAppendOnly:
    def test_record_writes_jsonl_and_detail_file(self, tmp_path):
        j = JsonlJournal(tmp_path)
        j.record(entry("dl-0001"))
        j.record(entry("dl-0001", status="fast_evaluated"))
        lines = (tmp_path / "history.jsonl").read_text().splitlines()
        assert len(lines) == 2                       # both transitions kept
        detail = json.loads((tmp_path / "entries" / "dl-0001.json").read_text())
        assert detail["status"] == "fast_evaluated"  # latest snapshot

    def test_latest_per_candidate(self, tmp_path):
        j = JsonlJournal(tmp_path)
        j.record(entry("dl-0001"))
        j.record(entry("dl-0001", status="champion"))
        j.record(entry("dl-0002"))
        latest = j.latest()
        assert latest["dl-0001"].status == "champion"
        assert latest["dl-0002"].status == "proposed"


class TestBlocklist:
    def test_deprecated_ids_excluded_from_all_read_views(self, tmp_path):
        j = JsonlJournal(tmp_path)
        j.record(entry("dl-0001"))
        j.record(entry("dl-0002"))
        j.deprecate("dl-0001", reason="contamination: candidate read evaluator source")
        assert [e.candidate_id for e in j.read()] == ["dl-0002"]
        assert list(j.latest()) == ["dl-0002"]
        assert j.by_experiment("exp-1")[0].candidate_id == "dl-0002"
        assert j.for_candidate("dl-0001") == []
        # but nothing was deleted: the raw log still holds both (append-only)
        assert len(j._read_raw()) == 2

    def test_deprecated_file_supports_comments_and_inline_reasons(self, tmp_path):
        (tmp_path / "deprecated.txt").write_text(
            "# contamination ledger\ndl-0007  # leaked\n\n", encoding="utf-8")
        assert JsonlJournal(tmp_path).deprecated_ids() == {"dl-0007"}


class TestQueries:
    def test_by_experiment_generation_family(self, tmp_path):
        j = JsonlJournal(tmp_path)
        j.record(entry("dl-0001", gen=1, family="a", exp="e1"))
        j.record(entry("dl-0002", gen=1, family="b", exp="e1"))
        j.record(entry("dl-0003", gen=2, family="a", exp="e2"))
        assert len(j.by_experiment("e1")) == 2
        assert [e.candidate_id for e in j.by_generation(2)] == ["dl-0003"]
        assert {e.candidate_id for e in j.by_family("a")} == {"dl-0001", "dl-0003"}
        assert [e.candidate_id for e in j.by_family("a", experiment_id="e2")] == ["dl-0003"]
