# DUO v0.4.0 — config target and fetch evaluation harness

DUO v0.4.0 is the 0.3.0 experimental source preview PLUS the configuration-target
work landed since: a new `dsh-plugin-config` target kind, a real model-generated
config-delta generator, and a fetch evaluation harness with research examples.
DUO is a DSH-native Dual-Loop Autonomous Optimization plugin: a JavaScript
(Cordis) plugin shell published as the npm package `@dual-loop/dsh-plugin` 0.4.0,
plus a Python protocol core used for source verification and explicit legacy
compatibility.

DUO evaluates and optimizes an existing persona/system prompt — and now a bounded
fetch-plugin configuration — inside the DeepSeek Harness. A Calling Agent supplies
a target, measurable objective, versioned evaluators and authorized resources; DUO
returns candidate overlays, Fast/Slow/final evidence, decisions, history and costs.

## New since the 0.3.0 preview

- **`dsh-plugin-config` target kind.** `native/config-target.js` implements an
  isolated `@deepseek-ai/dsh-web-fetch-http` overlay where only integer
  `maxBodyChars` in `[50000,200000]` may vary; other fetch defaults and the
  persona are locked, and parent/version are validated. `native/config-generator.js`
  emits real model-generated `plugin-config-replace-v1` config deltas, reusing the
  existing history-feedback/single-call mechanism. `contract.js` accepts the new
  kind; `controller.js` deduplicates candidates on persona+config identity
  (persona-only identity is unchanged). Both modules ship in the npm `files` list
  and are publicly exported.
- **Fetch evaluation harness (research examples, `examples/native/`).**
  `fetch-config-evaluation.js` (real DSH fetch executor + exact evaluator +
  package-level model/cost guards), `fetch-required-tool.js` (optional fix:
  named `web_fetch` `tool_choice` on the first step of non-thinking requests),
  `fetch-required-tool.test.js` and `FETCH_CONFIG.md`.
- **First real config-search run.** Package `config-search-20260914`
  (2026-09-13/14, 52 requests / ¥2 authorized, settled at 4 requests /
  ¥0.03277904): real generation works and produced 2 config candidates, but the
  first candidate never called `web_fetch` (0 tool calls, all answers UNKNOWN) —
  an execution-precondition failure. The package was stopped per the freeze
  rules. The frozen baseline score remains 0/18 and must not be restated.
  Overall root-cause classification remains INSUFFICIENT_EVIDENCE; the formal
  conclusion stands: no proven quality/cost advantage over a reasonable single
  loop. A follow-up 2-request / ¥0.90 verification (`maxBodyChars=120000` plus
  the named `tool_choice`) is prepared but not yet executed.

## Recorded decisions

- `fetch-required-tool` stays an opt-in research example and is NOT promoted into
  the default npm bundle in this release. Its precondition was met on 2026-09-14:
  the 2-request real validation passed (package `required-tool-verify-20260914`,
  protocol v2), but promotion remains a separate maintainer decision.
- The frozen exact evaluator is unchanged (no whitespace trimming). If a
  whitespace-tolerant variant is ever needed it must be a new versioned
  evaluator, calibrated before use, never mixed with old scores.

## Package

- npm package: `@dual-loop/dsh-plugin` version `0.4.0`
- Tarball: `dual-loop-dsh-plugin-0.4.0.tgz` (52 members), produced and verified
  by the release gate on 2026-09-14
  (`runs/root-cause-diagnostic-20260913/release-gate-v040-20260914`, overall PASS:
  290 native tests, 451 Python product tests with 86 research deselected, 21 DSH
  host profiles, 0 model requests / CNY 0)
- SHA256: `f670e0ef2a71ac49c88d5c8e4b995aaf95b9f95f146629f0fc33cae88cf38738`
  — verified by the gate's package check on the actual tarball bytes
- Verified environment: Linux, Node 24.14.1, Python 3.12, DSH 0.1.2-rc.1,
  Cordis 4.0.2

Note: a same-named 0.3.0 tarball with different content exists only as a
historical artifact; the published release is 0.4.0.

## Verification summary

All numbers below are from the 2026-09-14 release gate run (overall PASS; log
and report retained under `runs/root-cause-diagnostic-20260913/release-gate-v040-20260914/`):

- 290 native (Node) tests passed
- 451 Python product tests passed, 86 historical research tests deselected
  (they require separately reviewed archives)
- 21 DSH CLI host profiles PASS
- Earlier 0.3.0 gate evidence (GitHub Actions run 34764675244 at `df8f3a2`,
  offline tarball installation, registry dependency installation,
  exact-decimal accounting regression tests) is recorded in
  `RELEASE_EVIDENCE.json` and `PUBLICATION_EVIDENCE.json` and still applies to
  the retained 0.3.0 runtime.

## Honest caveats

- **No method superiority shown.** The completed formal comparison did not
  establish a quality or API-cost advantage over a reasonable single-loop
  baseline. All optimization arms retained the original persona; retaining
  the original is a valid result. The new config-search run adds no positive
  evidence; root-cause classification remains INSUFFICIENT_EVIDENCE.
  See `EXPERIMENTS.md`.
- **Experimental software.** This is an engineering-acceptance preview, not
  the project's formal 1.0.0 release; no npm registry publication is part of
  this delivery.
- **Verified boundary.** Linux only. Windows/macOS and TypeScript semantic
  compilation are not verified.
- **Repository status.** The repository was PRIVATE at the time these notes
  were written; the GitHub CI run links recorded in the evidence files become
  accessible only after the maintainer flips visibility.
- **Open research goal.** The first real config search failed on an execution
  precondition (candidate never fetched); the 2-request verification is
  prepared but unexecuted, and candidate final evaluation remains unrun. The
  broader root-cause goal is open.
- A model-driven Calling Agent can incur costs even with free work providers.
  Example budgets do not authorize spending. Read `dsh-plugin/SECURITY.md`
  before handling real resources.

## Getting started

See `README.md` for the no-model packaged demo, `dsh-plugin/README.md` for
installation and configuration, `examples/native/FETCH_CONFIG.md` for the
config target and fetch harness, `TESTING.md` for the offline product gate,
and `RELEASING.md` for publication requirements.
