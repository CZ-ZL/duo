# Bounded fetch configuration Target (experimental)

The public `@dual-loop/dsh-plugin/config-target` provider implements `duoTarget` for an isolated `@deepseek-ai/dsh-web-fetch-http` configuration. Replace the existing `duo-target` row with that module and use contract target `{ "kind": "dsh-plugin-config", "path": "/absolute/path/to/target.json" }`. The default bundle continues to select the persona provider.

The target JSON has exactly `plugin`, `persona`, and `config`. `plugin` is `@deepseek-ai/dsh-web-fetch-http`; `persona` is fixed text. `config` contains `maxBodyChars`, `maxResponseBytes`, `timeoutMs`, `maxRedirects`, and `userAgent`. Only integer `maxBodyChars` in `[50000,200000]` may vary; the other fields retain the pinned host defaults (5000000, 30000, 5, and `deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)`). No file is modified or candidate adopted by this adapter.

Use `@dual-loop/dsh-plugin/config-generator` with the existing model configuration contract and `@dual-loop/dsh-plugin/history-feedback`. Generation emits a parent-bound `plugin-config-replace-v1` Delta. Persona and configuration both participate in duplicate identity. A compatible Executor and Evaluator are still required; the persona-only executor is not compatible.

`fetch-config-evaluation.js` is a source-repository diagnostic example with a native fetch Executor and exact field Evaluator. It uses the real DSH Agent loop, web tool, and HTTP body retention code. Source transport replays an explicitly pinned local document; public HTTP retrieval is not established. Required host packages include `dsh-web`, `dsh-web-fetch-http` and `dsh-tool-web`. The example is not in the default npm bundle, and its paid entry requires isolated profiles, frozen datasets and a bounded authorization ledger.

The first real diagnostic stopped after a candidate answered without fetching. Merely exposing the tool is insufficient to establish that its configuration was exercised. `fetch-required-tool.js` is an optional prospective profile plugin using the official non-thinking `tool_choice` field; it has offline wire/host verification only and is **not** enabled in the frozen failed run. Existing URL restrictions and a synchronous single-read guard remain in force.

The exact evaluator also requires trimmed declarations. Preserve its original results when an output includes source indentation; any later normalization or revised response contract needs a distinct protocol and evaluator identity where applicable.

## Status and decisions (2026-09-14)

- `fetch-required-tool.js` stays an opt-in research example and is NOT promoted into the default npm bundle. Its promotion precondition was met later on 2026-09-14: the 2-request / ¥0.03234696 real validation (`required-tool-verify-20260914`, `maxBodyChars=120000` + named `web_fetch` `tool_choice`) PASSED — dl-0001 entered one real `readBody` and scored VALID 14/18 on the 18-task dev union under the frozen exact evaluator. Promotion into the default bundle remains a separate maintainer decision.
- The frozen exact evaluator is unchanged (no whitespace trimming). If a whitespace-tolerant variant is ever needed it must be a new versioned evaluator, calibrated before use, never mixed with old scores.
