#!/usr/bin/env python3
"""Offline historical cost audit and lossless answer-transport experiment.

No provider imports, network operations or runtime/profile changes.
"""
import argparse
from collections import defaultdict
from decimal import Decimal
import hashlib
import json
from pathlib import Path


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate_tasks(values, source_paths):
    require(isinstance(values, dict) and isinstance(source_paths, dict)
            and set(values) == set(source_paths), "Exact task IDs required")
    for task_id, paths in source_paths.items():
        require(isinstance(task_id, str) and isinstance(paths, list)
                and all(isinstance(p, str) for p in paths)
                and len(paths) == len(set(paths)), "Unambiguous source dictionary required")


def pack_answers(answers, source_paths):
    validate_tasks(answers, source_paths)
    packed = {}
    for task_id, answer in answers.items():
        require(isinstance(answer, dict) and set(answer) == {"answer", "citations"}
                and isinstance(answer["answer"], str) and isinstance(answer["citations"], list),
                "Exact public answer shape required")
        paths = source_paths[task_id]
        require(all(isinstance(p, str) and p in paths for p in answer["citations"]),
                "Unknown citation; no silent repair")
        packed[task_id] = [answer["answer"], [paths.index(p) for p in answer["citations"]]]
    return packed


def unpack_answers(wire, source_paths):
    validate_tasks(wire, source_paths)
    answers = {}
    for task_id, value in wire.items():
        require(isinstance(value, list) and len(value) == 2
                and isinstance(value[0], str) and isinstance(value[1], list), "Invalid wire shape")
        paths = source_paths[task_id]
        require(all(type(i) is int and 0 <= i < len(paths) for i in value[1]),
                "Invalid citation index; no silent repair")
        answers[task_id] = {"answer": value[0], "citations": [paths[i] for i in value[1]]}
    return answers


def canonical_bytes(value):
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode())


