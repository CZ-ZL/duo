# 安装与兼容性

[English](INSTALL.md) · 简体中文

## 兼容范围

| 部件 | 已验证组合 |
|---|---|
| 系统 | Linux；CI 为 Ubuntu 22.04 |
| Node | 24+；CI 为 24.14.1 |
| DeepSeek Harness | `@deepseek-ai/dsh` 0.1.2-rc.1 |
| Cordis | `@deepseek-ai/cordis` 4.0.2 及配套插件 |
| 包管理器 | npm；向 DSH profile 安装时使用 pnpm 11.24.0 |

[宿主清单](../host/package.json)固定整个框架组合。宽泛的 peer 范围用于依赖声明，
不表示其中每个版本都经过验收。尤其是 Cordis 4.1 改变了 DSH rc.1 使用的接口，
不属于本版本已验证组合。`check-host` 核对元数据，不替代实际运行检查。
Windows/macOS 与其他宿主版本尚未验收。

DSH 仍是上游预览版，可能有破坏性变更。见
[上游安全说明](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/SAFETY.md)
和 [DUO 安全边界](../SECURITY.md)。这份正式 DUO 发布不改变依赖的成熟度。

## 准备独立宿主

已有匹配的安装可直接使用。否则在拥有写权限的目录准备新的宿主，不修改日常 profile：

```sh
mkdir duo-host-0.6.3 && cd duo-host-0.6.3
curl -fL https://github.com/CZ-ZL/duo/releases/download/v0.6.3/host-package.json -o package.json
npm install --ignore-scripts --no-audit --no-fund --cache "$PWD/npm-cache"
export DUO_DSH_PACKAGE="$PWD/node_modules/@deepseek-ai/dsh"
```

安装会访问 npm registry，但不调用模型。然后回到 [Quickstart](../QUICKSTART.zh-CN.md)，填写上述宿主路径。

## 安装到已有 DSH profile

Quickstart 的 `duo init` 会在新工作目录创建独立 profile。若要手工接入自己的 profile，先下载并校验归档，准备 pnpm 11.24.0，再执行：

```sh
export DSH_HOME="$PWD/dsh-home"
node "$DUO_DSH_PACKAGE/lib/bin.js" plugin --profile starter add "$PWD/dual-loop-dsh-plugin-0.6.3.tgz" --ignore-scripts --store-dir "$PWD/pnpm-store" --fetch-retries=0 --fetch-timeout=15000
node "$DUO_DSH_PACKAGE/lib/bin.js" --profile starter --dump-config
```

默认 bundle 在接入兼容的工作 provider 前只提供准备能力；完整示例由 `duo init` 提供。
宿主已包含全部依赖且 registry 不可用时，可在 `plugin add` 后增加
`--offline --config.auto-install-peers=false`。仍必须完成发现、计划和运行检查；
打包成功不能证明依赖可加载。

## 从源码开发

```sh
git clone --branch v0.6.3 --depth 1 https://github.com/CZ-ZL/duo.git
cd duo
npm ci --ignore-scripts --cache "$PWD/npm-cache"
npm pack ./dsh-plugin --ignore-scripts --cache "$PWD/npm-cache"
```

仓库根目录是开发工具包，不是 DSH 插件。安装的对象是 `dsh-plugin` 归档。
保留旧归档和报告；升级时用新目录验收并重新 plan，不能跨实现版本恢复旧检查点。
见[错误与恢复](TROUBLESHOOTING.zh-CN.md)。
