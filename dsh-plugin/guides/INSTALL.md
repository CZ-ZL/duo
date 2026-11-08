# Installation and compatibility

English · [简体中文](INSTALL.zh-CN.md)

## Compatibility

| Component | Verified composition |
|---|---|
| OS | Linux; CI uses Ubuntu 22.04 |
| Node | 24+; CI uses 24.14.1 |
| DeepSeek Harness | `@deepseek-ai/dsh` 0.1.2-rc.1 |
| Cordis | `@deepseek-ai/cordis` 4.0.2 and its companion plugins |
| Package manager | npm; pnpm 11.24.0 when adding to a DSH profile |

The [host manifest](../host/package.json) pins the framework family. Broad peer
ranges express dependency declarations, not qualification of every version.
Cordis 4.1 changes interfaces used by DSH rc.1 and is outside this verified
composition. `check-host` checks metadata; the local run checks actual loading.
Other host versions and Windows/macOS have not been accepted.

DSH remains an upstream preview with possible breaking changes. Read its
[pinned safety guidance](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/SAFETY.md)
and [DUO security boundaries](../SECURITY.md). A complete DUO release does not
change the maturity of its dependencies.

## Prepare an isolated host

Reuse a matching installation, or prepare a new host in a directory you own:

```sh
mkdir duo-host-0.6.3 && cd duo-host-0.6.3
curl -fL https://github.com/CZ-ZL/duo/releases/download/v0.6.3/host-package.json -o package.json
npm install --ignore-scripts --no-audit --no-fund --cache "$PWD/npm-cache"
export DUO_DSH_PACKAGE="$PWD/node_modules/@deepseek-ai/dsh"
```

Installation contacts the npm registry but makes no model requests. Return to [Quickstart](../QUICKSTART.md) with this host path.

## Add to an existing DSH profile

Quickstart uses `duo init` to create an isolated profile in a new workspace. For manual integration, download and verify the archive first, provide pnpm 11.24.0, then run:

```sh
export DSH_HOME="$PWD/dsh-home"
node "$DUO_DSH_PACKAGE/lib/bin.js" plugin --profile starter add "$PWD/dual-loop-dsh-plugin-0.6.3.tgz" --ignore-scripts --store-dir "$PWD/pnpm-store" --fetch-retries=0 --fetch-timeout=15000
node "$DUO_DSH_PACKAGE/lib/bin.js" --profile starter --dump-config
```

The default bundle provides preparation until compatible work providers are attached; `duo init` supplies complete examples. If the host already has every dependency and the registry is unavailable, append `--offline --config.auto-install-peers=false` to `plugin add`. Still check discovery, planning and execution; packing alone does not establish loadability.

## Develop from source

```sh
git clone --branch v0.6.3 --depth 1 https://github.com/CZ-ZL/duo.git
cd duo
npm ci --ignore-scripts --cache "$PWD/npm-cache"
npm pack ./dsh-plugin --ignore-scripts --cache "$PWD/npm-cache"
```

The repository root is development tooling, not the DSH plugin. Install the `dsh-plugin` archive. Keep previous archives and reports; verify upgrades in a new workspace and re-plan. Do not resume old checkpoints across implementation changes. See [errors and recovery](TROUBLESHOOTING.md).
