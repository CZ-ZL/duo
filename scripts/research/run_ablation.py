#!/usr/bin/env python3
"""Post-hoc ablation: slow-evaluate the candidates the dual loop REJECTED.

The counterfactual: a single-loop method (select by fast/dev score only —
common practice) would have shipped dl-0002 (fast core 0.900). The demo never
slow-evaluated dl-0002 or dl-0003 (hard-guardrail drops). This script runs
both through the frozen DocsQaSlowEvaluator (full 24-question holdout, same
neutral prompt, their original candidate patches) — pre-registered machinery,
no contract/benchmark/judge change.

Journaling: entries are appended to the demo journal with
experiment_id `docs_qa-ablation`, fresh candidate ids (`dl-000X-ablation`),
and family `ablation/<original>` — so the demo lineage, the comparator
history, and any future resume's family statistics stay clean.

Usage: python3 scripts/research/run_ablation.py [--ids dl-0002,dl-0003]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import yaml  # noqa: E402

from dualloop.journal import JsonlJournal  # noqa: E402
from dualloop.models import Candidate, Delta, JournalEntry  # noqa: E402
from dualloop.plugins.docs_qa_evaluator import DocsQaSlowEvaluator  # noqa: E402
from dualloop.plugins.dsh_executor import DshDocsQaExecutor  # noqa: E402
from dualloop.runtime.budget import SessionBudget  # noqa: E402

BENCH = ROOT / "benchmarks" / "docs_qa"
CORPUS = Path("/home/agent/.openclaw/workspace/Research OS/"
              "deepseek_harness/upstream/docs")
JOURNAL_DIR = ROOT / "experiments" / "journal"
ABLATION_EXPERIMENT = "docs_qa-ablation"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ids", default="dl-0002,dl-0003")
    ap.add_argument("--budget-file", default=str(ROOT / "runs" / "session_budget_demo.json"))
    ap.add_argument("--cap", type=int, default=262,  # 202 used + 60 task cap
                    help="ledger hard cap (sessions)")
    args = ap.parse_args()

    journal = JsonlJournal(JOURNAL_DIR)
    latest = journal.latest()
    budget = SessionBudget(args.budget_file, cap=args.cap)
    print(f"budget at start: {budget.status_line()}")

    executor = DshDocsQaExecutor(corpus_dir=CORPUS, budget=budget, timeout_s=180)

    for cid in args.ids.split(","):
        cid = cid.strip()
        patch = JOURNAL_DIR / "patches" / f"{cid}.yml"
        if not patch.exists():
            print(f"!! no patch file for {cid}: {patch}")
            continue
        origin = latest.get(cid)
        if origin is None:
            print(f"!! {cid} not in the journal")
            continue
        persona = (yaml.safe_load(patch.read_text(encoding="utf-8"))[0]
                   ["config"]["persona"])
        candidate = Candidate(
            id=f"{cid}-ablation", experiment_id=ABLATION_EXPERIMENT,
            parent_id=cid, generation=origin.generation,
            family=f"ablation/{origin.family}", mode=origin.mode,
            hypothesis=("post-hoc ablation: slow-evaluate the single-loop pick "
                        f"({cid}); never slow-evaluated in the demo run, not "
                        "part of the promotion path"),
            delta=Delta(kind="cordis-overlay", target="system-prompt",
                        patch={"persona": persona},
                        description=f"ablation of {cid}"),
        )
        evaluator = DocsQaSlowEvaluator(
            executor=executor, questions_path=BENCH / "questions.holdout.yml",
            corpus_root=CORPUS,
            details_dir=ROOT / "runs" / "ablation", pool_size=6)
        print(f"\n=== ablation slow eval: {cid} (family {origin.family}) ===",
              flush=True)
        result = evaluator.evaluate(candidate, {"patch_path": str(patch)})
        m = result.metrics
        print(f"  holdout: task {m['task_success']:.4f}  core "
              f"{m['core_success']:.4f}  ab {m['abstention_success']:.4f}  "
              f"sy {m['synthesis_success']:.4f}  sf "
              f"{m['single_fact_success']:.4f}  cs "
              f"{m['citation_strict_success']:.4f}")
        print(f"  procedure_compliance {m.get('procedure_compliance')}  "
              f"fabrications {int(m['abstention_fabrications'])}  "
              f"timeouts {int(m['timeouts'])}  cost ${m['estimated_cost_usd']:.4f}")

        journal.record(JournalEntry(
            experiment_id=ABLATION_EXPERIMENT, candidate_id=candidate.id,
            parent_id=cid, generation=origin.generation,
            family=candidate.family, mode=origin.mode,
            hypothesis=candidate.hypothesis,
            delta_ref=f"patch:{cid}.yml", slow=result, status="slow_evaluated",
        ))
        print(f"  journaled as {candidate.id} in {ABLATION_EXPERIMENT}")
        print(f"  budget: {budget.status_line()}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
