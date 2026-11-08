# DUO

[English](README.md) · **简体中文**

[![Product verification](https://github.com/CZ-ZL/duo/actions/workflows/product.yml/badge.svg)](https://github.com/CZ-ZL/duo/actions/workflows/product.yml)

DUO 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件：
让 Agent 提出修改，用提供的测试比较原版和候选，交付候选、选择依据和费用报告。
原版保留，是否采用候选由用户决定。

**[快速开始：下载 v0.6.3 → 免费运行 → 查看报告](dsh-plugin/QUICKSTART.zh-CN.md)**

支持 Linux、Node 24+，已验证 DSH 0.1.2-rc.1 / Cordis 4.0.2。
没有宿主时先按[安装说明](dsh-plugin/guides/INSTALL.zh-CN.md)准备独立环境。
下载包、校验和与验证记录见 [v0.6.3 Release](https://github.com/CZ-ZL/duo/releases/tag/v0.6.3)。
DSH 依赖仍是上游预览版；DUO 不为任意 provider 提供沙箱。

## 一个实际任务

[文档问答 starter](dsh-plugin/guides/MODEL_STARTER.zh-CN.md)提供提示词、部署手册、
四道题和评估器。接入已授权模型后，DUO 先测原版，再生成、执行和评估一次提示词修改。
调用方提供模型配置与预算；安装本身不会授予消费权限。

已记录的一次运行中，原版和候选均为 4/4，因此保留原版。三次内层请求合计
¥0.00735072；没有独立 Slow/final，不能据此宣称能力提升。详见
[实际候选、逐题检查与用量](docs/product-foundation/first-use/STARTER_RESULT.json)。
调用方自身推理和本地计算不计入这笔内层费用。

## 支持什么

- **试改与评估：** prompt/persona overlay；自定义评估器和匹配的执行组件。
- **双环证据：** Fast 搜索候选，Slow 按计划补充证据并反馈；基础模式也可独立运行。
- **记录与控制：** 保留失败、决策和费用；兼容开发历史可复用，final 不回流搜索。
- **有界执行：** 先检查计划和预算，费用未知时停止，在支持的已结算检查点恢复。

配置适配器只覆盖一个 fetch 字段。其他修改对象需要自己的适配器和工作组件。
详见[当前支持](dsh-plugin/CURRENT_STATUS.md)、[架构与结构图](docs/ARCHITECTURE.md)和
[安全边界](dsh-plugin/SECURITY.md)。

## 文档与研究

| 目的 | 入口 |
|---|---|
| Agent 调用和返回值 | [Agent Guide](dsh-plugin/AGENT_GUIDE.md)、[API reference](dsh-plugin/AGENT_REFERENCE.md) |
| 扩展或替换组件 | [Provider contracts](dsh-plugin/PROVIDERS.md) |
| 理解比较基线 | [Simple 公共方法与结构图](docs/research/SIMPLE_BASELINE.zh-CN.md) |
| 查看研究结论 | [实验索引](docs/research/EXPERIMENTS.md) |
| 参与开发 | [贡献说明](CONTRIBUTING.md)、[测试](docs/development/TESTING.md)、[目录说明](docs/development/REPOSITORY_LAYOUT.md) |
| 查找其他文档 | [文档地图](docs/README.md)、[发布记录](docs/releases/README.md) |

Simple 是跨实验使用的单环强基线，独立于某一次实验维护。
已完成的任务级研究支持保留 Simple、不采用所评估的 full 或对齐 DUO；
对齐研究的严格科学状态仍为 `UNRESOLVED`。产品流程可用与方法优越性是两项不同的结论。

双环思路受 Wang 等人的 [*Self-Evolving Recommendation System*](https://arxiv.org/abs/2602.10226)
启发；本项目是独立适配，不继承论文结果。[MIT 许可](LICENSE) ·
[来源与第三方说明](docs/THIRD_PARTY_NOTICES.md)。
