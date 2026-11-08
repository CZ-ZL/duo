# Lightweight typed decisions

This optional plugin answers several small questions about one supplied state.
It can run independently of DUO optimization: no Target, dataset, candidate,
Generator or Controller is required. For example, a caller can ask which support
queue owns a message, how urgent it is, and whether human help was requested.
The caller then uses the returned values in its own explicit branch rules.
The plugin does not execute those actions or change DUO promotion policy.

### Public tools and input

Load `/decisions` (a function-backed provider) or `/model-decisions` (the existing
native DSH model backend), together with `/decision-tools`. Both providers own
`duoDecisions`; replace one with the other using ordinary Cordis lifecycle.
The tools are absent when their provider is absent.

- `dualloop_decision_describe({})`: provider/version, question types, immutable
  owner allowance, missing permissions, ledger status and qualification.
- `dualloop_decide({requestId,state,questions})`: one batch, with typed answers,
  unknowns, execution status, CNY cost and measured backend latency.
- `dualloop_decision_status({requestId?})`: read retained result and allowance;
  no model work. The result includes raw diagnostic output and receipt paths.

Input example (a configuration example, not a model result):

```json
{
  "requestId": "ticket-001",
  "state": {"message": "An urgent duplicate charge; please connect me to a person today."},
  "questions": {
    "route": {
      "type": "choice",
      "instructions": "Which support queue owns this ticket?",
      "criteria": {"billing": "Charges and invoices", "general": "Other issues"}
    },
    "urgency": {
      "type": "score",
      "instructions": "How urgent is this request?",
      "criteria": ["Routine inquiry", "Needs attention today"]
    },
    "needs_human": {
      "type": "boolean",
      "instructions": "Does the message explicitly request a person?"
    }
  }
}
```

`state` is text, an object or an array. A batch has 1–16 questions and at most
65,536 JSON bytes; the model configuration can impose a tighter bound.
`choice` returns an exact key from 2–32 described options. `score` returns a
zero-based integer index into 2–10 ordered, explicitly described levels.
`boolean` returns true or false. Any question can instead return null for unknown.
The service wraps each answer as `{type,status,value}`. It rejects missing IDs,
extra answers, invented options and out-of-range scores; it never coerces prose
or a model's confidence into a usable decision. `status:completed` means the
batch completed, not that its judgments are correct; check `allAnswered` and
each answer's status before applying a caller rule.

### Local installed-package walkthrough

Prerequisites: Node 24+, a supported installed DSH and the current DUO package
with the decision exports. Obtain the package using the [Quickstart](../QUICKSTART.md).
These exports are in the local 0.6.3 candidate; older releases may not contain them.
`DUO_PACKAGE` is the absolute path to the installed `@dual-loop/dsh-plugin`
directory, `DSH_PACKAGE` to the installed `@deepseek-ai/dsh` directory.
`DECISION_WORK` must be a new absolute directory owned by the caller.

```bash
node "$DUO_PACKAGE/examples/decisions/prepare.mjs" --root "$DECISION_WORK"
DSH_HOME="$DECISION_WORK/dsh-home" DSH_TELEMETRY_DISABLED=1 node "$DSH_PACKAGE/lib/bin.js" --profile decisions --patch "$DECISION_WORK/describe.patch.json"
DSH_HOME="$DECISION_WORK/dsh-home" DSH_TELEMETRY_DISABLED=1 node "$DSH_PACKAGE/lib/bin.js" --profile decisions --patch "$DECISION_WORK/decide.patch.json"
DSH_HOME="$DECISION_WORK/dsh-home" DSH_TELEMETRY_DISABLED=1 node "$DSH_PACKAGE/lib/bin.js" --profile decisions --patch "$DECISION_WORK/status.patch.json"
cat "$DECISION_WORK/decide-response.json"
```

The preparer stages the installed package files in an isolated profile so DSH
can resolve host peers. It installs no dependencies, imports no private profile,
and dispatches no work. The profile loads just the decision services and the
existing public tool bridge. The [local provider](../examples/decisions/local-provider.js)
uses deterministic keyword checks for the three example question IDs, with CNY0
and no model/network permission. It checks wiring, not general judgment ability.
Changing questions requires a matching provider, such as the model backend.
Responses are written once; repeat reads with `cat`. To invoke the status tool
again, choose a new response filename in its patch. Replaying an identical
`dualloop_decide` request ID returns the retained result with `reused:true`;
its cost is the historical request fee, not a second charge.

