# Experimental results and limits

**DUO has not demonstrated a quality or API-cost advantage over a reasonable
single-loop baseline in the completed formal comparison.** This repository is
an experimental DSH persona-optimization component. Engineering acceptance,
diagnostic findings and method effectiveness are separate claims.

The following runs were completed on 2026-09-13 with `deepseek-flash`, thinking
disabled, and no automatic model retries. The benchmark uses a bounded,
custom-runner subset of BigCodeBench, not its official full leaderboard protocol.
Every persona execution is stochastic; these small studies do not establish
stable causal effects. API costs are observed token usage multiplied by frozen
CNY tariffs, including failures; local computation is not monetized and an
independent provider invoice was not obtained.

## Frozen three-generation comparison

B1 evaluates all eight development tasks for every candidate. B2 and B3 use
six Fast tasks and two Slow tasks with additional executable boundary/property
checks. B3 removes explicit Slow feedback from subsequent generation. Each
optimization arm generates three candidates per generation for three generations.
The final split contains 18 tasks excluded from the recorded development inputs.

| Arm | Generated candidates | Final | Selected target | Model requests | API cost, CNY |
|---|---:|---:|---|---:|---:|
| B0 original | 0 | 9/18 | Original | 1 | 0.017325000 |
| B1 reasonable single-loop | 9 | 8/18 | Original | 14 | 0.177135082 |
| B2 full DUO | 9 | 8/18 | Original | 18 | 0.187869643 |
| B3 no explicit Slow feedback | 9 | 8/18 | Original | 18 | 0.153658082 |

All three optimization arms retained the original persona. Their final scores
therefore measure separate executions of the **same original**, not improved
candidates. Unselected candidates were not final-evaluated and are not zeros.
The formal package used 51 requests and CNY 0.535987807, including one B2 invalid
execution output which prevented six task executions. Its failure and charge
remain recorded. Earlier failed versions and calibration costs are separate.

Fast scores improved for some B2 candidates. All three B2 candidates admitted
to Slow tied the original at 2/2. Original Slow was already at the metric ceiling;
the frozen strict-improvement rule could not accept a candidate above that ceiling.
This explains the selection decision without establishing candidate final quality.
B3 `dl-0004` passed the seven original checks on a development task but failed
four additional boundary checks. Slow found a real local defect.

An audit of actual model inputs verified that B2 received preceding Slow evidence
in generations two and three, while B3 did not receive the explicit feedback.
The ablation changed the treatment. It did not demonstrate a benefit.

## Post-hoc shadow final

Candidates were selected using pre-final evidence, before this diagnostic run.
The original formal final was reused explicitly for diagnosis and is now
**CONSUMED_FOR_DIAGNOSIS**. The formal winner and conclusion were not rewritten.

| Object | Shadow result | Difference from new shared original |
|---|---:|---:|
| Original reference | 10/18 | — |
| B1 `dl-0009` | 9/18 | -1 |
| B2 `dl-0002` | 8/18 | -2 |
| B3 `dl-0004`, purposive diagnostic case | 11/18 | +1 |

Four requests cost CNY 0.063795960. The B3 result suggested a possible false
negative, but a single +1 task difference is not a reliable causal improvement.
Only these three generated candidates were examined; results do not characterize
the entire pool.

## Selection-quality audit on a separate final split

All six B2/B3 candidates previously admitted to Slow and one shared original
were fixed before evaluation on 18 newly selected tasks. Reference implementations
passed 18/18 and fixed wrong implementations passed 0/18 in local calibration.
This split is also now **CONSUMED_FOR_DIAGNOSIS**, excluded from search and warm
start. Public benchmark training contamination cannot be ruled out.

| Object | Original Fast | Original Slow | New final |
|---|---:|---:|---:|
| Original reference | B2 4/6; B3 5/6 | 2/2 | 13/18 |
| B2 `dl-0002` | 5/6 | 2/2 | 14/18 |
| B2 `dl-0006` | 5/6 | 2/2 | 13/18 |
| B2 `dl-0007` | 5/6 | 2/2 | 12/18 |
| B3 `dl-0003` | 5/6 | 2/2 | 13/18 |
| B3 `dl-0004` | 5/6 | 1/2 | 13/18 |
| B3 `dl-0008` | 5/6 | 2/2 | 12/18 |

Seven requests cost CNY 0.137328561. The original reference encountered a local
host-budget error after its model response. The same response was subsequently
scored locally without another model request; six candidate runs completed via
the native host. The original failed receipt is retained, not relabeled success.

All candidate Fast scores tie, so Fast ranking value is unidentifiable in this
sample. Slow has only one lower-scored candidate. Its earlier +1 did not recur
on this split. B2 `dl-0002` provides a different possible missed-selection signal,
also only +1 in one execution. Equal Slow scores accompany better, equal and
worse final outcomes. Neither rewriting the reviewer nor accepting every tie is
justified by this evidence.

## Configuration-target headroom diagnostic

A separate six-session diagnostic changed the existing DSH HTTP fetch provider's
`maxBodyChars` field. It used the same pinned documentation, six fixed questions,
strict exact-type/source-quote evaluator and real model configuration. The
transport replayed a pinned local document; native retention and model/tool
execution were real. Public HTTP retrieval was not verified in this experiment.

