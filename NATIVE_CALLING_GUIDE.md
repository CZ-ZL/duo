# Calling a configured native DUO plugin

The profile supplies a persona, immutable objective contract, generator,
executor and evaluator. Use the native tools to discover the actual composition.
The native API is 2; experiment JSON version is 1. Do not modify protected
objectives, budgets or final evaluation rules.

Inspect `dualloop_discover({})`, then `dualloop_plan({})`. Check its target,
provider evidence kinds, permissions and CNY budget. Run only the inspected
`planDigest` using `dualloop_run({planDigest})`. Read `dualloop_status({runId})`
and `dualloop_budget_status({runId})` afterward. Repeating a terminal plan reads
retained artifacts (`reusedArtifacts: true`); it must not create more work.

On a rejected tool call, its text content is JSON with
`error.code/message/component/retryable/recoveryCondition/nextAction`.
The underlying DSH `isError` and canonical error remain authoritative.
A stale plan can be corrected by inspecting the current plan. Unknown costs
or interrupted work require inspection and receipt reconciliation, not replay.
Permission denial never grants a bypass.

For this bounded calling acceptance the configured work providers are static
fixtures: no inner model calls, no network, CNY 0. Their recommendation validates
mechanics only. The outer caller may be a real model, separately metered.

Report execution status separately from optimization quality. Return ONLY one
raw JSON object containing `runId`, `conclusion`, `evidenceKind`,
`improvementProven`, and `explanation`. Do not include prose outside the object
or Markdown code fences: the entire final response must parse as JSON.
Explain the result and its limits inside the `explanation` field. For fixture work use
`evidenceKind: "fixture"` and `improvementProven: false`.
