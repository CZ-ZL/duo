# @dual-loop/dsh-plugin 0.6.2

[English](./README.md) · 简体中文

DUO 是 DSH 原生的评估与优化组件。它在明确的目标、评估规则和预算下，隔离修改 Target，评估候选，并交付可追溯的结果。没有改善时保留原版是合法结果；产品验收不代表优化方法已经证明优于单环。

先读 [当前支持状态](./CURRENT_STATUS.md)、[Agent Guide](./AGENT_GUIDE.md)、[组件协议](./PROVIDERS.md) 和 [安全边界](./SECURITY.md)。原生运行时使用 JavaScript；只有显式 legacy 路径需要 Python。

## 安装

已验证环境：Linux、Node 24.14.1、DSH 0.1.2-rc.1、Cordis 4.0.2、pnpm 11.24.0。把审查过的安装包加入一个已获授权的 DSH profile：

```sh
curl -fL -o dual-loop-dsh-plugin-0.6.2.tgz https://github.com/CZ-ZL/duo/releases/download/v0.6.2/dual-loop-dsh-plugin-0.6.2.tgz
curl -fL -o SHA256SUMS https://github.com/CZ-ZL/duo/releases/download/v0.6.2/SHA256SUMS
sha256sum -c SHA256SUMS
dsh plugin --profile YOUR_PROFILE add ./dual-loop-dsh-plugin-0.6.2.tgz
dsh --profile YOUR_PROFILE --dump-config
```

安装会调用 profile 的包管理器，可能下载依赖。检查退出状态和 bundle 注册结果。它不会配置模型、授予权限或运行实验。默认 bundle 提供 discovery / preparation，等待调用方接入工作组件；不会启用研究 fixture。

## 零模型费用的完整示例

先确认已有 DSH 安装路径，并使用一个不存在的目录。`duo` 不在 PATH 时，用 `node /path/to/installed/package/bin/duo.mjs` 代替。

```sh
duo init --root /tmp/my-duo --dsh-package /path/to/node_modules/@deepseek-ai/dsh --example optimize
duo call --root /tmp/my-duo --tool dualloop_describe
duo call --root /tmp/my-duo --tool dualloop_plan
duo call --root /tmp/my-duo --tool dualloop_run --args '{"planDigest":"PASTE_PLAN_DIGEST"}'
duo call --root /tmp/my-duo --tool dualloop_report --args '{"runId":"PASTE_RUN_ID"}'
```

从实际 plan 返回值填写 digest 和 runId。`init` 将本安装包放入隔离 profile，不安装依赖、不覆盖目录、不继承凭据。`call` 使用真实 DSH ToolRuntime，保留请求、响应和日志。示例评估真实的本地文本格式，费用为 ¥0，不测量 LLM Agent 的任务能力。

## 选择模式

| Preset | 输入 | 行为 |
|---|---|---|
| `evaluate` | Target + Evaluator | 只评估，无需 Generator |
| `optimize-basic` | Target + Objective + Evaluator + Budget | 单保真优化，不需要 Slow |
| `optimize-dual` | 上述输入 + 有信息增量的证据源 | 完整双环；证据缺失时明确拒绝准备 |
| `optimize-auto` | 上述输入，附加证据可选 | 协商可用模式；降级写入 plan、Journal 和 result |

Slow 是证据获取与决策策略。更多同族任务属于 `expanded_evidence`；有适用的独立校准依据才可声明 `high_fidelity`。更贵的模型不自动更可信。无新增证据时是 `unavailable`，仍可使用 basic。详情见 [Evidence Strategy](./EVIDENCE_STRATEGY.md)。

## 接入自己的组件

默认加载的是 persona 适配器；内置模型生成器和执行器也只支持 persona。
换成其他 Target 时，需要同时接入匹配的工作组件。公开准备工具会显示
targetCompatibility，计划阶段会在执行前拒绝已声明的错配。可用
`--example custom` 体验完整的非 persona 示例。旧插件未声明适用范围时
显示 UNKNOWN，不代表支持任意 Target。

真实使用时，在自己的 profile patch 中配置 `duo-contract` 的 experiment 路径、`duo-journal` 的隔离目录，并接入符合公开协议的 Executor / Evaluator。优化还需要 Generator。只评估时设置 `duo-runtime.config.evaluationOnly: true`。配置 patch 替换整个 config 对象；相对 ES module 需要 profile package.json 声明 `type: module`。

Target、Generator、Executor、Evaluator、Comparator、Gate、Feedback 使用既有 Cordis 服务替换，无需修改 Core。具体可运行的 BYO evaluator、组件替换、自定义 Target、warm start 和恢复示例见 [公开示例](./examples/product/README.md)。公开类型通过 `/definitions` 导出。

## 边界

- persona 支持隔离修改；plugin config 只支持已列出的 fetch 字段，属于 partial support。
- provider 在进程内受信任；权限与模型运行由 DSH 宿主管理。
- shared Journal 的累计预算保留未结束 run 的完整额度；未知费用阻止后续相关准入。锁异常需要检查 owner，不自动抢锁。
- 仅支持原 deadline 内、配置未变且费用已结算的 checkpoint 恢复；不自动重跑费用未知的请求。
- warm start 不继承 final 数据、费用或授权；不同证据模式的历史只能保留允许的想法。
- 不自动采用候选，不提供跨平台保证，不全局发布 npm。历史 legacy API 与显式 fixture export 保留，fixture 默认关闭。

0.6.2 是通过固定版本 GitHub Release 分发的开发预览，验证状态与安装包哈希以仓库发布索引为准。历史源码、验收记录和研究归档位于 [GitHub 仓库](https://github.com/CZ-ZL/duo)。许可证为 MIT，见 [LICENSE](./LICENSE)。

安装包来自固定版本 GitHub Release；校验通过后安装到你授权的 profile。仓库根目录不是插件组合包，不要直接安装 `github:CZ-ZL/duo`。安装后请 Agent 先调用 `dualloop_describe`，了解适用性和缺少的配置。
