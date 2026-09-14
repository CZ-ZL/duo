# DUO Slow Loop Product Semantics & Evidence Strategy 验收报告

状态：0.6.0 的修复、代码整理和本地产品验收已通过；私有 GitHub 交付进行中。独立于已经封存的 v0.5.0 Product Foundation 和所有历史研究 Goal。下文初始验收被复核发现的组合缺陷补充修正，不沿用旧版本的完成结论。

## 1. 正式定义与实际职责

Slow Loop 是有边界的证据获取与决策策略：接收当前候选及已有搜索证据，解释证据缺口，在冻结来源和授权预算内请求额外测量，结合分范围判断，输出 reject / hold / promote / request_more_evidence / stop。它记录 observed、inference、unknown，不生成统一 confidence，也不自称 ground truth。

Evaluator 负责执行测量并返回 evidence/metrics。Comparator 负责同一 evaluator/version/data/tier 内比较，并通过可选 aggregate 合并判断。Gate 通过 select 控制候选额度，通过可选 decide 决定是否获取下一份证据、继续或停止。Feedback 决定哪些安全的搜索信息进入下一代。Controller 仍然使用原来的执行、预算、Journal、取消与恢复机制。

没有新增四个 Service、SlowAgent、调度器、模型执行器或账本。目标对象和 Generator 算法没有重写。

## 2. 有无额外证据时的行为

| 情况 | 产品行为 | 可声称的验证范围 |
|---|---|---|
| Fast + 更接近目标、已声明有效校准引用及独立边界的来源 | high_fidelity，按策略获取证据 | 模式依据提供方的版本化声明；DUO 不自动认证声明的真实性 |
| Fast + 同族新增任务/边界/种子等覆盖 | expanded_evidence | 扩大实际覆盖，不因更多样本或更高价格声称更高保真 |
| 只有 Fast | optimize-basic/auto 继续 single_fidelity；slow_mode=unavailable | 只在可用开发证据上选择；不构成完整双环验证 |
| 强制 dual、额外证据不足 | structured preparation/refusal，执行前停止 | 指明缺少来源、可补齐方式或可显式选择 basic |
| 已有额外来源，但用户选择 basic | 来源能力仍显示 available，执行模式明确不使用 Slow | 不把主动不用误写成 provider 缺失 |
| 计划 dual，但候选未获得额外证据 | dual_loop_validation=NOT_OBSERVED，保留 hold/预算原因 | 不能因为计划了 dual 就说完成验证 |

完整双环要求实际取得候选的新增证据，并用于决策。昂贵 evidence 不是必需条件；免费 deterministic 扩展测试也可以增加信息。只有实际覆盖回执与计划吻合，才能通过新 preset 的晋级路径。没有收益、没有晋级或继续保留原版均为合法结果。

## 3. 实际修改

- evidence-strategy.js：共享来源说明、信息增量判断、模式协商、有限资源决策、来源回执与安全反馈投影。Source 描述测量、Target 范围、数据用途、工具执行、独立性、确定性、模型需求、版本、费用/延迟或 unknown。
- contract / onboarding / controller：evaluate、optimize-basic、optimize-dual、optimize-auto（optimize 为 auto 别名）。describe 显示当前模式能力；design 与 plan 使用同一判断；plan 重新检查当前 provider。
- Controller 的 preset 路径：先测 Fast；候选获得 request_more_evidence 后才购买缺失的 incumbent 额外测量。原有账本仍逐次 reserve/settle。预算不足 hold，不自动扩额；policy stop 停止后续搜索与 final。
- Comparator / Gate：增加可选 aggregate / decide 方法；保留旧 compare/select provider 的兼容适配。默认不把不同数据或 evaluator 的分数直接相加。
- Result / Report / Journal：optimization_mode、slow_mode、evidence_used、additional_evidence_acquired、evidence_gaps、decision_basis、limitations；降级在三个位置可见。回执有来源身份、版本与覆盖。
- Warm start：证据模式变化或缺失时只允许兼容历史想法，不把旧分数当成可比较证据。原有 final/raw/cost/permission 边界保留。
- Feedback / structured-generator：新决策通过安全白名单进入后续生成；不包含 final/raw 数据，旧显式反馈消融的隔离仍保留。未修改生成算法、模型或操作符。
- 默认公开文本示例只用 Fast；dual 示例额外执行模板边界断言。新增模式验收接入现有 release gate。

## 4. 精简与发现的回归

去掉“顺序/费用自动意味着更可信”的表述；取消默认重复文本检查；不再提前购买未使用的 Slow baseline；同一新增覆盖不重复购买。

完整来源说明曾重复进入 plan、逐条回执与 Journal，导致旧 Caller 在 56,612 字节处被 53,248 字节的冻结上限拒绝。保留失败与预算守卫，未提高上限。完整说明集中保留在 plan，逐次回执保留身份/版本/覆盖；相同 requestedSpec 不重复保存，显式 summary 不重复展示详细声明。未裁剪历史。相关 9 个 Caller/限额/未知费用用例随后通过。

