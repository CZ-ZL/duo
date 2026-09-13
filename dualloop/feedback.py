"""FeedbackEngine: FeedbackSummary from the full journal — conservative by
construction (DESIGN.md "Slow-to-Fast Feedback" rule #5, audit A3).

Demo-scale generations are small, so early family-level statistics are noise:

(a) a mutation family is penalized only after >= `slow_failure_threshold`
    slow failures (default 2, configurable);
(b) correlations below `min_sample_size` are reported as "insufficient_data",
    never as findings;
(c) `suggestedEmphasis` shifts are bounded to +/- `max_emphasis_shift` quota
    slots per generation.

Feedback steers GENERATION only, never the comparator policy (rule #4 —
changing the definition of "better" mid-experiment destroys comparability).
"""
from __future__ import annotations

import statistics
from collections import Counter

from .models import (
    MODES, FamilyOutcome, FeedbackSummary, JournalEntry, Mode,
)


class FeedbackEngine:
    def __init__(self, slow_failure_threshold: int = 2,
                 min_sample_size: int = 4, max_emphasis_shift: int = 1):
        self.slow_failure_threshold = slow_failure_threshold
        self.min_sample_size = min_sample_size
        self.max_emphasis_shift = max_emphasis_shift

    def compute(self, entries: list[JournalEntry],
                fast_metrics: list[str],
                upper_metric: str,
                base_emphasis: dict[str, int]) -> FeedbackSummary:
        """Recompute the summary from the full (blocklist-filtered) journal.

        `entries` should be the latest entry per candidate
        (JsonlJournal.latest().values()).
        """
        primary_fast = fast_metrics[0] if fast_metrics else None

        # ---- family outcomes + slow failure counting ----
        families: dict[str, FamilyOutcome] = {}
        fast_vals: dict[str, list[float]] = {}
        slow_vals: dict[str, list[float]] = {}
        family_modes: dict[str, Counter] = {}
        for e in entries:
            fam = families.setdefault(e.family, FamilyOutcome())
            family_modes.setdefault(e.family, Counter())[e.mode] += 1
            if e.fast is not None and e.fast.ok and primary_fast is not None:
                v = e.fast.metrics.get(primary_fast)
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    fast_vals.setdefault(e.family, []).append(float(v))
            if e.slow is not None and e.slow.ok:
                fam.n += 1
                v = e.slow.metrics.get(upper_metric)
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    slow_vals.setdefault(e.family, []).append(float(v))
                if e.slow_decision == "rejected":
                    fam.slow_failures += 1
        for fam_name, fam in families.items():
            fv, sv = fast_vals.get(fam_name, []), slow_vals.get(fam_name, [])
            fam.fast_avg = statistics.fmean(fv) if fv else 0.0
            fam.slow_avg = statistics.fmean(sv) if sv else 0.0
            # (a) penalize only after >= threshold slow failures
            fam.penalized = fam.slow_failures >= self.slow_failure_threshold

        penalized = sorted(f for f, o in families.items() if o.penalized)
        failed_regions = [
            f"family:{f} fast-high/slow-low "
            f"(fast_avg={families[f].fast_avg:.2f} slow_avg={families[f].slow_avg:.2f} "
            f"slow_failures={families[f].slow_failures})"
            for f in penalized
        ]

        # ---- proxy alignment: per fast metric, correlation with the upper metric ----
        correlation: dict[str, float | str] = {}
        paired: dict[str, list[tuple[float, float]]] = {m: [] for m in fast_metrics}
        for e in entries:
            if e.fast is None or e.slow is None or not (e.fast.ok and e.slow.ok):
                continue
            up = e.slow.metrics.get(upper_metric)
            if not isinstance(up, (int, float)) or isinstance(up, bool):
                continue
            for m in fast_metrics:
                v = e.fast.metrics.get(m)
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    paired[m].append((float(v), float(up)))
        for m, pairs in paired.items():
            # (b) below min_sample_size: insufficient data, never a finding
            if len(pairs) < self.min_sample_size:
                correlation[m] = "insufficient_data"
                continue
            xs, ys = [p[0] for p in pairs], [p[1] for p in pairs]
            correlation[m] = (statistics.correlation(xs, ys)
                              if len(set(xs)) > 1 and len(set(ys)) > 1 else 0.0)

        # ---- champion lineage ----
        lineage = [e.candidate_id
                   for e in sorted(entries, key=lambda e: e.ts)
                   if e.status == "champion"]

        # ---- (c) bounded emphasis shift ----
        emphasis = {m: int(base_emphasis.get(m, 0)) for m in MODES}
        budget = self.max_emphasis_shift
        for fam_name in penalized:
            if budget <= 0:
                break
            modes = family_modes.get(fam_name)
            if not modes:
                continue
            src: Mode = modes.most_common(1)[0][0]
            dst: Mode = "exploit" if src != "exploit" else "explore"
            if emphasis[src] > 0:
                emphasis[src] -= 1
                emphasis[dst] += 1
                budget -= 1

        return FeedbackSummary(
            fast_slow_correlation=correlation,
            family_outcomes=families,
            failed_proxy_regions=failed_regions,
            penalized_families=penalized,
            champion_lineage=lineage,
            suggested_emphasis=emphasis,
        )
