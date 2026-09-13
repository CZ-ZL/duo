# DUO — bounded optimization inside DSH

DUO is a DeepSeek Harness plugin for evaluating and optimizing an existing
persona/system prompt. A Calling Agent supplies a target, measurable objective,
versioned evaluators and authorized resources. DUO returns candidate overlays,
Fast/Slow/final evidence, decisions, history and costs.

**Current package: `@dual-loop/dsh-plugin` 0.3.0.** This is an experimental
component. The project has not established a quality or total-cost advantage over
a reasonable single-loop method. Retaining the original persona is a valid
result. Candidates are not automatically deployed.

See [experimental results](EXPERIMENTS.md) for the completed four-arm comparison,
shadow-final diagnostic, selection audit, failures and evidence limits.
中文交付状态见[本轮交付报告](DELIVERY_REPORT.zh.md)。

## Try the packaged example without a model

Use Linux, Node 24+, Python 3.10+ with PyYAML, and an existing DSH installation.
Verification uses DSH 0.1.2-rc.1, Cordis 4.0.2 and Node 24.14.1. From this checkout:

```sh
python3 scripts/verify_dsh_native.py --dsh-package /absolute/path/to/node_modules/@deepseek-ai/dsh --scenario packaged --output /tmp/new-duo-demo
```

This packs the plugin, creates an isolated DSH profile, loads the shipped
contract and default providers, and exercises the public plan/run/report tools.
Read `report.json` and the profile's `product-report.json` in the output directory.
Use a new output path for each run. No model requests occur. Synthetic measurements
show functionality, not optimization benefit.

## Install and configure

```sh
cd dsh-plugin
npm pack --offline --ignore-scripts
```

Install the tarball and configure the contract and journal paths with the
[package guide](dsh-plugin/README.md). Installation may need registry access for
peer dependencies. The native runtime is JavaScript; Python is used for source
verification and explicit legacy compatibility.

For real work, follow the [Calling Agent guide](AGENT_GUIDE.md),
[reference](AGENT_REFERENCE.md), [provider contracts](dsh-plugin/PROVIDERS.md),
[BYO example](examples/native/byo-profile.patch.yml) and
[model entry guide](NATIVE_MODEL_GUIDE.md). Inspect `dualloop_plan` before passing
its exact digest to `dualloop_run`; read the report and settled or unknown fees.
A model-driven Caller can incur costs even with free work providers. Example
budgets do not authorize spending.

## Supported boundary

- Native Cordis contract, persona target, controller, comparison, promotion,
  Slow feedback, warm start, Journal and CNY reservation/settlement.
- Replaceable generation, execution and evaluation providers; preparation,
  evaluation-only, embedded use, reports and guarded recovery.
- Persona/system-prompt targets are implemented. Arbitrary plugin configuration,
  workflow and retrieval Targets are not advertised as supported.
- Linux process ownership is supported. Windows/macOS and TypeScript semantic
  compilation are outside the current verified boundary.
- Trusted providers run inside DSH; DUO is not an OS sandbox. Read the
  [security policy](dsh-plugin/SECURITY.md) before handling real resources.

## Verify and contribute

[TESTING.md](TESTING.md) separates the product gate from historical research
replay. [RELEASING.md](RELEASING.md) defines publication requirements;
[STATUS.md](STATUS.md) distinguishes preparation from a published release.
The [architecture](DESIGN.md) includes historical decisions; source, provider
contracts and tests define current supported behavior.

[Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [MIT license](LICENSE)
· [Third-party notices](THIRD_PARTY_NOTICES.md)

Inspired by *Self-Evolving Recommendation System: End-To-End Autonomous Model
Optimization With LLM Agents*. DUO adapts the dual-loop idea to Agent persona
experiments; it does not reproduce the paper's infrastructure, claim its results
or imply endorsement by its authors.
