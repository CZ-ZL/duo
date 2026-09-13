# Publication status

This is the experimental 0.3.0 source preview prepared for `CZ-ZL/duo`.
It does not represent completion of the project's formal 1.0.0 release gates.
No npm publication, production deployment or automatic candidate adoption is
part of this delivery. Source upload is complete. The full clean-environment
[GitHub product gate](https://github.com/CZ-ZL/duo/actions/runs/34764675244) passed
at code commit `df8f3a2`: 285 native tests, 451 Python product tests, 86 research
tests deselected, 21 DSH profiles and the actual tarball. Later report/metadata
updates preserve the tested code.

Preparation changes packaging, documentation, reproducible example inputs and
verification. The existing runtime is retained with the independently developed
exact-decimal accounting correction and its regression tests. Original experiments, fees,
personas, candidate deltas and conclusions are not rewritten.

Local evidence is recorded in the publication report accompanying this candidate.
An actual offline tarball installation into a new DSH profile succeeded; all
50 installed files matched and the bundle was automatically registered. A fresh
packaged demonstration also passed with existing DSH dependencies. Peer dependency
warnings remain recorded: this is not a fresh registry installation. The local
registry probe failed with `ECONNRESET`. `tsc` was unavailable, so semantic
compilation is not claimed. GitHub Actions subsequently installed dependencies
from the registry and passed the full gate on Ubuntu 22.04. Earlier Ubuntu 24.04
namespace failures and an artifact-upload OOM remain in their original runs.

Historical experiments did not establish a general quality or total-cost
advantage over a reasonable single-loop baseline. Offline example scores are
functional evidence only. Public historical final partitions are consumed and
must not be presented as unseen data in future experiments.

[EXPERIMENTS.md](EXPERIMENTS.md) and [experiment-evidence.json](experiment-evidence.json)
include the formal negative result, subsequent selection diagnostics and completed
configuration headroom test. The latter used 12 real requests and found repeatable
task differences in two rounds; configuration-target DUO search and candidate
final evaluation remain unimplemented/unrun. The broader Root Cause Goal is open.

Raw model requests, private configuration, account ledgers and journals are
excluded. Research replay tests are retained but require separately reviewed
archives; missing-input failures are recorded and not counted as product passes.

[Historical acceptance metadata](HISTORICAL_EVIDENCE.json) includes a successful
real Caller/custom-evaluator evaluation and its preceding failures. This is older
local-archive evidence, not a fresh acceptance of the publication candidate.
