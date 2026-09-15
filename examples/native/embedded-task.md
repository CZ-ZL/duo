# Use DUO as an Agent subtask

The caller-owned [`embedded-task.js`](./embedded-task.js) plugin registers `duo_task`
in the existing DSH ToolRuntime. Load it with
[`embedded-profile.patch.yml`](./embedded-profile.patch.yml) after the native DUO
bundle and your authorized providers. It reads no private DUO services or source
files. No additional model, process, scheduler or configuration writer is added.

Your surrounding Agent should:

1. Prepare the target/objectives/providers through the public guide if needed.
   Inspect `dualloop_plan`; verify its current permissions, limits and input digest.
2. Call `duo_task({planDigest})`. This dispatches `dualloop_run` once and then
   `dualloop_report` once. The native controller owns all work and its ledger.
3. Consume `run.status`, `run.conclusion`, `run.improvementProven`, `report.budget`,
   candidate stages and diagnostics in the surrounding task. `deliveryState:COMPLETE`
   means both tool responses arrived; it is not a claim of passed constraints,
   an improved candidate or a successful run. Inspect the nested run status.

The same consumer works with the configured evaluation-only, optimization or
warm-start contract. For a no-generator example, use the existing
[`evaluation-profile.patch.yml`](./evaluation-profile.patch.yml) alongside this patch.
Native standalone plan/run/report remain available without the consumer.

Nested calls retain the calling Agent, root call identity, opaque parent token and
abort signal. Existing child-tool restrictions and guards still apply: allowing
only the outer tool does not authorize its children. No denial is bypassed and no
failed operation is automatically retried. Deferred contexts and terminal markers
are propagated through DSH. `TERMINAL_CHILD` means the inner tool concluded the
turn and no report call followed. `REPORT_UNAVAILABLE` preserves the run outcome
and error so the Agent can retrieve that run's report without redoing work.

The existing offline verifier runs `duo-native-embedded` and
`duo-native-embedded-denied` profiles. Each creates an actual DSH Agent, supplies
the public guide and uses three bounded scripted adapter responses. The Agent
inspects the plan, invokes the subtask and consumes its result; the denial control
shows an Agent-scoped guard still prevents nested work before any ledger is opened.
Native core evaluation/ledger/observer are real code; providers and Agent responses
are explicit free fixtures. They do not verify model autonomy or live quality.

Artifacts include `agent-session.json`, `adapter-requests.json`,
`agent-tool-calls.json`, `agent-consumed-result.json`, `embedded-outcome.json`
(success case), `plan.json`, `receipt.json` and the authoritative native Journal.
All Caller usage is labelled as fixture metadata. For a real surrounding Agent,
account for its requests and nested generation/execution/evaluation in the overall
authorized experiment allowance; this tool grants no extra Caller budget.