### Native model backend and replacement

In an existing model-enabled DSH profile, load `/model-decisions` with
`config: {model, authorization}` and `/decision-tools`. Reuse the host's
`agents`, `llm`, `systemPrompt`, `tools`, sessions, session projections and
agent-loop services plus its configured model adapter. The packaged
[model walkthrough](../QUICKSTART.md#real-task-starter) documents the supported
host model setup; a decision-only profile does not need its Target, dataset,
Generator, Executor or Evaluator. There is no new API SDK or registry.

The `model` object has these required fields:

| Field | Source / meaning |
|---|---|
| `provider`, `model` | An actual route in the host's configured LLM adapter |
| `artifactRoot` | Caller-owned directory for private request/usage receipts |
| `evidenceKind` | `model` for real inference; `fixture` only for scripted tests |
| `currency`, `reservationCny` | `CNY` and a positive per-request upper envelope |
| `maxTokens`, `maxInputBytes`, `timeoutMs` | Positive integer output/input/time limits |
| `pricing` | Frozen owner-reviewed tariff with `id`, `currency:CNY`, `inputCnyPerMillion`, `cacheReadCnyPerMillion`, `outputCnyPerMillion` |

No `datasetPath` is required. `reservationCny` must cover the configured input
byte/token envelope and output cap at the frozen tariff; invalid settings fail
before inference. Use current rates applicable to the selected provider;
no example price is a new spending authorization. The route must expose usage
compatible with the existing DSH accounting contract (uncached input, cache-read,
output and total tokens). Unknown usage is not treated as free.

The owner-controlled `authorization` object is
`{id,currency:'CNY',maxCostCny,maxCalls,paid,network}`. Use an explicitly authorized
stable allowance ID, total CNY cap and call limit. Model routes need the applicable
paid/network permissions. Load `/journal` with a caller-owned `root` and `/budget`
if those services are absent. Reuse the same journal root and allowance ID across
restarts; changing either is not permission to reset spending. `dualloop_decide`
arguments cannot grant or enlarge this allowance.

The model plugin performs one short native request for all questions, with no
action tools and no automatic retries. Configure adapter-level retries off as
well. It retains usage, raw output, source/configuration hashes and latency even
when the answer is invalid. This is batched generative inference, **not** a claim
of independently parallel question heads or Jev model equivalence. Choice,
ordinal score and boolean are runtime types; they are not calibrated probabilities.
Qualification stays `NOT_CALIBRATED` until a separate labeled evaluation measures
correctness, unknown/error rates, latency and cost. Synthetic test fees are not
real API spending; caller inference and local computing are outside this ledger.

To bring a different backend, load the default `/decisions` export using
`ctx.plugin(FunctionDecisions, {descriptor, authorization, judge})`. The descriptor
has `id`, `version`, `configDigest`, `currency:CNY`, `reservationCny`, explicit
`permissions:{paid,network,externalSideEffects:false}` and an honest evidence kind.
`judge({state,questions,signal,identity})` returns
`{answers,currency:'CNY',costCny,costEvidence?,error?}`; `answers` maps question IDs
to raw allowed values or null. The callback is trusted code and must honor its
own request/side-effect bounds. The native model implementation bounds one
request; custom backends may do more, and `maxCalls` counts batches, not hidden
nested requests. Loading arbitrary third-party callbacks is not a sandbox.
Calling `createModelDecisionJudge(...).judge(...)` directly bypasses service
reservations; normal Agent use goes through the provider and public tools.

A thrown callback or unknown cost blocks further admission until actual evidence
is reconciled. Known overruns preserve the full observed fee and block later work.
Cancellation retains late usage and suppresses actionable answers. No blind retry
is allowed for a pending or interrupted request. Completed identical requests
can be read again; request IDs cannot be reused for different input. Configuration
changes do not reset the ledger. A process interrupted before storing a result
requires receipt inspection; there is no automatic decision-work resume.
Raw state/output may contain sensitive caller data; keep the journal and receipt
directory private. This layer grants no deployment, tool-use or candidate-adoption
authority and does not turn one judgment into independent Slow evidence.

[Provider index](../PROVIDERS.md) · [Public tools](../AGENT_REFERENCE.md)
