# Methods, corrections and availability

The three studies use the same task identifiers but have different frozen protocols, input distributions, repetition counts and endpoints. Treat them as separate evidence; do not pool their sample counts, confidence intervals, success rates or inherited costs.

## Baseline and endpoint

Simple already includes iterative history, a Journal, deduplication, correctness/performance evaluation and a second development partition. The adoption question is incremental value over this baseline. The endpoint is the runtime of sealed generated C++ code on new inputs, not the elapsed duration of the agent search. Ratios below one favor the numerator program. Shared configured ceilings do not imply equal realized compute, calls or UTC time.

Its loop generates from the incumbent with bounded historical feedback, deduplicates source versions, evaluates candidates sequentially on Fast and Slow, and replaces the incumbent only on a correct, strictly better Slow verdict. It does not use the DUO Fast Top-K gate or bounded-tie admission. Search-time development feedback is separate from sealed-program final evaluation. See the [shared Simple baseline](../SIMPLE_BASELINE.zh-CN.md) for the method and [this study's configurations](SIMPLE_BASELINE.zh-CN.md) for versions, alignment treatment and resource ceilings.

## Independent units and uncertainty

The component study has 48 independent searches (8 arms × 3 tasks × 2 repeats). Its 54 contrasts share those searches. The fixed-pool study reuses 12 trajectories; it adds zero independent searches. The alignment study plans 72 searches (4 arms × 3 tasks × 6 repeats), with 65 deliveries and 7 failures. Its 126 comparisons likewise share sources. Timing blocks, workload families, evaluation pairs and repeated output checks are not new search replicates.

Intervals in RESULTS.json condition on fixed code pairs and their specified timing protocol. They do not estimate variation across generated searches or all tasks. A timing PASS does not necessarily mean an improvement passes its policy threshold. Frozen `direction`, reconstructed descriptive `state` and adoption decisions are separately retained where applicable. Small confirmed changes can coexist with a policy label EQUIVALENT.

## Corrections that change interpretation

- Fast-only's six exported deliveries fell back to the original program because of an adapter contract mismatch. The positive second-partition contrast cannot establish the benefit of independent Slow information or a properly exported Fast-only arm.
- The original tie counter matched the wrong reason string. The corrected formal count is 108, with 55 in native-tie and 53 in full. Original selections and primary ratios were not changed.
- The dedicated adaptive-quota contrast naturally triggered zero times. Other arms' activations are not evidence of benefit in that contrast.
- One incorrect component-study source produces two correctness rows. One incorrect aligned-study candidate produces three comparison-failure rows. Do not count these as independent incorrect programs.
- A historical Slow ranking did not reproduce in later same-code/same-input checks. The cause remains unknown; this does not prove the original measurement was wrong.
- Alignment recovery completes engineering execution but deviates from a fully untouched no-retry trajectory. Preserve missing and timing-invalid results instead of repeatedly measuring until they pass.

## Model and reasoning-mode evidence

Observed provider model labels identify responses, not immutable model weights. Declared configuration and actual request settings are different evidence. A `high` reasoning label on one request type does not establish that generated C++ requests used `high`; `off` and `high` must be checked at the actual request boundary. This publication does not make a uniform high-reasoning claim or redistribute/re-audit every provider request. The three included studies retain their original model-evidence scope; unrelated experiments are not used to fill gaps.

## Accounting

Known costs, unknown upper exposure and reservations remain separate. The component total includes historical and failed attempts; the alignment total uses its own inherited ledger. They must not be added as fresh spend. Recorded figures are budget accounting, not invoices. Zero new model calls during retrospective analysis or local recovery does not mean zero compute cost. Full machine CPU, human maintenance and hardware costs were not measured.

## Reproduction and source availability

Published here: curated comparison fields, candidate/source identifiers and hashes, reports, limitations and source mappings. Retained locally: original task inputs and programs, full journals, request/response bodies, raw timing streams, runtime snapshots and provider account records. No external data access or download is implied by a SHA-256. The original reports are identified but not copied wholesale. This publication supports inspection of the reported figures and their stated derivation; it does not support a clean independent replay of all historical experiments from this repository alone.

The publication performed no new model experiment or native timing measurement. Historical validation statements remain historical. New product tests exercise engineering behavior and cannot establish optimization benefit. No raw third-party task statements, solutions or datasets are included in this addition.