| Configuration | Round one | Round two | Total requests | Total API cost, CNY |
|---|---:|---:|---:|---:|
| Original 100,000 characters | 3/6 | 3/6 | 4 | 0.003297280 |
| Compact 50,000 characters | 2/6 | 2/6 | 4 | 0.002844280 |
| Expanded 200,000 characters | 6/6 | 6/6 | 4 | 0.042537120 |

All six sessions completed under one frozen protocol, with 12 requests costing
CNY 0.048678680, no failures or retries and fully reconciled usage. Expanded
retention met the preregistered quality-headroom rule in both rounds. Cache
conditions differed; compact retention lost a correct answer and expanded
retention did not establish cost savings. Earlier stopped protocol versions
remain separate and are not pooled into this table.

This identifies a controllable configuration with room for improvement. The
variants were fixed before running and were not generated by DUO. A configuration
search adapter and B0/B1/B2 candidate-quality diagnostic remain unimplemented
and unrun. (Superseded 2026-09-14: both now exist and the corrected comparison
completed — see the next section.) This result is therefore neither a DUO method
comparison nor evidence
that the product already supports arbitrary configuration Targets. These six
development questions are not an independent final split.

## Corrected configuration-search comparison (2026-09-14)

After the config target shipped (0.4.0), a first real search run
(`config-search-20260914`, 4 requests / CNY 0.03277904 settled) stopped per the
freeze rules on an execution-precondition failure: the first candidate never
called `web_fetch` (0 tool calls, all answers UNKNOWN). Two follow-up runs under
`runs/root-cause-diagnostic-20260913/` resolved that failure and completed the
comparison:

- **`required-tool-verify-20260914` (protocol v2)** — the named-`tool_choice`
  execution-precondition fix validated by real API: 2 requests / CNY 0.03234696.
  Candidate dl-0001 (`maxBodyChars=120000`) entered one real `readBody` and
  scored VALID 14/18 on the 18-task dev union under the frozen exact evaluator.
- **`config-search-corrected-20260914` (protocol v1)** — corrected same-harness
  B0/B1/B2 comparison with pre-registered selection and a once-consumed
  diagnostic final. COMPLETED: 44 requests / CNY 0.18554908, no stops, all usage
  known. B1 generated five 18/18 dev-union candidates (new-harness baseline dev
  row: 10/18).

| Object | Dev union (18) | Diagnostic final (12) |
|---|---:|---:|
| Baseline (`maxBodyChars=100000`) | 10/18 | 8/12 |
| B1 best-dev dl-0002 (180000) | 18/18 | 12/12 |
| B2 dl-0001 (150000, fast-high + slow-measured) | — | 12/12 |

DUO dual-loop versus single-loop **TIED** on this diagnostic: both loops selected
12/12 candidates (B1 17 requests, B2 21). The formal conclusion — no demonstrated
quality or cost advantage over a reasonable single loop — is UNCHANGED and gains
same-direction evidence. The root-cause goal is CLOSED with classification
resolved per component: execution precondition root-caused and fixed; search can
generate genuinely better candidates on this diagnostic; selection showed no
error in this sample; Slow-rejection accuracy and the 150000-vs-180000 ranking
remain INSUFFICIENT_EVIDENCE due to ceiling ties and single-run noise.

Caveats that must accompany these numbers: single execution per object; large
answer-side nondeterminism observed (the same 120000 config scored 14/18 in the
verification package but 0/18 as a B1 candidate); final questions come from the
same previously-public source document as dev (new questions, NOT unseen
corpus); 12/12 and 18/18 are ceiling ties; the diagnostic covers only the
`maxBodyChars` knob; old-harness scores (e.g. the baseline frozen 0/18) are
retained as history and never restated as new-harness results.

The 12-question diagnostic final (`config-diagnostic-final-twelve-v1`) is now
**CONSUMED_FOR_DIAGNOSIS**: it must never again be presented as an unevaluated
final.

## Reproduction boundary

[experiment-evidence.json](experiment-evidence.json) contains selected aggregate
results and hashes of the retained original reports. It is an evidence index,
not an independent replication or a complete public research archive. Raw
sessions, journals, account ledgers and the formal/audit final datasets described
above remain outside this source distribution. Their historical hashes do not
make absent artifacts available. A separate legacy 36-task BigCodeBench regression
fixture is included with its Apache-2.0 attribution; every partition in that
fixture, including its historical `final` label, is exposed test data.

The public preparation/execution scripts and [benchmark guide](CODE_BENCHMARK_GUIDE.md)
support new explicitly authorized runs with new data and budget. The offline
[product gate](TESTING.md) verifies plugin behavior; it does not rerun these paid
experiments or prove their method conclusions. Do not reuse consumed final data
as an unseen final, deploy diagnostic candidates, or pool different protocols.

No Graph/Bayesian reviewer, new research goal or candidate adoption is triggered
by these reports. The current evidence motivates a bounded investigation of
target controllability and ceiling/tie policy, with **insufficient evidence** for
a general Search-versus-Selection causal attribution.
