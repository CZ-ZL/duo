# Research methods and results

## Shared baselines

[Simple: shared iterative optimization baseline](SIMPLE_BASELINE.zh-CN.md) explains the method with a structure diagram, retained feedback and evaluation capabilities, and implementation provenance. Simple is reused across experiments. Each study separately binds its version, task, evaluation protocol and resource limits.

## Latest completed-stage research

[DUO task optimization closeout through 2026-11-05](duo-task-optimization-20261105/README.md): three separately scoped studies, a working paper, curated per-comparison results and provenance. Retain Simple; current full and aligned DUO are not adopted.

Start with [EXPERIMENTS.md](EXPERIMENTS.md) for the retained method outcomes and
their limitations. Historical sections and JSON evidence summaries are retained;
they are not current release status. Relative paths in sealed records
refer to the original commit, with relocations recorded in the
[migration map](../development/REPOSITORY_MIGRATION.json).

The other guides here document earlier model, benchmark and configured-Caller
entry points. Their runnable script references now point to
`scripts/research/`. They are not prerequisites for product installation.
These scripts may require private historical inputs or explicitly authorized
model calls. Moving them grants no spending permission and does not resume any
experiment. Use [the product guide](../../dsh-plugin/AGENT_GUIDE.md) for current usage.

## Guides and source utilities

| Area | Guide |
| --- | --- |
| Native model experiments | [Model guide](NATIVE_MODEL_GUIDE.md) |
| Configured Caller paths | [Calling guide](NATIVE_CALLING_GUIDE.md) |
| Retained acceptance workflows | [Acceptance guide](NATIVE_ACCEPTANCE_GUIDE.md) |
| Code benchmarking | [Benchmark guide](CODE_BENCHMARK_GUIDE.md) |
| Driver inventory and staging | [Research scripts](../../scripts/research/README.md) |
| Exposed input snapshots | [Research inputs](../../research/README.md) |

Shared methods live at this level. Dated study directories own their frozen
configurations, selected results and source bindings. Historical guides may
require local evidence that is not distributed; use their stated prerequisites.
