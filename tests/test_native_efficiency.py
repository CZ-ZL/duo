"""Offline checks for compact transport, never evaluator/optimization evidence."""
import importlib.util
import json
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location(
    "audit_native_efficiency", Path(__file__).parents[1] / "scripts/audit_native_efficiency.py")
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


def test_exact_roundtrip_preserves_unicode_answers_and_citation_order():
    sources = {"q": ["a.md", "子目录/b.md"], "empty": []}
    answers = {"q": {"answer": '未提及 ≠ 不存在。\n"quote"',
                      "citations": ["子目录/b.md", "a.md", "子目录/b.md"]},
               "empty": {"answer": "", "citations": []}}
    wire = AUDIT.pack_answers(answers, sources)
    assert wire == {"q": [answers["q"]["answer"], [1, 0, 1]], "empty": ["", []]}
    assert AUDIT.unpack_answers(wire, sources) == answers
    assert answers["q"]["citations"] == ["子目录/b.md", "a.md", "子目录/b.md"]


@pytest.mark.parametrize("indices", [[-1], [1], [True], [0.0], ["0"]])
def test_invalid_reference_is_not_silently_repaired(indices):
    with pytest.raises(ValueError):
        AUDIT.unpack_answers({"q": ["answer", indices]}, {"q": ["a.md"]})


def test_unknown_citation_is_not_dropped_or_replaced():
    with pytest.raises(ValueError):
        AUDIT.pack_answers({"q": {"answer": "text", "citations": ["invented.md"]}},
                           {"q": ["a.md"]})


@pytest.mark.parametrize("answers", [
    {}, {"extra": {"answer": "x", "citations": []}},
    {"q": {"answer": "x", "citations": [], "reason": "don't discard me"}},
    {"q": {"answer": 42, "citations": []}},
])
def test_missing_extra_or_invalid_content_is_rejected(answers):
    with pytest.raises(ValueError):
        AUDIT.pack_answers(answers, {"q": ["a.md"]})


def test_source_dictionary_must_be_unambiguous():
    with pytest.raises(ValueError):
        AUDIT.unpack_answers({"q": ["a", [0]]}, {"q": ["a.md", "a.md"]})


@pytest.fixture
def historical_receipts(tmp_path):
    """Synthetic accounting fixture, not model or optimization evidence."""
    arm = tmp_path / "arm"
    arm.mkdir()
    session_path = arm / "session.json"
    evidence = {"complete": True, "currency": "CNY", "kind": "model", "attempts": 1,
        "receiptPath": str(session_path), "model": "fixture-model",
        "usage": {"inputTokens": 10, "cacheReadTokens": 0, "outputTokens": 5, "totalTokens": 15},
        "pricing": {"inputCnyPerMillion": 1, "cacheReadCnyPerMillion": 0.1, "outputCnyPerMillion": 2}}
    prompt = {"tasks": [{"id": "q", "sourcePaths": ["a.md"]}]}
    session = {"costEvidence": evidence, "currency": "CNY", "costCny": 0.00002,
        "operation": "execute", "candidateId": "baseline", "tier": "fast", "status": "completed",
        "text": json.dumps({"q": {"answer": "a", "citations": ["a.md"]}}),
        "sessionEvents": [{"type": "agent/inbox/spliced", "data": {"inserted": [
            {"content": [{"text": json.dumps(prompt)}]}]}}]}
    session_path.write_text(json.dumps(session))
    row = {"currency": "CNY", "cost": 20000,
           "evidence": {"costEvidence": evidence, "provider": "dsh-agent-executor"}}
    (arm / "cost-receipts.json").write_text(json.dumps([row]))
    summary = {"evidenceKind": "model", "status": "COMPLETED", "totalCostCny": 0.00002,
        "paidCalls": 1, "arms": [{"directory": "arm", "status": "completed", "costCny": 0.00002,
            "paidCalls": 1, "arm": "baseline", "repeat": 1, "selectedId": "baseline",
            "finalScore": 1, "wallTimeMs": 1}]}
    (tmp_path / "comparison-result.json").write_text(json.dumps(summary))
    return tmp_path


def test_cost_audit_reconciles_usage_and_does_not_claim_live_savings(historical_receipts):
    result = AUDIT.audit(historical_receipts)
    assert result["historicalCostCny"] == 0.00002
    assert result["newPaidRequests"] == 0
    assert result["compactTransport"]["realCostReductionProven"] is False


@pytest.mark.parametrize("failure", ["unknown_cost", "missing_evidence", "bad_total", "bad_usage"])
def test_accounting_failure_cannot_be_reported_as_a_saving(historical_receipts, failure):
    path = historical_receipts / "arm/cost-receipts.json"
    rows = json.loads(path.read_text())
    if failure == "unknown_cost":
        rows[0]["cost"] = None
    elif failure == "missing_evidence":
        rows[0]["evidence"]["costEvidence"] = None
    elif failure == "bad_total":
        summary_path = historical_receipts / "comparison-result.json"
        summary = json.loads(summary_path.read_text())
        summary["totalCostCny"] = 0
        summary_path.write_text(json.dumps(summary))
    else:
        rows[0]["evidence"]["costEvidence"]["usage"]["outputTokens"] = 0
    path.write_text(json.dumps(rows))
    with pytest.raises(ValueError):
        AUDIT.audit(historical_receipts)
