"""Minimal CLI: python3 -m dualloop run --experiment FILE [--journal-dir DIR]
                python3 -m dualloop status --journal-dir DIR   (JSON summary)"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

from .controller import LoopController, RunSummary, build_controller
from .journal import JsonlJournal
from .agent_api import AgentError, discover, error_payload, make_plan, read_config, read_result


def _print_summary(summary: RunSummary, controller: LoopController) -> None:
    print(f"experiment : {summary.experiment_id}")
    print(f"mode       : {summary.mode}")
    for label in summary.labels:
        print(f"label      : {label}")
    print(f"generations: {summary.generations_run}")
    print(f"stop       : {summary.stop_reason}")
    cost = "unknown" if summary.cost_usd is None else f"${summary.cost_usd:.9f}"
    print(f"evals      : fast={summary.fast_evals} slow={summary.slow_evals} cost={cost}")
    if summary.cost_accounting:
        print('cost scope : cumulative ledger; historical estimate; eval counts above are this invocation')
        for phase, values in summary.cost_accounting['phases'].items():
            total = 'unknown' if values['cost_usd'] is None else f"${values['cost_usd']:.9f}"
            print(f"{phase:<11}: total={total} known=${values['known_cost_usd']:.9f} "
                  f"reserved=${values['reserved_cost_usd']:.9f}")
    if summary.failure_reason:
        print(f'failure    : {summary.failure_reason}')
    if summary.champion_id:
        print(f"champion   : {summary.champion_id}")
    if summary.proxy_leader_id:
        print(f"proxy leader (NOT validated): {summary.proxy_leader_id}")
    if summary.insight:
        print(f"insight    : {summary.insight}")
    print("\ncandidate state (latest per id):")
    print(f"  {'id':<9}{'gen':<4}{'mode':<9}{'family':<36}{'status':<15}decision")
    for e in sorted(controller.journal.latest().values(),
                    key=lambda e: (e.generation, e.candidate_id)):
        decision = e.slow_decision or e.promotion_decision or e.failure_reason or ""
        print(f"  {e.candidate_id:<9}{e.generation:<4}{e.mode:<9}{e.family:<36}"
              f"{e.status:<15}{decision}")


def cmd_run(args) -> int:
    exp_path = Path(args.experiment)
    config = read_config(exp_path)
    if "agent" in config:
        from .agent_api import execute_plan
        if not args.journal_dir:
            raise AgentError("INPUT_MISSING", "artifacts", "--journal-dir is required",
                             "Choose a new run directory and inspect plan before run.")
        if args.generations is not None:
            config["generations"] = args.generations
        plan = make_plan(config, exp_path, args.journal_dir)
        result = execute_plan(config, plan, args.plan_digest)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        return 2 if result["status"] == "failed" else 0
    if args.journal_dir:
        journal_dir = Path(args.journal_dir)
    elif config.get("journal_dir"):
        # per-experiment default; prevents offline mock regressions from
        # appending into a real experiment's journal (2026-09-06 incident:
        # a mock run id-collided with demo candidates dl-0001..dl-0007)
        journal_dir = Path(config["journal_dir"])
    else:
        journal_dir = exp_path.parent / "journal"
    if args.generations is not None:
        config["generations"] = args.generations
    config["verbose"] = args.verbose
    controller = build_controller(config, journal_dir)
    summary = controller.run()
    _print_summary(summary, controller)
    return 2 if summary.failure_reason or summary.cost_usd is None else 0


def cmd_status(args) -> int:
    """Print a machine-readable (JSON) summary of a journal directory.

    Additive shim for the Phase B dsh-plugin: the cordis plugin shells out to
    this command instead of reimplementing journal reading. Exit code is 0
    even for an empty/missing journal (status of "nothing yet" is a valid
    answer); malformed history lines still raise, fail-loud.
    """
    journal = JsonlJournal(args.journal_dir, create=False)
    result_path = journal.root / "result.json"
    stored_result = read_result(journal.root) if result_path.exists() else None
    try:
        latest = journal.latest()
        entries = journal.read()
    except (OSError, ValueError, KeyError, TypeError):
        raise AgentError("JOURNAL_INCOMPLETE", "journal", "Journal is unreadable, incomplete or malformed",
                         "Preserve the journal bytes, check its owning process and reconcile complete events before any new run.") from None
    champions = [e.candidate_id for e in latest.values() if e.status == "champion"]
    payload = {
        "journal_dir": str(journal.root),
        "history_exists": journal.history_path.exists(),
        "transitions": len(entries),
        "candidates": len(latest),
        "champion": champions[-1] if champions else None,
        "deprecated": sorted(journal.deprecated_ids()),
        "latest": [
            {
                "candidate_id": e.candidate_id,
                "experiment_id": e.experiment_id,
                "generation": e.generation,
                "family": e.family,
                "mode": e.mode,
                "status": e.status,
                "promotion_decision": e.promotion_decision,
                "slow_decision": e.slow_decision,
                "failure_reason": e.failure_reason,
                "ts": e.ts,
            }
            for e in sorted(latest.values(),
                            key=lambda e: (e.generation, e.candidate_id))
        ],
    }
    if result_path.exists():
        payload["result"] = stored_result
    elif (journal.root / "plan.json").exists():
        payload["run_state"] = "running_or_interrupted"
        payload["next_action"] = "Check the owning process and journal; do not repeat uncertain operations."
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def cmd_plan(args) -> int:
    plan = make_plan(read_config(args.experiment), args.experiment, args.journal_dir)
    print(json.dumps(plan, ensure_ascii=False, indent=2, allow_nan=False))
    return 0


def cmd_discover(args) -> int:
    print(json.dumps(discover(), ensure_ascii=False, indent=2))
    return 0


def cmd_budget(args) -> int:
    from .runtime.budget import BudgetExhausted, SessionBudget
    try:
        # Inspection never creates a new empty ledger on a misspelled path.
        state = SessionBudget.inspect(args.budget_file)
        if args.cmd == 'budget-reconcile':
            budget = SessionBudget(args.budget_file)
            budget.reconcile(args.receipt)
            state = budget.snapshot()
        print(json.dumps(state, ensure_ascii=False, indent=2, allow_nan=False))
        return 2 if args.cmd == 'budget-reconcile' and (
            state.get('blocked_reason') or state['cost_usd'] is None) else 0
    except (OSError, ValueError, KeyError, TypeError, BudgetExhausted) as exc:
        raise AgentError('BUDGET_RECOVERY_FAILED', 'budget', str(exc),
                         'Preserve the ledger and receipts; inspect the operation owner and matching receipt. '
                         'Do not reset the ledger or repeat the external call.') from None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="dualloop", description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p_run = sub.add_parser("run", help="run an experiment (mock mode is offline)")
    p_run.add_argument("--experiment", required=True, help="experiment YAML file")
    p_run.add_argument("--journal-dir", default=None)
    p_run.add_argument("--generations", type=int, default=None)
    p_run.add_argument("--verbose", action="store_true")
    p_run.add_argument("--plan-digest", help="Agent-native plan digest; verifies the inspected inputs")
    sub.add_parser("discover", help="machine-readable capabilities and contracts; no execution")
    p_plan = sub.add_parser("plan", help="inspect/fingerprint an Agent-native experiment without executing plugins")
    p_plan.add_argument("--experiment", required=True)
    p_plan.add_argument("--journal-dir", required=True)
    p_status = sub.add_parser("status", help="print a JSON summary of a journal")
    p_status.add_argument("--journal-dir", required=True)
    p_budget = sub.add_parser('budget-status', help='read a budget ledger without executing work')
    p_budget.add_argument('--budget-file', required=True)
    p_reconcile = sub.add_parser('budget-reconcile', help='apply one staged receipt without repeating its call')
    p_reconcile.add_argument('--budget-file', required=True)
    p_reconcile.add_argument('--receipt', required=True)
    args = ap.parse_args(argv)
    try:
        return {"run": cmd_run, "status": cmd_status, "discover": cmd_discover,
                "plan": cmd_plan, 'budget-status': cmd_budget,
                'budget-reconcile': cmd_budget}[args.cmd](args)
    except AgentError as exc:
        print(json.dumps(error_payload(exc), ensure_ascii=False, indent=2))
        return 2


if __name__ == "__main__":
    sys.exit(main())
