#!/usr/bin/env python3
"""Budget sizing for the docs_qa demo run — computed BEFORE any run.

Per-session costs are OBSERVED calibration averages (runs/CALIBRATION.md §8,
ledgers runs/session_budget_v2*.json):
  dev fast eval:   $2.1976 / 32 sessions  (runs/session_budget_v2.json)
  holdout slow:    $1.7702 / 24 sessions  (holdout batch in session_budget_v2b)
  proposer:        ~$0.03 (smoke-session magnitude, prompt-only)

A candidate fast eval = 32 sessions (core 20 + guardrails 12; contract
requires both guardrail rates per candidate). A promoted slow eval = 24
sessions (holdout core 16 + guardrails 8). The baseline is SEEDED from the
frozen calibration measurements (0 sessions).

The run must stay under $5.50 estimated (margin under the $6.00 contract cap).
"""
from __future__ import annotations

COST_DEV_SESSION = 2.1976 / 32      # observed, v2 baseline batch
COST_HOLDOUT_SESSION = 1.7702 / 24  # observed, v2 holdout batch
COST_PROPOSER = 0.03                # estimate, prompt-only session
TARGET_USD = 5.50
CONTRACT_CAP_USD = 6.00

FAST_SESSIONS = 32   # core 20 + sf 6 + cs 6
SLOW_SESSIONS = 24   # holdout core 16 + sf 4 + cs 4


def project(generations: int, candidates_per_gen: int, top_k: int,
            seed_baseline: bool = True) -> dict:
    n_cand = generations * candidates_per_gen
    fast_sessions = n_cand * FAST_SESSIONS
    slow_sessions = generations * top_k * SLOW_SESSIONS
    proposer = n_cand
    baseline_sessions = 0 if seed_baseline else FAST_SESSIONS + SLOW_SESSIONS
    sessions = fast_sessions + slow_sessions + proposer + baseline_sessions
    cost = (fast_sessions * COST_DEV_SESSION
            + slow_sessions * COST_HOLDOUT_SESSION
            + proposer * COST_PROPOSER
            + baseline_sessions * COST_DEV_SESSION)
    return {"generations": generations, "candidates": n_cand, "top_k": top_k,
            "sessions": sessions, "cost_usd": round(cost, 2)}


def main() -> int:
    plans = [
        ("3 generations x 5 candidates, promote top-2", project(3, 5, 2)),
        ("3 generations x 4 candidates, promote top-2 (contract quotas)",
         project(3, 4, 2)),
        ("2 generations x 4 candidates, promote top-2", project(2, 4, 2)),
        ("1 generation  x 4 candidates, promote top-2", project(1, 4, 2)),
        ("1 generation  x 2 candidates, promote top-2", project(1, 2, 2)),
        ("1 generation  x 2 candidates, no slow tier", project(1, 2, 0)),
    ]
    print(f"target ${TARGET_USD:.2f} (contract cap ${CONTRACT_CAP_USD:.2f}); "
          f"session costs: dev ${COST_DEV_SESSION:.4f} holdout "
          f"${COST_HOLDOUT_SESSION:.4f} proposer ${COST_PROPOSER:.2f}")
    print(f"{'plan':<58}{'sessions':>9}{'est $':>8}  fits?")
    for name, p in plans:
        fits = "YES" if p["cost_usd"] <= TARGET_USD else "no"
        print(f"{name:<58}{p['sessions']:>9}{p['cost_usd']:>8.2f}  {fits}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
