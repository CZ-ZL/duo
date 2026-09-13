# Bounded ordered search stages (credibility ladder)

Legacy `fast` / `slow` objectives still enter the same native stage loop. For an
explicit configuration, replace those flat fields with `searchStages`: an ordered
credibility ladder of **one or more stages with caller-chosen tier names — depth
is uncapped** (two stages is the common default)
(`^[a-z][a-z0-9_]{0,31}$`, never `final`/`baseline`). Array order is increasing
fidelity and cost: the cheapest screen first, the terminal validation stage last.
`fast`, `fast/slow` and `fast/review/slow` remain valid ladders; names such as
`lint/benchmark/holdout/audit` are equally accepted. Do not also supply flat
search objectives. `final` remains a separate objective and never feeds search.

Each stage contains the usual evaluator/version/data/metric/direction/weights,
plus `purpose` (`screen`, `rank`, or `confirm`), `informationGain`,
`maxEvaluations`, and `topK`. Declare the actual information added or why a repeat
is intended. A more expensive stage is not automatically more reliable.

`maxEvaluations` includes the baseline and each reserved candidate execution,
including failures. `topK` limits entry into the next stage, cannot exceed the
existing global `topK`, and must be zero at the last search stage. Every transition
uses the selected public gate; the last search stage uses the strict comparator
to select a champion. Final confirmation remains independent of that selection.
The optional tie gate's `maxTies` applies at each transition in each generation.
No gate may exceed remaining limits or admit invalid/constraint-failing evidence.

The **first** stage consumes `maxFastEvals`. Every deeper stage and final share
`maxSlowEvals`; all work also consumes the existing monetary and operation
allowances. There is no additional budget, scheduler or Agent per stage. A stage
whose `maxEvaluations` is exhausted admits no further promotions through its
gate; any admission attempt beyond the frozen per-stage limit fails with
`DUO_STAGE_BUDGET_EXHAUSTED`. Unknown costs keep the ordinary stop behavior.

Every model-backed provider accepts dataset splits named after the contract's own
tiers, with distinct data IDs, task IDs and input strings across all splits. Only
the requested split and public source paths reach that execution. Deeper-stage
observations can enter later generation through existing feedback providers;
final results and raw outputs do not. Warm-history compatibility includes every
declared stage and its providers.

The [three-stage contract](three-stage-experiment.json) and
[profile patch](three-stage-profile.patch.yml) reuse the existing BYO function
evaluator and structural fixture generator, and the
[four-level ladder contract](ladder-experiment.json) shows caller-named rungs
(`lint/benchmark/holdout/audit`). These examples deliberately repeat simple
fixture checks to demonstrate engineering composition. They are not evidence of
optimization benefit, empirical fidelity or independent Caller success.

From `dualloop`, use a cached DSH and a new output directory:

```sh
python3 scripts/verify_dsh_native.py --dsh-package /path/to/node_modules/@deepseek-ai/dsh --output /authorized/new-stage-check --scenario byo --scenario three-stage
```

This packages the current plugin offline, starts real named DSH profiles, calls
public design/plan/run/report tools, verifies all stage measurements and next
generation feedback, and retains SQLite Journal, accounting and host receipts.
It makes zero paid requests and does not change the user's profile. For normal
use, set the paths in the example patch, place its BYO modules beside the profile,
and load the existing DUO bundle and DSH tool services before applying the patch.

Reports expose `searchStages`, per-candidate measurements/comparisons under each
declared tier name and `stageAttempts`. Stage metadata changes invalidate a
previously inspected plan. Old Journal records are not backfilled with
observations they never recorded.
