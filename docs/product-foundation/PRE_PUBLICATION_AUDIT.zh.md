# DUO 0.6.1 公开前仓库审计

日期：2026-09-16。结论：**NOT_READY_FOR_PUBLICATION**。
本地代码、产品回归和发布材料审查已执行；存在一条复现的自定义
Target 接口问题，以及尚未完成的外部发布检查。不能把这份报告当成
全库无缺陷证明、安全认证、已发布回执或方法有效性证明。

审查遵循先冻结的 [13 项验收标准](PRE_PUBLICATION_ACCEPTANCE.md)。
可机器读取的状态见 [PRE_PUBLICATION_EVIDENCE.json](../../PRE_PUBLICATION_EVIDENCE.json)。
原 Product Foundation、Slow evidence 和研究 Goal 的历史状态不变。
本轮不修改核心、生成候选、开展 benchmark、调用付费模型或更改 GitHub 可见性。

## 版本与审查范围

- GitHub 实时只读核对：`CZ-ZL/duo` 为 PRIVATE；main 为
  `6bca9cb6c2a9b4fc88c02e699c1a631d6d7f2f66`。v0.5.0、v0.6.0 tag 对应提交
  都在本地已扫描历史中。0.6.1 工作区尚未提交或上传。
- 初始工作区 419 个受版本管理或拟交付文件；加入验收标准后的首次扫描
  420 个文件，覆盖全部 16 个可达提交的 593 个历史文件对象和提交说明。
  新增发布文件在收尾扫描中另行核查，不冒称属于首次扫描。
- 当前安装包 69 个成员，重新打包与前次冻结包 SHA256 一致：
  `5fe28bdf5d041e6c2c955afde2737b04dc25610d2909663f8d68e4eff6e8ebf4`。
  本轮发布文档和来源说明不进入该运行包。
- 自动检查覆盖文件清单、签名式凭据扫描、归档成员/exports/版本/许可、
  本地文档链接；人工追踪公开入口、控制器、预算/Journal、证据策略、
  Target、反馈/history 和结果路径，并检查现有回归与安装证据。
  **没有声称逐行证明全部研究脚本或第三方依赖的正确性。**
- 实时检查 2 个旧 GitHub Release、5 个发布附件、8 个 CI artifacts 的清单；
  Release 正文和全部 5 个附件已下载检查，包括两个旧运行包。
  issues/PR 列表及 issue、PR review、commit comments 当时均为 0。

## 最高优先级发现：自定义原版 ID 被接受，但 final 仍依赖固定字符串

**F01 / P1 / FACT / 未修复，阻塞公开发布。**

公开 Snapshot 类型允许字符串 ID；Target 提供内容 identity。
计划检查接受 `snapshot.id = original`，但
[controller.js](../../dsh-plugin/native/controller.js) 的 final 和结果分支仍用
字面量 `baseline` 判断原版；[observer.js](../../dsh-plugin/native/observer.js)
的部分统计也有同类假设。

使用现有 Cordis 测试宿主、固定免费 Executor/Evaluator、零代生成做了
一个两条件对照，只改变 snapshot ID。未修改实际产品代码或历史数据：

| 原版 ID | plan | 结束状态 | final 记录 ID | 原生操作 | 费用 |
|---|---|---|---|---:|---:|
| `baseline` | 接受 | completed / retain_baseline | baseline | 6 | ¥0 |
| `original` | 接受 | failed / DUO_EVIDENCE_INVALID | original、original | 8 | ¥0 |

第二种情况执行了重复的 final，然后 comparator 报 `Duplicate candidate evidence`。
当前错误分类把它指向 Evaluator，真实触发点是控制器的身份判断。
**INFERENCE：**在付费 provider 下可能产生预算范围内的额外无效评估费用；
本次没有付费调用，不能给出真实金额或断言已经造成用户损失。

内置 Target 和现成 custom 示例都使用 `baseline`，因此 333 个原生回归通过
并不能排除这个接口反例。它不推翻原内置路径的验收，也不应被归入优化效果研究。

最小后续任务：统一使用 plan 中实际的原版身份，检查同一 final/report 路径的
字面量假设；补入上述回归，并验证选中候选、未选中候选、evaluate-only 和
报告计数。保持评分、预算和晋级策略不变。修复后重建冻结包并重跑受影响的
测试与发布门禁；本次哈希不能用于声称修复后的包已验证。

## 其他发现与本轮实际修改

