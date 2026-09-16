# DUO 0.6.2 — Target/provider compatibility

Status: RELEASED as a developer-preview prerelease. [Download](https://github.com/CZ-ZL/duo/releases/tag/v0.6.2)
the fixed tarball and SHA256SUMS; follow the [installation guide](../../../dsh-plugin/README.md).
No npm publication.

A custom or config Target could previously be paired with a persona-only work
provider without a Target-kind rejection during planning. Built-in generators
and executors now declare their supported `targetKinds`. Discovery, design and
plan inspection expose the same compatibility result. Known mismatches receive
a structured repair action before provider work or cost reservation.

Persona remains one supported adapter. The default model generator/executor
support `dsh-persona`; the config generator supports `dsh-plugin-config`.
The custom example binds its own `local-text` Target, Generator and Executor,
and runs without persona fields. Custom Targets need matching work providers;
this release does not make every built-in provider universal.

Legacy providers that omit the declaration remain usable, with compatibility
marked `UNKNOWN`. Evaluate-only does not require or inspect a Generator.
Optional Snapshot fields, fixed config execution context and historical
experiments remain intact. No Core controller or optimization algorithm change.

## Verification and limits

[Exact-code CI](https://github.com/CZ-ZL/duo/actions/runs/35055408273) passed at
`f0a644335ec22941fd17a761070d93820f5468fc`: 350 native tests, 451 Python product
tests (86 research deselected), fresh dependency installation, 73 public checks,
31 Slow evidence checks, five baseline-repair cases and 21 host profiles. Public
types, format, generated docs, package contents and the sandbox check passed.
Both dependency advisory queries returned zero; upstream Action/runtime
deprecation warnings remain recorded.

An actual isolated installation rejected a deliberately mismatched custom
Executor through public discovery/design/plan tools, with no Journal mutation.
Restoring the matching provider completed plan/run/report: six local operations,
CNY0. The publicly downloaded archive matches this tested package byte for byte.
Changed paths have scripted DSH acceptance; no fresh independent LLM Caller ran.

[Delivery receipt](DELIVERY_EVIDENCE.json) records hashes, checks, downloads,
the superseded cancelled CI and catalog status. v0.6.1 assets are preserved.
Target-kind declarations establish scope, not task/evaluator compatibility or
quality. No optimization advantage is claimed. Model requests: 0; cost: CNY0.

## Lean change

Before: provider specialization was implicit and preparation could report
execution readiness despite a known mismatch. After: one shared compatibility
check is used by provider preflight and public preparation; readiness respects
declared mismatch. Existing controllers, services and permissions are reused.
Regression evidence includes the expected missing-rejection and wrong-readiness
failures before the fix, passing controls afterward, and the full CI gate.