另外修复了不完整草稿访问缺失 budget、公开 unknown direction/Target metadata 被误判为不兼容的问题。普通 Fast 测量不强制补齐额外 Slow metadata。所有初始失败日志保留。

## 5. 逐项验收映射

| 用户测试要求 | 实际证据 |
|---|---|
| Fast + 独立额外来源 → high_fidelity | slow-evidence.test.js：冻结正确/错误/边界错误控制；mode、实际覆盖、result/report |
| 更多同族覆盖 → expanded_evidence | 同文件；公开 tarball dual 示例实际新增模板断言与回执 |
| 只有 Fast → single_fidelity | basic 实际完成；slowAttempts=0 |
| 强制 dual 无 Slow | plan 拒绝，公开 profile 无 run ledger；prepare 给出缺口 |
| Slow 卸载 → 旧 plan 无效 | 实际 Cordis disposal/replacement；旧 digest 拒绝，未派发新工作 |
| 昂贵但无新增信息 | 纯本地声明测试：模型名和费用不影响 qualification，不派发付费工作 |
| Result 区分模式 | run、report、公开工具；有计划无实际候选证据标为 NOT_OBSERVED |
| Warm 模式不混淆 | warm-start.test.js：不同模式同测量身份仍 ideas_only |
| Journal source/version | 独立来源事件与实际覆盖记录；公开 profile 复核 |
| 无静默降级 | auto plan/result/Journal 的 downgrade 一致 |

附加检查：预算不足不购买额外证据；声明新增覆盖但回执缺失时 hold；可替换 Gate 能 hold/stop；stop 不继续 final；结构化生成保留安全决策并隔离 final；重复覆盖拒绝；旧 evaluator 缺少可选 metadata 仍可 basic。

初始 S0–S5 验收结果（历史记录，不代表当前修复版本）：

- Native：315 passed（native-accepted.log，最终代码）。
- Python product：451 passed，86 research deselected（python-product-final.log）；保留前次 448 passed / 3 failed 和两轮修复记录。
- 原有公开示例：10 profiles / 80 steps / 55 checks（public-examples-verified，随后只新增 describe 当前模式展示；该变更另有当前包验收）。
- 最新 tarball 公开模式：4 个全新 DSH profiles / 22 步 / 31 checks（public-slow-accepted），包含 describe 当前模式与实际 request-before-Slow 次序。
- 原有 DSH 宿主兼容：21 profiles passed（host-accepted/report.json，21 profiles PASS）。
- tarball：64 个文件、所有导出与本地文档链接、6 个 host peer 范围检查通过；docs sync / git diff --check / release gate shell syntax 通过。
- tarball SHA256：`f657c8fd0d4f477313f7beeae0b349044e4e8705f36ba4dc5d0943558e7dd40e`。

证据保存在 `dualloop/runs/slow-evidence-strategy-20260915/`。包为该目录下 `package-accepted/dual-loop-dsh-plugin-0.6.0-dev.0.tgz`。最终字节由 frozen-inputs.json 绑定。没有远程 CI 或新注册表安装验收的声明；实际 tarball 在已有 DSH 上以隔离 profile 运行。

上述历史测试为工程/本地产品行为。当前版本的独立 Caller 和完整 gate 另行验收；两者都不能证明高保真来源的通用可靠性或优化收益。

## 6. 公开 Agent 使用入口

先读 AGENT_GUIDE.md 与包内 EVIDENCE_STRATEGY.md。通过 describe → design(preset) → 保存返回契约（保留 preset）→ plan → 授权 run → status/report。inspect evidenceStrategy，而不是从 mode 名称猜测真实验证强度。

可运行示例：`duo init --root NEW --dsh-package EXISTING --example optimize`（basic）或 `--example dual`（expanded）。来源、预算、版本变化必须重新 plan。代码路径不依赖作者私有 profile、旧模型账户或旧实验额度。

## 7. 插件位置与已知限制

Graph Structured Evaluation 将来接在 Evaluator/evidence reasoning provider；Bayesian 将来接在 Comparator aggregation 或 Gate decision policy，仅在有 reliability calibration 数据时考虑。本轮均未实现。

当前策略在预先冻结的来源顺序内请求/放弃下一来源，不自动发明测试、安装 provider、重新排序任意来源或计算 Expected Information Gain。默认聚合为分范围判断；并未学习可靠性权重。metadata/coverage 和 qualification 引用来自可信 in-process provider，不能替代独立认证或主机隔离。

不带 preset 的旧契约保留原执行/API；未证明信息增量的重复阶段会明确标 unavailable，不冒充完整 dual。新调用应通过 presets 获得避免重复获取的语义。旧实验和关闭 Goal 保持原状。

当前版本新增公开 TypeScript 声明及策略接口语义编译。跨平台、线上指标、人类评审和真实模型方法验收仍未验证。GitHub 交付状态以本轮验收记录为准；不发布 npm、不部署候选，方法研究保持暂停。

