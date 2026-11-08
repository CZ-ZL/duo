# @dual-loop/dsh-plugin · 0.6.3

[English](README.md) · 简体中文

DUO 让 DSH Agent 比较原版与候选，交付修改、测量、决策和费用报告。
原版保留，采用由用户决定。

**[开始：安装 → 免费运行 → 保存报告](QUICKSTART.zh-CN.md)**

支持 Linux / Node 24+，已验证 DSH 0.1.2-rc.1 / Cordis 4.0.2。
使用 [v0.6.3 下载包](https://github.com/CZ-ZL/duo/releases/tag/v0.6.3)；
仓库根目录不是插件，当前不通过 npm registry 发布。
[安装与兼容性](guides/INSTALL.zh-CN.md)包含独立宿主和已有 profile 的用法。
DSH 仍是上游预览版；组件在宿主进程中执行。

- [真实任务 starter](guides/MODEL_STARTER.zh-CN.md)：带任务、评估器和预算检查的模型实验。
- [Agent Guide](AGENT_GUIDE.md)、[API reference](AGENT_REFERENCE.md)：工具调用和恢复。
- [Provider contracts](PROVIDERS.md)：组件替换和扩展。
- [当前支持](CURRENT_STATUS.md)、[证据策略](EVIDENCE_STRATEGY.md)、[安全边界](SECURITY.md)。

默认 bundle 在接入工作组件前提供准备能力；`duo init` 创建完整示例。
内置模型组件支持 persona/prompt；其他 Target 需要匹配的 provider。
DUO 内层费用不含调用方推理或本地资源。Python/YAML 兼容层位于 `/legacy`，
native 使用不需要 Python。模型调用与采用候选都需要相应授权。
