# DUO — bounded optimization inside DSH

[![Product verification](https://github.com/CZ-ZL/duo/actions/workflows/product.yml/badge.svg)](https://github.com/CZ-ZL/duo/actions/workflows/product.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

(The repository is currently private; the CI badge resolves once it is public.)

DUO is a DeepSeek Harness (DSH) plugin for evaluating and optimizing an
existing persona/system prompt. A Calling Agent supplies a target, a measurable
objective, versioned evaluators and authorized resources. DUO then runs a
generate → evaluate → select loop — cheap Fast screening, sparser Slow
validation, a separate final evaluation — and returns candidate overlays,
evidence, decisions, history and costs. It is built as a research/portfolio
artifact with rigorous methodology: frozen contracts, digest-bound plans and a
complete failure record are first-class deliverables.

**Current status:** experimental 0.4.0 source preview; see
[STATUS.md](STATUS.md) for the exact publication state. The completed formal
comparison **did not establish a quality or total-cost advantage over a
reasonable single-loop method**. Retaining the original persona is a valid
result. Candidates are never automatically deployed.

## Architecture

- **Protocol core (`dualloop/`, Python)** — the original Phase A contract,
  controller, comparator, journal and CLI. Offline and mock-capable; retained
  as explicit legacy compatibility, verified by its own test suite.
- **DSH plugin (`dsh-plugin/`, npm package `@dual-loop/dsh-plugin` 0.4.0)** —
  the default product: the protocol runs inside DSH as native Cordis
  services (contract, target, comparator, gate, feedback, journal, budget,
  controller, observer) exposing `dualloop_*` agent tools. JavaScript runtime;
  no Python needed at runtime.
- **Budget/ledger guards** — per-run SQLite journal with atomic CNY cost
  reservation and settlement. Unknown cost blocks further work; overruns stop
  admission; interrupted runs refuse blind replay.
- **Replaceable providers** — generation, execution and evaluation are
  caller-supplied Cordis providers behind versioned contracts. The shipped
  default wires a zero-cost static fixture so a fresh install runs end to end
  with no model, network or spend.
- **Freeze-first methodology** — contracts, data splits and plans are frozen
  and digest-bound before any run; changed inputs invalidate the plan digest.
  Final splits are consumed once and never reused as unseen data.

## Quick start

Requires Linux, Node 24+, Python 3.10+ with PyYAML, and an existing DSH
installation for the plugin checks. Verification used DSH 0.1.2-rc.1,
Cordis 4.0.2 and Node 24.14.1.

### Python protocol core (offline, no DSH needed)

```sh
pip install -e .                              # or: pip install PyYAML pytest
python3 -m pytest tests/ -q -m 'not research'
```

The `research`-marked tests replay historical paid experiments and require a
separately reviewed archive; they are deselected on purpose. See
[TESTING.md](TESTING.md).

### Native plugin tests

```sh
export DUO_DSH_PACKAGE=/absolute/path/to/node_modules/@deepseek-ai/dsh
node --loader ./scripts/dsh_native_loader.mjs --test dsh-plugin/native/*.test.js dsh-plugin/*.test.js
```

### Packaged end-to-end demo (no model, zero cost)

```sh
python3 scripts/verify_dsh_native.py --dsh-package "$DUO_DSH_PACKAGE" --scenario packaged --output /tmp/new-duo-demo
```

This packs the plugin, creates an isolated DSH profile, loads the shipped
contract and default providers, and exercises the public plan/run/report tools.
Read `report.json` and the profile's `product-report.json` in the output
directory; use a new output path per run. Synthetic measurements show
functionality, not optimization benefit.

### Full product gate and real use

`bash scripts/release_gate.sh /tmp/new-duo-release-check` runs every native
test, the Python product checks, 21 isolated DSH CLI scenarios and an
inspection of the actual npm tarball — no model credentials needed.

For the plugin itself, start with the [package guide](dsh-plugin/README.md),
then [NATIVE_ACCEPTANCE_GUIDE.md](NATIVE_ACCEPTANCE_GUIDE.md) (comparison and
Calling-Agent acceptance protocols) and
[NATIVE_CALLING_GUIDE.md](NATIVE_CALLING_GUIDE.md) (how to call a configured
plugin). Real model runs additionally require an authorized budget and a
configured `DEEPSEEK_API_KEY`.

## A minimal run

With the plugin installed and the two required paths configured (experiment
contract and journal root — see the [package guide](dsh-plugin/README.md)),
the default bundle wires a persona target and zero-cost fixture providers, so
this sequence runs with no model calls:

```text
dualloop_discover({})                  # configured providers, capabilities, limits
dualloop_plan({})                      # frozen inputs → planDigest + runId
dualloop_run({ "planDigest": "…" })    # execute exactly the inspected plan
dualloop_report({ "runId": "…" })      # candidates, decisions, lineage, costs
```

The contract is explicit JSON: [`examples/native/experiment.json`](examples/native/experiment.json)
(byte-identical to the packaged `dsh-plugin/examples/experiment.json`) pins the
persona target, fast/slow/final evaluator identities, a strict-improvement
epsilon, hard constraints and a zero-cost budget. Inspect the plan before
running; a repeated terminal plan reads retained artifacts instead of new work.

The npm bundle's default target is the persona provider.
[`examples/native/fetch-config-evaluation.js`](examples/native/fetch-config-evaluation.js)
is a research diagnostic harness (real model, pinned local document, isolated
profiles) for the experimental `web_fetch` `maxBodyChars` configuration target —
it is not the shipped default. See [examples/native/FETCH_CONFIG.md](examples/native/FETCH_CONFIG.md).

## Results so far — read this before citing DUO

Full details: [EXPERIMENTS.md](EXPERIMENTS.md) and the machine-readable
[experiment-evidence.json](experiment-evidence.json) (aggregate results and
hashes of retained reports; not an independent replication).

- **Formal four-arm comparison (2026-09-13, `deepseek-flash`, 18-task final
  split):** all three optimization arms — reasonable single-loop (B1), full DUO
  (B2), DUO without explicit Slow feedback (B3) — **retained the original
  persona**. No quality or API-cost advantage over the single-loop baseline was
  demonstrated. 51 model requests, CNY 0.535987807 including a retained B2
  failure charge.
- **Post-hoc diagnostics:** a shadow final and a selection-quality audit on
  separate splits found only ±1-task signals in single stochastic executions —
  possible false negatives, not reliable improvements. Both diagnostic splits
  are now `CONSUMED_FOR_DIAGNOSIS` and must not be presented as unseen data.
- **Configuration headroom (6-question development slice):** pre-fixed variants
  of the fetch provider's `maxBodyChars` scored default 3/6 → expanded 6/6 in
  two rounds (12 requests, CNY 0.048678680). These variants were fixed before
  running and **were not generated by DUO**; this is not a method comparison
  and not evidence that arbitrary configuration targets are supported.
- **Corrected config-search comparison (2026-09-14, `maxBodyChars` knob
  only):** after fixing an execution-precondition failure (validated by a
  2-request real run), a same-harness B0/B1/B2 comparison completed (44
  requests, CNY 0.18554908). It found real configuration headroom on this
  diagnostic: baseline(100000) 8/12 → both loops' selected candidates 12/12 on
  the once-frozen 12-question diagnostic final. The dual loop and the single
  loop **tied** (both selected 12/12; B1 17 requests, B2 21), so the formal
  no-advantage conclusion stands with same-direction evidence. Caveats: single
  execution per object, large answer-side nondeterminism, final questions from
  the same previously-public source document as dev (not unseen corpus), and
  12/12/18/18 are ceiling ties. That diagnostic final is now consumed and must
  never be presented as unevaluated. See [EXPERIMENTS.md](EXPERIMENTS.md).

Offline example and fixture scores are functional evidence only. API costs are
observed token usage times frozen CNY tariffs; no independent invoice was
obtained.

## Install and configure

```sh
cd dsh-plugin
npm pack --offline --ignore-scripts
```

Install the tarball and configure the contract and journal paths with the
[package guide](dsh-plugin/README.md). Installation may need registry access
for peer dependencies. The native runtime is JavaScript; Python is used for
source verification and explicit legacy compatibility.

For real work, follow the [Calling Agent guide](AGENT_GUIDE.md),
[reference](AGENT_REFERENCE.md), [provider contracts](dsh-plugin/PROVIDERS.md),
[BYO example](examples/native/byo-profile.patch.yml) and
[model entry guide](NATIVE_MODEL_GUIDE.md). Inspect `dualloop_plan` before
passing its exact digest to `dualloop_run`; read the report and settled or
unknown fees. A model-driven Caller can incur costs even with free work
providers. Example budgets do not authorize spending.

## Supported boundary

- Native Cordis contract, persona target, controller, comparison, promotion,
  Slow feedback, warm start, Journal and CNY reservation/settlement.
- Replaceable generation, execution and evaluation providers; preparation,
  evaluation-only, embedded use, reports and guarded recovery.
- Persona/system-prompt targets are implemented. Arbitrary plugin
  configuration, workflow and retrieval Targets are not advertised as
  supported (the fetch-config target above is an experimental diagnostic).
- Linux process ownership is supported. Windows/macOS and TypeScript semantic
  compilation are outside the current verified boundary.
- Trusted providers run inside DSH; DUO is not an OS sandbox. Read the
  [security policy](dsh-plugin/SECURITY.md) before handling real resources.

## Documentation

- [DESIGN.md](DESIGN.md) — architecture and historical decisions; source,
  provider contracts and tests define current supported behavior
- [TESTING.md](TESTING.md) — product gate vs. historical research replay
- [RELEASING.md](RELEASING.md) — publication requirements and versioning policy
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute
- [AGENT_GUIDE.md](AGENT_GUIDE.md) — calling DUO from a DSH agent
- [STATUS.md](STATUS.md) — current publication status and evidence limits
- [EXPERIMENTS.md](EXPERIMENTS.md) — completed experiments, failures, limits
- [CODE_BENCHMARK_GUIDE.md](CODE_BENCHMARK_GUIDE.md) — running new authorized benchmarks

## Contributing

Small fixes welcome; keep fixture results labeled as functional evidence, not
optimization benefit — see [CONTRIBUTING.md](CONTRIBUTING.md).

[Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [MIT license](LICENSE)
· [Third-party notices](THIRD_PARTY_NOTICES.md) ·
中文交付状态见[本轮交付报告](DELIVERY_REPORT.zh.md)

Inspired by *Self-Evolving Recommendation System: End-To-End Autonomous Model
Optimization With LLM Agents*. DUO adapts the dual-loop idea to Agent persona
experiments; it does not reproduce the paper's infrastructure, claim its
results or imply endorsement by its authors.
