# Changelog

## 0.6.0 — Slow evidence strategy and product repairs

Explicit evaluate/basic/dual/auto presets; source metadata, bounded acquisition
and transparent result/history semantics. Retained cumulative allowances, atomic
Journal initialization and one actual terminal selection with runner-up handling.
Readable product formatting, typed strategy contracts and bilingual README.
See RELEASE_NOTES_v0.6.0.md and docs/slow-evidence-strategy/ACCEPTANCE.json for
scope and current verification. Historical results below remain unchanged.

## 0.5.0 — Product Foundation

- Unify capability discovery, kind schemas and generated current support. Persona
  is supported; the bounded fetch configuration Target is explicitly partial.
- Make content identity, historical snapshot validation and safe Delta projection
  Target-owned. Configuration history now reaches candidate generation; a custom
  content Target runs through the same core without persona/config fields.
- Add evaluate/optimize presets to the existing design tool and shared structured
  errors with cause, action, recoverability and cost/effect uncertainty.
- Default bundle waits for work providers. Retain, but disable, the historical
  fixture; existing legacy exports remain. Deferred runtime replaces duplicate
  default controller wiring, not the execution engine.
- Ship a small public `duo` CLI and local evaluate, optimize, BYO evaluator,
  replacement, warm-start and custom Target examples. All calls use actual DSH
  ToolRuntime; no private profile, research script or Python runtime is needed.
- Extend release CI with real tarball installation and public package acceptance.
  Research history remains separate; no new paid model requests or method tests.

Migration: old frozen plans/checkpoints do not authorize a new provider graph.
Inspect and re-plan after upgrading. Custom history requires Target-owned hooks;
legacy Target providers without them execute but do not import warm history.
Use an explicit fixture binding if you depended on the old default demo. Replace
a Cordis module by disabling its old row and inserting the replacement; changing
a row name in an id-only patch does not replace a module.


## 0.4.0 — config target and fetch evaluation harness

Released 2026-09-14, on top of the 0.3.0 experimental source preview (`df8f3a2`).

- Add the `dsh-plugin-config` target kind: `native/config-target.js` (isolated
  `@deepseek-ai/dsh-web-fetch-http` overlay where only integer `maxBodyChars`
  in `[50000,200000]` may vary; other fetch defaults and the persona are
  locked; parent and version are validated) and `native/config-generator.js`
  (real model-generated `plugin-config-replace-v1` config deltas reusing the
  existing history-feedback/single-call mechanism). `contract.js` accepts the
  new kind; `controller.js` deduplicates candidates on persona+config identity
  (persona-only identity is unchanged). Both modules ship in the npm `files`
  list and are publicly exported; new tests `config-target.test.js` and
  `fetch-evaluation.test.js`.
- Add research examples under `examples/native/`: `fetch-config-evaluation.js`
  (real DSH fetch executor + exact evaluator + package-level model/cost
  guards), `fetch-required-tool.js` (optional fix: named `web_fetch`
  `tool_choice` on the first step of non-thinking requests),
  `fetch-required-tool.test.js` and `FETCH_CONFIG.md`.
- Real 4-request run (package `config-search-20260914`, 2026-09-13/14, 52
  requests / ¥2 authorized, settled at 4 requests / ¥0.03277904): real
  generation works and produced 2 config candidates, but the first candidate
  never called `web_fetch` (0 tool calls, all answers UNKNOWN) — an
  execution-precondition failure. The package was stopped per the freeze
  rules. The frozen baseline score remains 0/18 and must not be restated.
- Execution-precondition verification PASSED (`required-tool-verify-20260914`,
  protocol v2): the named `tool_choice` fix validated by real API — 2 requests
  / ¥0.03234696; dl-0001 (`maxBodyChars=120000`) entered one real `readBody`
  and scored VALID 14/18 on the 18-task dev union under the frozen exact
  evaluator.
- Corrected same-harness B0/B1/B2 config-search comparison COMPLETED
  (`config-search-corrected-20260914`, protocol v1): 44 requests /
  ¥0.18554908, no stops, all usage known. B1 generated five 18/18 dev-union
  candidates (new-harness baseline dev row 10/18); on the once-consumed frozen
  12-question diagnostic final, baseline(100000) 8/12, B1 best-dev
  dl-0002(180000) 12/12, B2 dl-0001(150000) 12/12. Dual-loop and single-loop
  TIED (both selected 12/12; B1 17 requests vs B2 21): the formal
  no-advantage conclusion is unchanged and gains same-direction evidence. The
  root-cause goal is CLOSED with per-component classification (execution
  precondition root-caused and fixed; search generates genuinely better
  candidates on this diagnostic; no selection error observed; Slow-rejection
  accuracy and 150000-vs-180000 ranking remain open due to ceiling ties and
  single-run noise). Caveats: single execution per object, large answer-side
  nondeterminism, final questions from the same previously-public source
  document as dev, ceiling ties, `maxBodyChars` knob only. The diagnostic
  final (`config-diagnostic-final-twelve-v1`) is now consumed and must never
  be presented as unevaluated.

Recorded decisions:

- `fetch-required-tool` stays an opt-in research example and is NOT promoted
  into the default npm bundle. Its promotion precondition was met on
  2026-09-14 (the 2-request real validation passed), but promotion remains a
  separate maintainer decision.
- The frozen exact evaluator is unchanged (no whitespace trimming). If a
  whitespace-tolerant variant is ever needed it must be a new versioned
  evaluator, calibrated before use, never mixed with old scores.

## Unreleased — GitHub publication preparation

- Add aggregate experimental results, retained failure explanations and source
  hashes for the formal comparison, shadow final, selection audit and completed
  configuration headroom diagnostic; no raw private run archive is included.
- Report bounded worker startup stderr on isolated execution errors and fail the
  product gate early when its required sandbox is unavailable; scoring and
  isolation rules are unchanged.
- Limit CI evidence upload to logs, reports and the tarball, with a bounded,
  cancellable upload step instead of traversing temporary dependency trees.
- Verify actual offline tarball installation and automatic bundle registration
  in a fresh profile, plus a fresh packaged demo using existing host dependencies.
- Preserve the native 0.3.0 runtime and persona target scope.
- Include the declared MIT license in the source and npm tarball.
- Add a default-package offline demo through the real DSH CLI and public tools.
- Clarify that a model-driven Calling Agent can incur costs even with free work providers.
- Distinguish package-local documentation from examples in the source checkout.
- Retain complete product-gate logs and inspect the actual packed files and exports.
- Label historical archive-dependent tests explicitly; retain their assertions
  and full-suite failures when the archive is absent.
- Add a self-contained legacy wiring control and a GitHub Actions workflow.
- Include the existing exact-decimal model-accounting correction: sum tariff
  amounts before rounding to ledger units and preserve unknown amounts outside
  the exact ledger range. Retain the eight regression tests; do not recalculate
  or overwrite historical experiment fees.

Fresh registry installation and the complete product workflow passed on GitHub
Ubuntu 22.04 at `df8f3a2` (run 34764675244); preceding failures remain recorded.
These changes do not establish method superiority, expand supported Target kinds,
publish a formal release, or change any historical experimental conclusion.
