# DUO 0.5.0 产品底座验收报告

本轮范围为 Product Foundation & Productization。产品本地验收、独立 Agent 使用、GitHub CI／全新依赖安装均已通过。
PRODUCT FOUNDATION COMPLETE；PRODUCT ACCEPTANCE PASS（在下述支持边界内）。
最终收据位于根目录 PRODUCT_ACCEPTANCE.json。方法有效性研究暂停，历史结论保持不变。

## 实际交付

- Core 保留已有优化生命周期。内容身份、Delta 历史校验与投影交给 Target
  adapter；新增自定义 Target 不再要求改 Core 中的 persona/config 分支。
- discovery、Target kind schema 和 CURRENT_STATUS 使用同一能力来源。
  Persona 明确支持，fetch config 明确 partial，不把一次搜索当完整支持。
- 默认包只提供准备并等待工作 provider，不再默认启用研究 fixture。
  Evaluate／Optimize 使用既有设计与执行接口，保留预算、权限和 plan 检查。
- 复用 Cordis 的 Generator、Executor、Evaluator、Comparator、Gate、
  Feedback/History 替换入口。没有新增调度器、模型运行时或预算系统。
- 错误统一提供原因、恢复条件、下一动作以及费用／副作用的未知状态。
  不用报错字符串猜测是否执行或扣费。
- 安装包自带 `duo` 入口和公开示例：evaluate、optimize、BYO evaluator、
  替换 history、warm start，另有 setup 与 custom Target 示例。
  它们通过真实 DSH CLI／ToolRuntime 执行，不依赖作者 profile、研究脚本或旧账本。

## 验证证据

| 验证 | 结果及边界 |
|---|---|
| 原生 JavaScript 回归 | 295 通过，含最终 evaluate preset 修复后的完整重跑 |
| Python 产品回归 | 451 通过；86 项依赖历史研究档案的测试明确排除，未算通过 |
| 已有真实 DSH profile 场景 | 21 通过，保留 legacy/fixture 兼容性验证 |
| 安装后公开产品路径 | 10 个隔离 profile，80 个步骤，55 项检查通过 |
| 实际 tarball 安装 | DSH plugin add、自动 bundle 注册、文件字节、配置与 bin 通过；本地使用已有 host peers |
| 独立 Agent | 只读六份安装后公开文档；43 次 CLI 调用、六个完成运行；人工介入 0、实现者介入 0 |
| 独立 Agent 复核 | 四处文档修正及 evaluate preset 推荐已在新 profile 复核通过 |
| 全新依赖与远端 CI | 最终 34860825068 全绿；实际安装 profile 完成 plan/run/report，十项内层操作结算 CNY0 |

独立 Agent 自己准备契约、检查计划、执行、读取报告与预算，并完成自定义
Target、真正替换 Feedback、warm start、暂停和恢复。它曾故意不传恢复
checkpoint，收到 DUO_RESUME_REQUIRED 后使用公开状态自行恢复。原 deadline
和已结算 baseline 操作保留，未重复费用。终态复读只改变 reusedArtifacts 标记。

六个独立运行合计 52 个已结算内层操作，CNY 0；没有新模型 API 请求。
外层 Coding Agent／平台没有提供费用收据，不能把内层 CNY 0 说成外层也免费。
独立验收还保留了两次 Caller 自行纠正的理解错误和全部证据哈希。

## 精简与保留

当前 README 由 215 行收敛为 43 行，Agent Guide 由 100 行收敛为 23 行，
Reference 由 509 行收敛为 31 行；高级接口仍在公开 Provider 指南中。
旧文档按原字节归档，历史实验、候选、评分、Journal、成本和 final 消费状态未改。
这些行数变化不等于整个仓库 LOC 下降：新增示例、验收和保留历史也占用文件。

消除的重复包括 Target kind 列表、Core 中的具体内容识别、重复报错构造、
源码 fixture 实现副本，以及多个“当前状态”叙述。没有删除预算、未知费用停止、
证据筛选、恢复校验或仍兼容的 legacy API。Python legacy 单独保留 0.1.0 版本。

## 失败记录与修正

保留了 config warm/custom Target 的初始失败测试、CLI 符号链接导致依赖解析
失败、Cordis id/name patch 未实际替换插件、漏传历史 projector 的测试调用、
错误 targetKinds 声明，以及 evaluate preset 推荐使用未合并 draft 的问题。
每个实际修复都有复现与后续验证，不覆盖失败记录。

独立 Agent 发现四处旧文档陈述，已更正并复核；通用 nextSteps 的 provider
角色列表仍提及 Generator，具体 evaluation-only 指南和 runtime 正确不要求
Generator。该处非阻断措辞已记录。npm registry 在本地发生 TLS EOF，未绕过
TLS、未假装全新依赖安装成功；该项由远端 CI 实际验证。

## 使用边界

- 支持 Linux／Node 24 和已测试的 DSH 0.1.2-rc.1／Cordis 4.0.2。
  Windows、macOS 与 TypeScript 语义编译未验收。
- Config Target 仅允许已有 maxBodyChars 范围，真实 fetch 执行仍为可选研究
  source example；不是任意插件配置优化平台。
- Provider 是可信进程内代码，声明权限不等于隔离恶意插件。原生账本仅覆盖
  内层操作。未知费用不能靠重复调用查明。
- 恢复只支持输入与 provider 不变、费用结算清楚、原 deadline 内的 checkpoint。
  不保证任意崩溃恢复，不自动采用候选，不发布 npm。
- 本地示例测量文本格式，Fast/Slow 使用相同测量且没有独立 final。
  因此优化即使改善开发文本，也正确返回 insufficient_evidence；不能据此
  声称 LLM Agent 质量改善、高保真评估或 DUO 方法胜出。

这次交付证明可安装、可发现、可组合、可按公开接口使用的产品底座。
原研究结论仍是：没有证明 DUO 相比合理单环具有普遍质量或费用优势。
不会自动开启下一个方法实验。

最终验证提交：2ac54514ecc56e78364224e669337be800f2e6d2。
安装包 SHA-256：a1e02c25d7ded2ab184bc4cb6713b4c58ff3dd6afd5b762c5bba33a165d653c2。

CI 首两次安装失败保留。已查明旧 dsh-tools peer 范围不包含实际宿主版本；
单独更换 pnpm 未解决，修正 peer 声明并增加六项语义版本检查后通过。最终 CI
也验证了真实安装目录中的依赖图，并非只验证重新复制的示例目录。封存报告的
后续提交只改验收文档，不改变最后一次 CI 已验证的运行代码、包内容或测试输入。

最终状态：PRODUCT FOUNDATION COMPLETE；PRODUCT ACCEPTANCE PASS；
KNOWN LIMITATIONS 如上；RESEARCH NOT PROVEN。不会自动开始下一阶段研究。
