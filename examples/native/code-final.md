# Prepare a new final without changing the development experiment

`scripts/prepare_code_final.py` derives a new 18-task final from the same pinned
BigCodeBench source and a completed recorded-project exposure audit. It keeps
the 6 Fast / 12 Slow public inputs, key rows and evaluator version unchanged. It
rejects source drift, incomplete exposure, omitted known IDs, fabricated pools
and insufficient remaining tasks before creating output. The source pack stays
immutable; every output must be new.

The caller supplies an explicit selection seed before any candidate evaluation.
The entry uses SHA256(seed + colon + task ID), selects the first 18 permitted IDs,
and keeps their original public contracts, reference code and tests. It never
selects by model score or silently replaces a task after failure.

```sh
python3 scripts/prepare_code_final.py --pack runs/code-method-goal-20260912/benchmark-v24-qualified --source runs/code-benchmark-readiness-20260911/upstream/BigCodeBench-v0.1.4.jsonl --exposure runs/code-measurement-readiness-20260912/final-exposure-inventory.json --seed duo-code-method-new-final-20260912-v1 --output /tmp/duo-independent-final-new
```

The audit must bind `sourceSha256`, `exposedTaskIds`, the exact remaining eligible
ID set, status `RECORDED_EXPOSURE_AUDITED_WITH_SOURCE_COPY_CLASSIFICATION`, and no
unreadable records. This is provenance from retained project evidence, not a
cryptographic proof of every external session or absence from model training.
Complete corpus copies are source storage; changed rows and actual task uses,
including fixtures, remain excluded. Audit classification must be justified.

The output pack feeds the existing `scripts/run_code_comparison.py
--benchmark-pack` entry. `final-provenance.json` records seed, exposure/source
hashes, selected row digests and development preservation. Development
qualification is explicitly reused; final starts `NOT_RUN`/unqualified.
Creating data does not qualify final, authorize model use or prove improvement.

The completed local example is
`runs/code-measurement-readiness-20260912/new-final-pack/`.
The adjacent `final-readiness.json` records 18 original references passing and
18 fixed always-error controls being rejected, plus public four-arm input
preparation. That is bounded source/runner readiness; no model candidate was
evaluated on the new final, no judge was fitted on it, and it is not an official
benchmark leaderboard result. Preserve the construction snapshot and refer to
the later readiness receipt rather than relabeling old execution results.