def audit(comparison_root):
    root = comparison_root.resolve()
    hashes = {}

    def read(path):
        path = path.resolve()
        require(path.is_relative_to(root), "Historical receipt escapes comparison root")
        raw = path.read_bytes()
        hashes[str(path)] = hashlib.sha256(raw).hexdigest()
        return json.loads(raw)

    summary = read(root / "comparison-result.json")
    require(summary["evidenceKind"] == "model" and summary["status"] == "COMPLETED",
            "Only completed historical model evidence supported")
    calls, roundtrips, arms = [], [], []
    totals = defaultdict(lambda: {"requests": 0, "costNanoCny": 0,
                                  "inputTokens": 0, "cacheReadTokens": 0, "outputTokens": 0})
    receipt_paths = set()
    for arm in summary["arms"]:
        directory = root / arm["directory"]
        require(arm["status"] == "completed" and arm["costCny"] is not None,
                "Unknown arm cost")
        rows = read(directory / "cost-receipts.json")
        arm_cost, requests = 0, 0
        for row in rows:
            require(row["currency"] == "CNY" and type(row["cost"]) is int and row["cost"] >= 0,
                    "Unknown or invalid CNY charge")
            arm_cost += row["cost"]
            evidence = row["evidence"].get("costEvidence")
            if evidence is None:
                require(row["cost"] == 0 and row["evidence"]["provider"].startswith("native-docs-qa-"),
                        "Missing cost evidence is not free")
                continue
            require(evidence["complete"] is True and evidence["currency"] == "CNY"
                    and evidence["kind"] == "model" and type(evidence["attempts"]) is int
                    and evidence["attempts"] > 0, "Incomplete provider accounting")
            receipt_path = Path(evidence["receiptPath"]).resolve()
            require(receipt_path not in receipt_paths, "Duplicate paid session")
            receipt_paths.add(receipt_path)
            session = read(receipt_path)
            require(session["costEvidence"] == evidence and session["currency"] == "CNY",
                    "Session/ledger evidence mismatch")
            require(Decimal(str(session["costCny"])) * 10**9 == row["cost"],
                    "Session/ledger cost mismatch")
            usage, pricing = evidence["usage"], evidence["pricing"]
            keys = ["inputTokens", "cacheReadTokens", "outputTokens"]
            require(all(type(usage[k]) is int and usage[k] >= 0 for k in keys)
                    and sum(usage[k] for k in keys) == usage["totalTokens"], "Invalid token usage")
            components = {k: int(Decimal(str(pricing[rate])) * usage[k] * 1000)
                          for k, rate in zip(keys, ["inputCnyPerMillion", "cacheReadCnyPerMillion",
                                                    "outputCnyPerMillion"])}
            residual = row["cost"] - sum(components.values())
            # Native priceUsage uses Math.ceil on binary floating point. Preserve its ledger,
            # expose the at-most-one-nano over-rounding rather than rewriting old receipts.
            require(residual in (0, 1), "Usage/frozen-tariff cost mismatch")
            operation = session["operation"]
            require(operation in ("generate", "execute"), "Unclassified paid operation")
            requests += evidence["attempts"]
            kind = "generation" if operation == "generate" else (
                "baseline_execution" if session["candidateId"] == "baseline" else "candidate_execution")
            call = {"arm": arm["arm"], "repeat": arm["repeat"], "kind": kind,
                    "tier": session.get("tier"), "candidateId": session.get("candidateId"),
                    "requests": evidence["attempts"], "costNanoCny": row["cost"],
                    "usage": usage, "componentsNanoCny": components, "roundingNanoCny": residual,
                    "receiptPath": str(receipt_path), "model": evidence["model"]}
            calls.append(call)
            total = totals[kind]
            total["requests"] += call["requests"]
            total["costNanoCny"] += call["costNanoCny"]
            for key in keys:
                total[key] += usage[key]
            if operation == "execute":
                require(session["status"] == "completed", "Incomplete historical execution")
                event = next(e for e in session["sessionEvents"] if e["type"] == "agent/inbox/spliced")
                prompt = json.loads(event["data"]["inserted"][0]["content"][0]["text"])
                sources = {t["id"]: t["sourcePaths"] for t in prompt["tasks"]}
                answer = json.loads(session["text"])
                packed = pack_answers(answer, sources)
                require(unpack_answers(packed, sources) == answer, "Lossy historical roundtrip")
                roundtrips.append({"receiptPath": str(receipt_path), "tier": session["tier"],
                    "tasks": len(answer), "rawBytes": len(session["text"].encode()),
                    "canonicalPublicBytes": canonical_bytes(answer), "compactBytes": canonical_bytes(packed),
                    "exactRoundtrip": True})
        require(Decimal(str(arm["costCny"])) * 10**9 == arm_cost and requests == arm["paidCalls"],
                "Arm total mismatch")
        arms.append({"arm": arm["arm"], "repeat": arm["repeat"], "requests": requests,
                     "costNanoCny": arm_cost, "costCny": float(Decimal(arm_cost) / 10**9),
                     "selectedId": arm["selectedId"], "legacyFinalScore": arm["finalScore"],
                     "wallTimeMs": arm["wallTimeMs"]})
    total_cost = sum(c["costNanoCny"] for c in calls)
    require(Decimal(str(summary["totalCostCny"])) * 10**9 == total_cost
            and sum(c["requests"] for c in calls) == summary["paidCalls"], "Batch total mismatch")
    public_bytes = sum(r["canonicalPublicBytes"] for r in roundtrips)
    compact_bytes = sum(r["compactBytes"] for r in roundtrips)
    arm_statistics = {}
    for name in sorted({a["arm"] for a in arms}):
        selected = [a for a in arms if a["arm"] == name]
        arm_statistics[name] = {"repeats": len(selected),
            "meanCostCny": float(sum(Decimal(a["costNanoCny"]) for a in selected) / len(selected) / 10**9),
            "meanRequests": sum(a["requests"] for a in selected) / len(selected)}
    execution_calls = [c for c in calls if c["kind"] != "generation"]
    execution_cost = sum(c["costNanoCny"] for c in execution_calls)
    output_cost = sum(c["componentsNanoCny"]["outputTokens"] for c in execution_calls)
    for path, digest in hashes.items():
        require(hashlib.sha256(Path(path).read_bytes()).hexdigest() == digest, "Inputs changed during audit")
    return {"status": "OFFLINE_AUDIT_PASS", "currency": "CNY", "newPaidRequests": 0,
        "newCostCny": 0, "historicalPaidRequests": summary["paidCalls"],
        "historicalCostCny": float(Decimal(total_cost) / 10**9), "arms": arms,
        "armStatistics": arm_statistics, "byOperation": dict(totals), "calls": calls,
        "compactTransport": {"status": "OFFLINE_ROUNDTRIP_ONLY_NOT_RUNTIME_INTEGRATED",
            "executionBatches": len(roundtrips), "taskAnswers": sum(r["tasks"] for r in roundtrips),
            "canonicalPublicBytes": public_bytes, "compactBytes": compact_bytes,
            "responseByteReductionFraction": 1 - compact_bytes / public_bytes,
            "executionOutputCostFraction": output_cost / execution_cost,
            "roundtrips": roundtrips, "realModelGenerationTested": False,
            "realCostReductionProven": False, "qualityNoninferiorityProven": False},
        "limitations": [
            "Historical lexical final=1 is not qualified semantic quality evidence.",
            "All arms retained baseline; cheaper baseline selection is not a DUO optimization benefit.",
            "Baseline arm includes Fast/Slow/final diagnostics; these are not production per-answer costs.",
            "Frozen historical tariffs and observed usage, not current price research or an account invoice.",
            "Compact encoding preserves observed answers, including their errors; it does not improve them.",
            "Byte reduction is not token or fee reduction; model generation, new prompt overhead and reasoning may differ.",
            "All legacy splits were used for engineering replay; none is a new independent heldout test.",
            "This experiment has no runtime provider, changed model prompt, new evaluation rule or deployment.",
            "Count generator, Caller, validation, retries, execution and evaluation before claiming full-cost savings."
        ], "sourceHashes": hashes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--comparison", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    require(not args.output.resolve().is_relative_to(args.comparison.resolve()),
            "Output must be outside immutable historical inputs")
    require(not args.output.exists(), "Use a new output path; do not overwrite evidence")
    result = audit(args.comparison)
    with args.output.open("x") as file:
        json.dump(result, file, ensure_ascii=False, indent=2)
        file.write("\n")
    print(json.dumps({k: result[k] for k in ("status", "newPaidRequests", "historicalPaidRequests",
                                           "historicalCostCny", "armStatistics")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
