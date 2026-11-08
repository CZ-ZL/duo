# 故障处理与继续使用

[English](TROUBLESHOOTING.md) · [简体中文](TROUBLESHOOTING.zh-CN.md)

[安装与宿主兼容](INSTALL.zh-CN.md) · [快速开始](../QUICKSTART.zh-CN.md)

| 情况 | 下一步 |
|---|---|
| 缺少 Evaluator | 用 describe/design 查看缺项，恢复随包适配器或接入兼容函数，不能填假分数。 |
| `DUO_STARTER_MODEL_UNSUPPORTED` | 使用声明支持的配置，或按 Provider 契约接入其他组合；这次 init 未派发模型工作。 |
| `DUO_STARTER_AUTHORIZATION_REQUIRED` | 获得授权后修改工作目录的 `experiment.json` 权限和额度，再看新计划；此前保持零额度。 |
| `DUO_STARTER_CREDENTIAL_REQUIRED` | 从环境提供所需凭据；本次被拒绝的调用没有启动模型。 |
| `DUO_PLAN_CHANGED` | Target/provider/数据变更后重新检查计划，不复用旧 digest。 |
| 未知费用、待结算 receipt、锁或中断请求 | 检查保留的状态和账本；不自动重放、不清账、不把未知费用当零、不删除未确认的锁。 |

[Agent Guide](../AGENT_GUIDE.md)说明公开生命周期，
[本地示例](../examples/product/README.md)覆盖 BYO Evaluator、自定义 Target、
组件替换、warm start、取消与受支持恢复；完整边界见
[API 参考](../AGENT_REFERENCE.md)。

升级时保留旧包与 profile，先在新隔离目录检查新版本。换 provider 后重新
plan，不在变更的组件图下恢复旧检查点。退回旧版本不会撤销费用，也不授权重放。