| 编号 | 发现 | 处理及验证 |
|---|---|---|
| F02 | Changelog / 发布流程仍停在 0.6.0；TESTING 写旧示例数量 | 增加 0.6.1 候选发布说明，更新版本入口与 11 profiles /63 checks /85 steps，保留旧验收 |
| F03 | 第二组 BigCodeBench fixture 缺少就近来源说明 | 核对 36 个任务 ID/input 与已有归属样本全部一致；增加 NOTICE/PROVENANCE 和第三方清单条目。数据及评分原字节不变 |
| F04 | baseline-repair 已进 release gate，但 CI 上传未覆盖其 JSON/stdout/stderr | 补齐三个精确目录 glob；本地核对可匹配已有 5-case /26-command 证据，远端实际上传仍待新 CI |
| F05 | 候选仓库 DESIGN 有 3 个错误相对链接；研究文档状态容易误当当前状态 | 修复 3 个当前入口，给历史模型/benchmark 指南添加明确边界。只保留历史内容，不重写研究结论 |
| F06 | 发布材料缺少集中说明的最短验收、升级和故障处理路径 | 增加 RELEASE_QUICKSTART.md，双语 README 提供入口；实际 DSH 本地执行最小 evaluate 流程验证其操作与预期 |

首次 Markdown 扫描得到 274 个不解析的本地链接：185 个属于只读上游文档摘录，
77 个属于 docs/history 快照，9 个指向明确不分发的研究 runs 档案，3 个属于上述
DESIGN 错链。后 3 个已修复。其余保留并分类，不作为 271 个新产品缺陷；
当前默认安装/使用说明不依赖那些档案。研究历史不能据此声称可在干净仓库完整重放。

## 事实职责图与代码评价

| 职责 | 当前实现 / 公开边界 | 审计判断 |
|---|---|---|
| discover / prepare | onboarding、capabilities、contract；describe/design/schema | 一个内置能力源；准备入口不需要先绑定全部工作 provider |
| Target / Delta | TargetService、target-protocol；persona/config/custom adapter | 内容身份和 Delta 投影在 adapter；内置 config 明确 partial；F01 暴露原版 ID 的残余假设 |
| 生命周期 | controller + 同文件 EvaluationController；deferred-runtime | evaluate 复用生命周期并移除 Generator 依赖；未另造执行器；主要复杂度集中在 controller |
| 生成 / 执行 | GeneratorService / ExecutorService；model、structured 与 local providers | 通过 Cordis 替换；特定 persona/响应格式留在具体 provider，默认本地路径无模型授权 |
| Evidence / Slow | EvaluatorsService；evidence-source / evidence-strategy | provider 产生测量；声明不是认证；价格不参与 fidelity 判断 |
| 聚合 / 晋级 / feedback | Comparator.aggregate、Gate.decide/select、Feedback.summarize/orderHistory | 现有可替换接口；分 scope 比较，不默认跨来源加总分数；无 Graph/Bayesian 实现 |
| 状态 / 预算 / 恢复 | store.js 中 SqliteJournal、ReservedBudget；tools/status/budget | 账本预留、未知费用阻断、绑定回执、原期限 checkpoint；存储与预算是配对替换边界，不是任意独立后端 |
| history / 结果 | warm-start、observer、observer-tools | 历史按模式/版本筛选，final 不反馈搜索；F01 的报告身份假设需随控制器一起处理 |

Core 已有可复用的产品骨架；本轮没有发现需要推倒重建的证据。
controller 约 1,133 行、store 约 900 行、onboarding 约 789 行，是后续维护重点，
行数本身不构成本轮阻塞。一行 re-export 文件保留公开兼容路径，不能仅为减 LOC 删除。
研究 fixture 不在运行包中，公开 legacy Python API 保留独立边界。

## 验收矩阵

| 标准 | 本轮状态 | 证据与界限 |
|---|---|---|
| A01 仓库/历史暴露 | PARTIAL / BLOCKED | 当前树、历史、运行包、旧 Release 附件未命中既定凭据规则；8 个 workflow archives 内容尚未检查完 |
| A02 许可/依赖 | PARTIAL / BLOCKED | 许可和遗漏归属已整理；6 个宿主 peer 范围检查通过；在线 advisory 查询失败，不能称依赖无漏洞 |
| A03 架构/插件接口 | FAIL | F01 免费对照复现；现成内置/custom 示例通过不替代此反例 |
| A04 能力/准备 | PASS（所测范围） | 新原生回归、生成文档一致性；安装后 preparation 证据为前次同包结果 |
| A05 证据模式/校准 | PASS（工程） | 新原生回归；前次同包 4 个固定控制与 31 个 Slow evidence 检查；无方法收益结论 |
| A06 预算/权限/账本 | PASS（所测边界） | 原生/产品测试覆盖；provider 可信、宿主权限和 Caller 外层费用限制保留；F01 额外操作单列 |
| A07 恢复/报告 | PASS（既有支持路径） | 已结算且实现未变的 checkpoint；旧报告/恢复证据复用，F01 自定义身份路径除外 |
| A08 warm start | PASS（工程） | 模式/版本改变、control/final 隔离和消费相关回归；不把历史意见当当前独立 final |
| A09 干净安装 | BLOCKED | 本轮 fresh registry store 再次安装失败；前次 cached-host 安装通过不可顶替 |
| A10 回归/CI | PARTIAL / BLOCKED | 新 333 native +451 Python 产品测试通过；0.6.1 exact-code CI 尚未运行 |
| A11 独立 Agent | 限定复用 | 已有 0.5/0.6 与 round-2 独立 Caller 证据；最终 preparation 修复只有脚本验收，不声称全新 Agent 重验 0.6.1 |
| A12 发布文档 | PASS（本地） | 新版本说明、双语入口、故障/回退、归属和文档检查；历史链接缺项明确分类 |
| A13 分发回执/授权 | NOT_RUN | 版本/包哈希已记录；新 commit/CI/delivery/public visibility 回执尚不存在 |

