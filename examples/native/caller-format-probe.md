# Diagnose Caller response format without executing returned tools

`scripts/run_caller_format_probe.py` stages a named DSH profile for one fixed pair
of responses. It reuses the saved system/messages/tool schemas from an actual
Caller request. `json_on` requests `response_format: {type: json_object}`;
`json_off` omits that field. The recorded base request body must match in both
arms. Model, token limit and context remain fixed; no intermediate response is
fed to the other arm.

This is a response-format diagnostic, not an independent Caller session or a
DUO optimization. The profile has no registered model tools and only records
returned tool blocks. It never executes text or tool calls. A single pair cannot
establish a reliable causal effect; response sampling and fixed order remain
limitations. Offline arm differences are deliberately scripted controls.

The fixed allowance is at most **2 model requests / CNY0.50**, at most CNY0.25
reserved before each request, 70,000 bytes of assembled input and 2,048 output
tokens. All diagnostic calls count against the existing batch's Caller quota.
The entry reconciles original request costs, native settlement receipts, the
terminal result and the parent summary before preparation/launch. It rejects
unknown cost, changed receipts, another batch or insufficient remaining quota.
This is one reviewed slice of that batch, not a reset of its original allowance.

```sh
python3 scripts/run_caller_format_probe.py --mode offline --dsh-package /absolute/path/to/cached/@deepseek-ai/dsh --parent-run /path/to/terminal-parent-run --batch-authorization /path/to/parent-authorization.json --batch-summary /path/to/current-parent-summary.json --output runs/new-offline-format-check

# Same inputs, real adapter staging only; still zero model requests:
python3 scripts/run_caller_format_probe.py --mode prepare-live --dsh-package /absolute/path/to/cached/@deepseek-ai/dsh --parent-run /path/to/terminal-parent-run --batch-authorization /path/to/parent-authorization.json --batch-summary /path/to/current-parent-summary.json --pricing /path/to/fresh-official-cny.json --output runs/new-prepared-format-check

# After separate approval of this diagnostic purpose within the parent batch:
python3 scripts/run_caller_format_probe.py --mode execute --output runs/new-prepared-format-check --authorization /path/to/approved-probe-slice.json
```

The existing parent authorization is insufficient for the new diagnostic scope.
Bind the actual approval to the new scope, plan/manifest digests and the same
parent batch identity. The generated template is not authority. Fresh UTC-date
pricing, input/module manifests, existing execution claims and terminal replay
checks use the existing native launcher. No automatic provider retry is loaded.

`--fixture-missing-usage` is an offline control: it must stop after one synthetic
response with unknown synthetic cost. It never changes real parent usage or
fees. Fixture overrides are rejected during real preparation. Missing real
usage, abnormal provider finish or exhausted limits stop before the next arm.

Read `requests.json`, `request-formats.json`, `result.json`, `total-budget.json`
and `total-cost-receipts.json`. `httpAccepted: null` means the extension has no
acceptance observation, not HTTP failure; the omitted-format arm has no field
acceptance callback. Model usage and finish remain separately recorded.

The result reports this slice and the cumulative parent-plus-slice figures;
unknown real cost remains unknown. No original receipt is rewritten. Before any
later task, use all accumulated batch receipts, including this slice, to derive
the remaining total/Caller/inner quota. Never prepare a fresh full-allowance run
from the old parent-only summary. The helper is not a general multi-attempt
budget scheduler.
