# Documentation map

Choose an entry by what you want to do. Product usage, shared research methods,
experiment results and historical acceptance records have separate scopes.

| Need | Start here |
|---|---|
| Understand DUO | [English README](../README.md) · [中文 README](../README.zh-CN.md) |
| Install, check locally, or run a real task | [English Quickstart](../dsh-plugin/QUICKSTART.md) · [中文](../dsh-plugin/QUICKSTART.zh-CN.md) |
| Use DUO as a Calling Agent | [Agent Guide](../dsh-plugin/AGENT_GUIDE.md) · [tool reference](../dsh-plugin/AGENT_REFERENCE.md) |
| Check supported targets and modes | [Current capabilities](../dsh-plugin/CURRENT_STATUS.md) |
| Understand the two loops and code boundaries | [Current architecture](./ARCHITECTURE.md) |
| Supply or replace a component | [Provider contracts](../dsh-plugin/PROVIDERS.md) · [runnable examples](../dsh-plugin/examples/product/README.md) |
| Develop and verify a change | [Contributing](../CONTRIBUTING.md) · [tests](./development/TESTING.md) · [script map](../scripts/README.md) |
| Understand the Simple comparator | [Shared method and flow diagram](research/SIMPLE_BASELINE.zh-CN.md) · [source bindings](research/SIMPLE_BASELINE_PROVENANCE.json) |
| Review source and tagged releases | [Release index](releases/README.md) · [release procedure](development/RELEASING.md) |
| Understand origins and licenses | [Third-party notices and inspiration](THIRD_PARTY_NOTICES.md) |
| Read research results | [Research index](research/README.md) · [task optimization studies](research/duo-task-optimization-20261105/README.md) · [earlier experiments](research/EXPERIMENTS.md) |
| Locate source-checkout examples | [Example map](../examples/README.md) |
| Interpret old status pages or receipts | [Historical record map](history/README.md) · [product acceptance](product-foundation/README.md) · [Slow-semantics acceptance](slow-evidence-strategy/README.md) |

## Source of truth

The [repository layout](development/REPOSITORY_LAYOUT.md) is the directory map.
The [script map](../scripts/README.md) distinguishes product verification from
retained research drivers. Current entry pages link to canonical documents;
historical status files describe their recorded commits.

`dsh-plugin/package.json` owns shipped files and exports. Runtime consumers do not
need the repository's Python tests, research scripts or historical fixtures.
`native/capabilities.js` owns current capability declarations;
`dsh-plugin/CURRENT_STATUS.md` is generated from it. Agent instructions have one
canonical location in `dsh-plugin/`; repository navigation links to those same
shipped guides. The [changelog](releases/CHANGELOG.md) lives with release records.

The [historical record map](history/README.md) explains earlier paths, preserved
bytes and missing private inputs. Private profiles, ledgers and raw run
directories remain outside this repository.
