# @dual-loop/dsh-plugin 0.6.3

[English](./README.md) · 简体中文

DUO 让 DSH Agent 测量原提示词或受支持组件，按提供的测试尝试候选修改，
最后交付改动、结果、选择依据和费用。

**[从这里开始：安装 → 免费检查或真实任务 → 保存报告](./QUICKSTART.zh-CN.md)**

Quickstart 提供完整命令、样例任务和评估器，只让调用方填写自己拥有的模型
配置与授权。独立 Caller 已按公开指南完成真实 starter；原版与候选平分，
最终保留原版。本地路径不调用模型，用于检查产品流程。

开发者预览版：Linux / Node24+，已验证 DSH0.1.2-rc.1 / Cordis4.0.2。
0.6.3 尚未发布；Quickstart 将公开源码打成可安装 tarball。此前已发布版本
可使用 GitHub Release 资产。不安装仓库根目录，也不假定已有 npm 发布。安装可能下载依赖，不会自动连接模型账号或授权实验。

- [Agent Guide](./AGENT_GUIDE.md)：何时调用、如何使用公开工具。
- [当前支持](./CURRENT_STATUS.md)：Target 与模式边界。
- [API 参考](./AGENT_REFERENCE.md)、[Provider 契约](./PROVIDERS.md)：高级配置、组件替换、恢复。
- [证据策略](./EVIDENCE_STRATEGY.md)：basic、dual 和实际取得的证据。
- [安全说明](./SECURITY.md)：可信 provider、宿主权限、候选采用。

默认 bundle 在兼容工作 provider 接入前只提供准备能力，starter 则已提供该任务
的组合。内置模型 provider 支持 persona/prompt，其他 Target 需要匹配的 provider。
不自动采用候选。DUO 内层费用不含 Calling Agent 推理与本地资源。
Python/YAML 兼容路径保留在 /legacy，原生使用不需要 Python。
