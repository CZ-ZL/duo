# Native warm-start functional example

Run the existing offline acceptance entry using an already installed DSH package:

```bash
python3 scripts/product/verify_dsh_native.py \
  --dsh-package /absolute/path/to/node_modules/@deepseek-ai/dsh \
  --output /absolute/path/to/new-empty-verification-output
```

The `duo-native-warm-start` profile uses
[`warm-start-experiment.json`](./warm-start-experiment.json), the existing native
bundle and [`fixture-provider.js`](./fixture-provider.js). It supplies CNY zero-cost
generation/execution/evaluation with `observeWarmStart:true`, no network or tools.
The verifier packs locally without scripts or dependency installation and loads
an isolated DSH profile. It never edits a user profile or original contract.

The host app performs this public tool sequence:

1. `dualloop_describe`, `dualloop_plan`, `dualloop_run` and read/report the initial
   two-generation experiment. Save its run ID; no prior-run IDs are fabricated.
2. In the isolated contract copy, change ID to `warm-start-followup-control` and
   set `warmStart.runIds` to that actual ID. Inspect a plan with the default
   fixture exclusion, then explicitly opt into `fixturePolicy:"ideas_only"`.
3. Inspect the new plan, run with its exact digest, read status and report. The
   fixture Generator writes consumed source IDs into its candidate hypothesis.
4. Verify fresh baseline measurements, distinct ledgers, immutable prior Journal
   bytes and original Target, historical input digests, and no new work on reread.

Artifacts in `duo-native-warm-start/` include `calls.json`, `plan.json`,
`excluded-fixture-plan.json`, `warm-plan.json`, `warm-result.json`,
`warm-status.json`, `warm-report.json`, `receipt.json` and both native SQLite runs
under `experiment-run/`.

This checks actual DSH tooling and native history consumption with explicit
fixtures. It is not an independent Calling Agent, real-model optimization,
verified quality improvement or a source of transferable budget. The measured
positive fixture comparison remains `insufficient_evidence` for the warm run
because independent final provenance is not established.

## Replace history ordering

In an authorized isolated profile, configure the existing `/history-feedback`
provider with `historyOrder: recent_failures_first` (default: `balanced`). The
policy is visible in `providers.policies.duoFeedback` and `warmStart.selector`.
Changing it invalidates the inspected plan and conservatively changes declared
history compatibility; it does not make old measurements current measurements.

For your own ordering, extend the public Feedback provider in a local plugin:

```js
import HistoryFeedback from '@dual-loop/dsh-plugin/history-feedback'
export default class FailureFirst extends HistoryFeedback {
  describe() {
    return {...super.describe(), id: 'my-failure-first', version: '1'}
  }
  orderHistory(records) {
    return records.map((record, index) => ({record, index}))
      .sort((a, b) => Number(b.record.role === 'failure') - Number(a.record.role === 'failure'))
      .map(row => row.index)
  }
}
```

Disable the old Feedback row and insert this plugin under a new row ID; the
controller is unchanged.
`orderHistory` is synchronous and returns unique indices into its input, optionally
a subset. It receives copies of already screened search records, with fixture and
version limits already applied and final/raw outputs removed. Mutating those copies
cannot alter the selected records. Returning invalid or duplicate indices refuses
the plan as `DUO_HISTORY_SELECTION_INVALID`. An empty selection gives a cold start.
Current record/byte caps are applied after ordering, with omission reasons retained.
This trusted local plugin is a policy hook, not a sandbox or permission to read
other files, make model calls, change eligibility, import costs or increase limits.