## 实际测试、复用与失败记录

**本轮新运行：**

- Native：333 PASS /0 FAIL；Python 产品：451 PASS /86 research deselected。
- 格式检查、公开 TypeScript 声明、重新打包、69 成员/许可/export/宿主 peer
  和源字节检查通过；生成文档检查通过。
- 最小 evaluate quickstart 通过真实 DSH 公共 CLI 执行；独立 Agent 判断未重跑。
- F01 的两条件诊断完成并发现反例；不是“所有额外检查通过”。

**前次证据复用：**同一冻结包的安装后 63 checks /85 steps /11 profiles；
cached-host install；Slow evidence 31 checks；baseline repair 5 cases；DSH 21 profiles。
运行包逐成员与当前源字节一致。本轮没有再次声称完成这些整个场景集。
0.6.0 的成功 [GitHub CI](https://github.com/CZ-ZL/duo/actions/runs/34880960554)
属于 `5a45eb9`，不能当作 0.6.1 的 CI。

**外部未完成：**

1. 新依赖安装：`ERR_PNPM_META_FETCH_FAIL`；不禁用 TLS，不自动换源。
2. 开发依赖在线 advisory 查询：`Client network socket disconnected before secure TLS connection was established`。
   运行时宿主完整依赖图的 advisory 也未完成，不能推断无漏洞。
3. GitHub workflow artifacts：最初请求的 Accept 头不兼容（HTTP 415）；
   修正请求后，第一个 archive 下载 40 秒超时，停止后续重试。
   8 个 archive 均未完成内容扫描，未删除任何历史证据。

本地审计脚本还有一次输出目录计算错误、一次不支持的 gh `--slurp` 参数，
以及一次 npm user/global config 指向同一空文件错误；均在实际查询前失败，
纠正后保留原始日志。它们是审计工具调用错误，不冒充产品缺陷或成功证据。

## 凭据、数据和明确限制

扫描当前文件/历史的 private-key、provider-token、literal-credential、URL
内嵌认证签名未命中；不是熵扫描或专业渗透测试。27 个当前作者路径命中、
34 个历史路径命中经分类均为研究样本、旧回执定位或 legacy 源脚本路径。
当前及旧发布 tarball 没有这类命中。原始本地私有 profile/账本未读取或分发。
Git 作者身份仍随原历史保留，实际公开授权应包含对此暴露面的确认。

旧 CI logs、wiki/discussions 或未来新附件不因本轮检查自动获得安全结论；
已扫描对象之外的公开面必须在实际可见性变更前核对。

**本轮新增外部模型 API 请求：0；新增模型费用：¥0。**
本地 fixture/CLI 诊断的零费用不代表 Calling Agent 宿主推理免费。
原实验结论、候选、final 数据、Journal 和历史费用不变。

## 下一任务与退出条件

优先完成 F01 的最小身份一致性修复及对应回归。随后对修复后的包在可访问
依赖 registry 的环境完成固定 release gate、advisory 和旧 CI artifact 审查，
取得 exact-code CI/包哈希/分发回执。公开可见性和 npm 发布仍需各自授权。
不新增业务题、不重跑方法对照、不做 Graph/Bayesian、不自动部署候选。

本地完整原始记录保存在工作区
`dualloop/runs/pre-publication-audit-20260916/`：BEFORE、repository-scan、
remote-readonly、github asset inventory/scan、gate、native/Python、baseline-id-probe、
quickstart、差异和最终文件清单。该目录不随仓库公开；本报告是脱敏摘要。
无需新会话即可继续，但本轮没有承诺后台运行。