## 8. 费用与后续

新增外部模型 API 请求 0，真实 API 费用 ¥0，未转移/重置任何历史预算。离线测试包含明确标注的 scripted/fixture 模型适配与模拟费用失败控制，不把它们计作真实模型或效果验证。

本 Goal 已完成本地验收并封存报告、证据清单和队列。下一项是按需审查/集成本地变更；没有未完成的本轮必需开发任务。不会自动开启 benchmark、Graph、Bayesian 或下一轮研究。


## 9. Review 修复与整体代码整理

本轮复现并修复了三个组合缺陷：

1. 暂停 run 只按已花费用计入累计预算，会让新 run 占用它仍需使用的额度。
   现在累计准入保留未结束 run 的完整额度，实际准入在短锁内重新检查。
   未知费用、安全停止、货币隔离与原有单请求账本不变。
2. 先选最高分再检查证据覆盖，导致完整的次优候选也被一起 hold。
   现在按 Comparator 排名寻找第一个同时满足证据和 policy 条件的候选。
3. 自定义 Gate 允许多个候选时，Journal 可能出现多个本代 champion，实际
   结果却取第一个生成的候选。现在只有一个本代实际选择，其余保留原 proposal、
   selectedCandidateId 和 hold 原因；Journal、feedback、report 一致。

独立只读审查又发现了并发初始化的瞬间状态：schema/origin 分开提交，以及
claim 已存在但 budget 尚未初始化，会被误报为损坏。现在 schema/origin 同事务，
budget 在 claim 前初始化，并在锁内完成准入。真实双进程 Controller 探针分别
在两种提交时点暂停，第二个 plan 均返回 DUO_BUDGET_ADMISSION_BUSY，首个 run
正常完成。保留原始失败与修复复测，未修改历史研究结果。

整理覆盖产品代码和测试：统一格式、拆除 discovery/strategy 循环依赖、补全
Evidence/Gate/Comparator 类型、将格式与类型检查加入 CI。按 Prettier 规范化后
对比 HEAD，53 个已有 JS/TS 文件只有格式变化；另有 24 个含行为/协议变化的
既有文件，以及新增模块/测试。物理行数增加，不以 LOC 降低冒充精简。
未删除预算、证据、兼容 API 或历史负结果。

仓库根目录与安装包均提供英文/中文 README；当前能力仍来自统一 catalog。
安装、模式、插件替换、history 和恢复边界有明确入口。研究记录与产品说明分开。

## 10. 当前验收与交付

最终本地 release-gate-3 全部通过：

- 321 native tests；451 Python product tests；86 research tests 未运行。
- 21 个 DSH 宿主兼容 profile。
- 66 文件 tarball 的内容、导出、文档链接和 peer 范围检查；全新 dependency
  store/profile 实际安装、自动 bundle 注册、安装后 plan/run/report。
- 10 public example profiles / 80 steps / 55 checks；4 Slow mode profiles /
  22 steps / 31 checks；隔离执行控制、公开类型、格式与文档同步检查。
- 独立 Caller：7 个原始场景 + 新指南安装包 smoke，47 次 CLI 调用、48 次
  settled native operations；人工接线 0 次，Agent 自行按指南修改本地配置。
  原始与新版安装包分别保留证据，没有把只读源码当成使用验收。

当前安装包 SHA256：`71364e3a6b9085c19763f0551a8f1d594c77c7545da2e2398b68b935f27ae2d3`。
详细状态见 ACCEPTANCE.json / CALLER_ACCEPTANCE.json。未测量 Calling Agent
自身推理费用，因此不声称整个调用链免费。远程 CI 与 release 交付待完成。

本地 npm 官方 registry 连接重置；保留失败。随后显式选择镜像，下载了全新
依赖并记录 dependencyRegistry；没有改 TLS 或静默回退。GitHub CI 保持官方源。
当前没有新增真实模型请求，实际 API 费用 ¥0；模拟预算仅用于工程测试。


最终复跑前又发现并保留一次指南体积回归：449 Python tests 通过、2 项失败。
新的入口指南附录使 Caller 请求达到 54,214 bytes，超过原本 53,248 bytes
上限；未派发请求。去掉入口重复说明、将细节保留在 REFERENCE/EVIDENCE 文档后，
4 项 Caller 定向测试全部通过。没有扩大额度、删历史或放松守卫。安装包变更
逐文件核对，只有 AGENT_GUIDE.md 改变；独立 Caller 对新指南另做新 profile 复测。


独立 Caller 还记录了三个非阻塞体验问题，保留为已知限制：旧式平铺 stage 的
informationGain 提示仍写 legacy，当前模式要以 evidenceStrategy 为准；错误的
完整结构位于 content 中，CLI 顶层 error 较简略；design 的 draft_valid 表示草稿
合法，不等于 readyForPlan。Caller 依照公开指南成功理解并使用了相关路径。
本轮不因此重构状态系统或展开新架构。
