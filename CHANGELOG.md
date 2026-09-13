# Changelog

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
  Overall root-cause classification remains INSUFFICIENT_EVIDENCE; the formal
  conclusion stands: no proven quality/cost advantage over a reasonable
  single loop.
- A follow-up 2-request / ¥0.90 verification (`maxBodyChars=120000` plus the
  named `tool_choice`) is prepared but not yet executed.

Recorded decisions:

- `fetch-required-tool` stays an opt-in research example and is NOT promoted
  into the default npm bundle until the 2-request real validation passes.
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
