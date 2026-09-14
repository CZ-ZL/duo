# DUO 0.5.0 — Product Foundation

A DSH-native evaluation/optimization component with a documented supported
boundary, installable tarball and public Agent workflow. The default bundle
exposes preparation and waits for providers. No fixture or model spend is
silently enabled.

This version unifies capabilities, moves Target identity/history projection out
of Core, adds evaluate/optimize preparation presets and consistent diagnostics,
and ships independent local examples for evaluation, optimization, BYO evaluator,
component replacement, warm start and a custom Target. Existing Cordis services,
DSH runtime, budget/receipt checks and legacy APIs are reused.

Product verification includes native and Python regression tests, real isolated
DSH profiles, actual tarball installation, public package workflows and a fresh
Calling Agent following only installed docs. Exact receipts and CI state are in
PRODUCT_ACCEPTANCE.json and docs/product-foundation/REPORT.md.

Upgrade by inspecting and re-planning; old checkpoint digests bind the old
implementation/provider graph. Fixture users must bind it explicitly. The
separately versioned Python protocol remains 0.1.0.

Known limits: Linux/Node24 and tested DSH snapshot; trusted in-process providers;
fetch configuration Target is partial; original-deadline settled checkpoint
recovery only; outer Caller fees are outside the native ledger. Examples measure
local text hygiene without independent final qualification. TypeScript semantic
compilation and Windows/macOS are not qualified. No automatic adoption or npm
registry publication.

RESEARCH NOT PROVEN: product acceptance does not establish a DUO quality or cost
advantage. Method research is paused and all earlier results remain unchanged.
