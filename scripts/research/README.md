# Research and retained Caller drivers

These utilities support historical studies and specific configured-Caller paths.
Start from the [research guide index](../../docs/research/README.md) or the
[product verification map](../README.md), which identifies the driver to use.
A filename or example budget is not an instruction to execute an experiment.

| Area | Guide or use |
| --- | --- |
| Configured Caller evaluation | [Calling guide](../../docs/research/NATIVE_CALLING_GUIDE.md) |
| Native model experiments | [Model guide](../../docs/research/NATIVE_MODEL_GUIDE.md) |
| Code benchmarking | [Benchmark guide](../../docs/research/CODE_BENCHMARK_GUIDE.md) |
| Historical acceptance tools | [Acceptance guide](../../docs/research/NATIVE_ACCEPTANCE_GUIDE.md) |
| Python code isolation | `code_evaluation.py` and its worker also support the deterministic product gate |
| Isolated DSH profiles | `dsh_model_profile.py` stages selected package files and drivers; examples may be copied beside them by callers |

Several files are imported by current offline controls even though their original
purpose was research. Keep dependency users and staging code in view before
moving or removing a file. Raw run archives are not included in the public
repository; historical tests requiring them are separately marked in
[TESTING.md](../../docs/development/TESTING.md).

No paid research is included in the ordinary product gate. A research run needs
its own task, data, source binding, budget and current authorization.

## Ownership inventory

[INVENTORY.json](INVENTORY.json) lists every retained file with its role and
explicit current verification users. `shared_verification` includes code
isolation and the Caller/model drivers imported by offline tests. Remaining
entries are retained drivers, support modules or fixtures. This inventory is
checked by `npm run docs:check`; adding/removing a file or deleting a named
consumer requires updating the map. It is not a complete dynamic call graph.

The installed runtime has no dependency on this directory. Existing paths stay
stable because test consumers and historical source bindings still refer to them.
