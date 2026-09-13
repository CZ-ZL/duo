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
must not be presented as unseen data in future experiments. (Updated 2026-09-14:
the 12-question diagnostic final `config-diagnostic-final-twelve-v1` is now also
consumed — `CONSUMED_FOR_DIAGNOSIS` — after its single once-consumed evaluation.)

[EXPERIMENTS.md](EXPERIMENTS.md) and [experiment-evidence.json](experiment-evidence.json)
include the formal negative result, subsequent selection diagnostics and completed
configuration headroom test. The latter used 12 real requests and found repeatable
task differences in two rounds; configuration-target DUO search and candidate
final evaluation remain unimplemented/unrun. (Superseded 2026-09-14: see the
updates below — the config target is now implemented and a corrected B0/B1/B2
config-search comparison has completed.) The broader Root Cause Goal is open.
(Superseded 2026-09-14: the root-cause goal is now CLOSED with per-component
classification — see the update below.)

Raw model requests, private configuration, account ledgers and journals are
excluded. Research replay tests are retained but require separately reviewed
archives; missing-input failures are recorded and not counted as product passes.

[Historical acceptance metadata](HISTORICAL_EVIDENCE.json) includes a successful
real Caller/custom-evaluator evaluation and its preceding failures. This is older
local-archive evidence, not a fresh acceptance of the publication candidate.

## Update — 2026-09-14 (0.4.0)

The configuration target is implemented and offline-accepted: the new
`dsh-plugin-config` target kind (`native/config-target.js`,
`native/config-generator.js`) varies only integer `maxBodyChars` in
`[50000,200000]` on an isolated fetch-plugin overlay and is shipped and publicly
exported in the npm package. A real single-loop search run (package
`config-search-20260914`, 52 requests / ¥2 authorized) settled at 4 requests /
¥0.03277904: real model generation works and produced two config candidates, but
the run stopped per the freeze rules on the first candidate's
execution-precondition failure — it never called `web_fetch` (0 tool calls, all
answers UNKNOWN). The frozen baseline score remains 0/18. A follow-up 2-request /
¥0.90 verification (`maxBodyChars=120000` plus a named `web_fetch` `tool_choice`,
kept as an opt-in research example pending that validation) is prepared but not
yet executed. The root-cause goal remains open with classification
INSUFFICIENT_EVIDENCE; the formal conclusion stands: no proven quality or cost
advantage over a reasonable single loop. (Superseded 2026-09-14: the verification
PASSED and the corrected comparison completed — see the update below.)

## Update — 2026-09-14 (corrected comparison complete)

Two verified runs closed the open items above (artifacts under
`dualloop/runs/root-cause-diagnostic-20260913/`):

- `required-tool-verify-20260914` (protocol v2): the named-`tool_choice`
  execution-precondition fix was validated by real API — 2 requests /
  ¥0.03234696. Candidate dl-0001 (`maxBodyChars=120000`) entered one real
  `readBody` and scored VALID 14/18 on the 18-task dev union under the frozen
  exact evaluator.
- `config-search-corrected-20260914` (protocol v1): the corrected same-harness
  B0/B1/B2 comparison with pre-registered selection and a once-consumed
  diagnostic final COMPLETED — 44 requests / ¥0.18554908, no stops, all usage
  known. B1 generated five 18/18 dev-union candidates (new-harness baseline dev
  row: 10/18). On the frozen 12-question diagnostic final: baseline(100000) 8/12,
  B1 best-dev dl-0002(180000) 12/12, B2 dl-0001(150000, fast-high +
  slow-measured) 12/12. DUO dual-loop vs single-loop TIED on this diagnostic
  (both selected 12/12 candidates; B1 17 requests vs B2 21). The formal
  conclusion — no demonstrated quality or cost advantage over a reasonable
  single loop — is UNCHANGED and gains same-direction evidence.
- The root-cause goal is now CLOSED with classification resolved per component:
  execution precondition root-caused and fixed; search can generate genuinely
  better candidates on this diagnostic; selection showed no error in this
  sample; Slow-rejection accuracy and the 150000-vs-180000 ranking remain
  INSUFFICIENT_EVIDENCE due to ceiling ties and single-run noise.
- Honesty caveats: single execution per object; large answer-side
  nondeterminism observed (the same 120000 config scored 14/18 in the
  verification package but 0/18 as a B1 candidate); final questions come from
  the same previously-public source document as dev (new questions, NOT unseen
  corpus); 12/12 and 18/18 are ceiling ties; the diagnostic covers only the
  `maxBodyChars` knob; old-harness scores (e.g. the baseline frozen 0/18) are
  retained as history and never restated as new-harness results.
- The 12-question diagnostic final (`config-diagnostic-final-twelve-v1`) is now
  `CONSUMED_FOR_DIAGNOSIS` and must never again be presented as an unevaluated
  final.
