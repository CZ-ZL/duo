# Use DUO from an Agent

DUO runs bounded evaluation and candidate experiments inside DSH. Use it when an
owner has a supported object to change, a measurable goal and permission to test.
It returns changes, measurements, decisions, costs and retained failures.
A one-off answer, arbitrary code rewrite or automatic deployment needs a different
workflow.

## First use

Follow the packaged [Quickstart](./QUICKSTART.md) from installation to a saved
report. It has a free local check and a complete grounded-QA model template.
It states the live-acceptance status, necessary owner inputs and request bound.
No source-code reading or historical research guide is needed for that path.

For an existing authorized profile, use these public tools directly:

| Step | Tool / required check |
|---|---|
| Discover | `dualloop_describe({})`: active Target, providers, compatibility, missing bindings, tools and schemas. Bindings alone are not authority or a validated plan. |
| Prepare | `dualloop_design({preset,draft,experimentPath,context})`: inspect missing inputs and the resolved contract. This is read-only. |
| Configure | Save the inspected contract with authorized host tools. Set `duo-contract.config.experiment` and `duo-journal.config.root`; attach matching work providers. The starter supplies this wiring for its task. |
| Plan | `dualloop_plan({view:"summary"})`: check target, providers, evidence mode, limits, permissions, history, `planDigest` and `runId`. The full view has complete details. |
| Execute | `dualloop_run({planDigest})` within owner authority. A digest never grants permission. Changed inputs require a new plan. |
| Retrieve | `dualloop_status({runId})`, `dualloop_report({runId,view:"summary"})`, `dualloop_budget_status({runId})`. These read retained records without model work. Save the report through host tools. |

`dualloop_discover` is the retained execution-composition view requiring a valid
plan; start onboarding with `dualloop_describe`.

## Prepare the missing pieces

A draft needs an id, `target:{kind,path}` and an objective:
`{evaluatorId,version,dataId,metric,direction,weights}`. Live schemas give the full
contract. Optimize also needs an explicit budget. Presets supply lifecycle
defaults, never the user's goal, tests or authority:

- `evaluate`: measure the original, no Generator.
- `optimize-basic`: generate and select with available Fast evidence.
- `optimize-dual`: requires applicable additional evidence.
- `optimize-auto`: records the available mode and any fallback in plan and result.

If the user does not know what to change, inspect authorized project evidence
first, then use design to identify missing decisions. Ask about material tradeoffs
with concrete examples. Bring an evaluator, find a visible compatible one, wrap
existing tests, or compose measurement functions. Check known correct/incorrect
controls before search. Do not invent answer keys.

[Current support](./CURRENT_STATUS.md) separates built-in and adapter-dependent
Targets. Model Generator/Executor bindings currently support persona/prompt;
configuration and custom Targets need matching work providers. Inspect
`targetCompatibility` in discovery and `providers.targetCompatibility` in plans.
Legacy undeclared support is UNKNOWN.

## Interpret and continue

A completed run is not necessarily an independently confirmed improvement.
Report the selected candidate, original comparison, actual evidence, modes,
limitations, stop reason and known/unknown costs. Basic has no independent Slow
evidence. Planned dual with no actual acquisition reports NOT_OBSERVED.
Unpromoted candidates do not have later-stage scores.

Warm start creates a **new experiment** with screened history:
`warmStart:{runIds:[...]}`. Recovery continues the **same run** at a supported
settled checkpoint using the original `planDigest` and
`resumeFrom:status.checkpoint.digest`. Neither restores money nor extends deadlines.
Final evidence cannot enter search. See [API reference](./AGENT_REFERENCE.md) for
compatibility, constraints and recovery boundaries.

Replace supported components through ordinary Cordis rows, then inspect a new
plan. Missing providers retract dependent execution tools. The
[local examples](./examples/product/README.md) cover custom Targets, BYO Evaluator,
history replacement and warm start. Complete contracts are in
[PROVIDERS.md](./PROVIDERS.md), modes in [EVIDENCE_STRATEGY.md](./EVIDENCE_STRATEGY.md).

## Authority and errors

Reuse existing owner authorization; examples grant none. Native budget covers DUO
inner operations. Calling Agent inference and local computing resources are
separate. For local CNY0 work keep paid permission false and maxCostCny zero;
omit the optional positive-only cumulative cap.

Errors include cause, recoverability, nextAction, costState and sideEffectState.
Unknown cost requires retained-evidence inspection, not inferred zero or retry.
Reconciliation accepts observed staged receipts; it cannot create usage evidence.
The host enforces actual access; providers are trusted in-process code. Adoption
needs separate owner authority. [SECURITY.md](./SECURITY.md) defines this boundary.
