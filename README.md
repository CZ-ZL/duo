# DUO

**English** · [简体中文](README.zh-CN.md)

[![Product verification](https://github.com/CZ-ZL/duo/actions/workflows/product.yml/badge.svg)](https://github.com/CZ-ZL/duo/actions/workflows/product.yml)

DUO is a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH)
plugin that lets an Agent propose changes, compare the original and candidates
using supplied tests, and return candidates, decisions and cost reports.
The original stays in place; adoption is the user's decision.

<a id="start-here"></a>
<a id="use-from-your-agent"></a>

**[Quickstart: download v0.6.3 → free run → saved report](dsh-plugin/QUICKSTART.md)**

Supports Linux and Node 24+; verified with DSH 0.1.2-rc.1 / Cordis 4.0.2.
For a fresh host, follow [installation](dsh-plugin/guides/INSTALL.md).
[v0.6.3 Release](https://github.com/CZ-ZL/duo/releases/tag/v0.6.3) includes the
archive, checksum and verification receipt. DSH remains an upstream preview;
DUO does not sandbox arbitrary providers.

## A concrete task

The [document-QA starter](dsh-plugin/guides/MODEL_STARTER.md) supplies a prompt,
a deployment runbook, four questions and an evaluator. With authorized model
access, DUO measures the original, generates one prompt change, executes it and
checks the answers. The caller supplies model configuration and a budget;
installation grants no spending authority.

In a recorded run, both original and candidate scored 4/4, so DUO retained the
original. Three inner requests cost ¥0.00735072. No independent Slow/final test
was present; this is not a claim of improvement. See the
[actual candidate, per-task checks and usage](docs/product-foundation/first-use/STARTER_RESULT.json).
Calling Agent inference and local compute are outside that inner cost.

## Supported work

- **Experiments:** prompt/persona overlays, custom evaluators and matching execution providers.
- **Two loops:** Fast searches candidates; Slow acquires planned additional evidence and feeds it back. Basic mode also works independently.
- **Records:** retain failures, decisions and costs; reuse compatible development history while keeping final results out of search.
- **Bounded execution:** inspect plans and budgets, stop on unknown costs, and recover at supported settled checkpoints.

The configuration adapter covers one fetch setting. Other Targets need their
own adapters and work providers. See [current support](dsh-plugin/CURRENT_STATUS.md),
[architecture and diagrams](docs/ARCHITECTURE.md), and [security](dsh-plugin/SECURITY.md).

## Documentation and research

| Purpose | Entry |
|---|---|
| Agent tools and results | [Agent Guide](dsh-plugin/AGENT_GUIDE.md), [API reference](dsh-plugin/AGENT_REFERENCE.md) |
| Extend or replace components | [Provider contracts](dsh-plugin/PROVIDERS.md) |
| Understand the comparator | [Shared Simple method and diagram](docs/research/SIMPLE_BASELINE.md) |
| Inspect research conclusions | [Experiment index](docs/research/EXPERIMENTS.md) |
| Develop DUO | [Contributing](CONTRIBUTING.md), [testing](docs/development/TESTING.md), [layout](docs/development/REPOSITORY_LAYOUT.md) |
| Find other documentation | [Documentation map](docs/README.md), [releases](docs/releases/README.md) |

Simple is a strong single-loop baseline shared across experiments, documented
independently of any one study. Completed task research supports retaining
Simple rather than adopting the evaluated full or aligned DUO. The aligned
study's strict scientific status remains `UNRESOLVED`. Product operation and
method superiority are separate claims.

The two-loop idea was inspired by Wang et al.'s
[*Self-Evolving Recommendation System*](https://arxiv.org/abs/2602.10226).
This independent adaptation does not inherit the paper's results.
[MIT license](LICENSE) · [origins and notices](docs/THIRD_PARTY_NOTICES.md).
