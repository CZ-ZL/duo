# DUO — DSH-native evaluation and optimization

DUO packages a bounded optimization lifecycle as Cordis services inside DeepSeek Harness. A Calling Agent supplies a Target, measurable objective, compatible evaluator and authorized resources, then receives candidates, evidence, decisions, history and costs. No improvement is a valid outcome. DUO does not automatically adopt a candidate.

**0.5.0 Product Foundation.** Read [current support](CURRENT_STATUS.md), [Agent guide](AGENT_GUIDE.md), and [current acceptance](PRODUCT_ACCEPTANCE.json). The default bundle exposes preparation and waits for work providers. No research fixture or model spending is enabled by default.

## Start with the installed package

Requires Linux, Node 24+ and an existing DSH installation. Verified host target: DSH 0.1.2-rc.1 / Cordis 4.0.2. Native runtime and public examples need no Python.

From the source distribution, `cd dsh-plugin && npm pack --offline --ignore-scripts` creates the package. Install the reviewed tarball into an authorized profile using the tested
pnpm 11.24.0 installation toolchain:

```sh
dsh plugin --profile YOUR_PROFILE add /absolute/path/dual-loop-dsh-plugin-0.5.0.tgz
```

The profile must already provide a DSH application and tools. Installation can resolve peer dependencies; the default bundle provides discovery/preparation, not a model route or permission. See [package installation](dsh-plugin/README.md).

For a complete free example, use the shipped `duo` executable (or `node /path/to/package/bin/duo.mjs`):

```sh
duo init --root /tmp/my-duo --dsh-package /path/to/node_modules/@deepseek-ai/dsh --example optimize
duo call --root /tmp/my-duo --tool dualloop_describe
duo call --root /tmp/my-duo --tool dualloop_plan --args '{"view":"summary"}'
```

Inspect the plan, then pass its exact planDigest to dualloop_run within your authority. The [public examples](dsh-plugin/examples/product/README.md) cover evaluation-only, default optimization, BYO evaluator, component replacement and warm start. They measure actual local text hygiene, cost CNY 0 and need no private profile, account or historical ledger. They do not evaluate LLM Agent quality.

## Architecture and replacement

The native controller owns the generic lifecycle. Target adapters own content identity, Delta validation and historical projection. Generator, Executor, Evaluators, Comparator, Gate and Feedback/History are existing replaceable Cordis services. DSH owns model execution, tools, permissions, dependency injection and lifecycle. [Provider contracts](dsh-plugin/PROVIDERS.md) are public and shipped.

SQLite Journal, atomic reservation/settlement, unknown-cost stopping and checkpoint recovery remain shared. Recovery supports unchanged settled baseline/generation boundaries within the original deadline; no blind replay. The ledger covers inner operations, not every Calling Agent request. Providers are trusted in-process code, not isolated by metadata declarations.

Persona is supported with matching work providers. Bounded fetch configuration is explicitly partial: only maxBodyChars may change and a compatible executor/evaluator is required. Discovery includes adapter-specific limits. Custom targets can implement the same service without changing the core.

## Verification and history

[TESTING.md](TESTING.md) documents the offline product gate, package/CLI acceptance and CI. Product verification is distinct from research replay and method effectiveness. [Product work queue](docs/product-foundation/QUEUE.md) and [lean change record](docs/product-foundation/LEAN.md) track this release.

[EXPERIMENTS.md](EXPERIMENTS.md) retains earlier formal negative results and later diagnostics. No general quality or total-cost advantage over a reasonable single loop has been established. Method research is paused. Old final datasets remain consumed; old results and fees are not rewritten.

The separately versioned Python protocol stays at 0.1.0 and /legacy remains compatible and separately tested; Python is not used by the default runtime. Historical status is preserved under docs/history/0.4.0. Linux/Node24 is the supported environment; other platforms and TypeScript semantic compilation are not yet verified. No npm registry publication or automatic deployment is part of this delivery.
