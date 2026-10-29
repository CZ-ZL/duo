# Agent4Sci：通过 Harness 引导 Research Taste

> 类型：外部研究文献笔记（2026-10-29）。用于 DUO / RSI 后续检索和方法比较；**不是 DUO 已采纳的架构、实现方案或实验结果**。

## 来源

- 论文：Ming Zhong, Stacy Li, Nicholas Carlini, Matthew Jagielski (2026), *Automating ML for Science: Can Frontier Agents Climb Scientific Hills in the Wild?* — https://arxiv.org/abs/2610.28763
- **原始 GitHub 仓库**：https://github.com/maszhongming/agent4sci
- 开源数据：https://huggingface.co/datasets/MingZhong/agent4sci
- Harness/Skills 目录：https://github.com/maszhongming/agent4sci/tree/main/agent4sci/skills

## 核心判断

该论文既是自动科学 ML 研究的评测（Agent4Sci），也是一次**通过 Harness 诱导 research-like behavior** 的实验。作者观察到 Agent 能改善指标，但多数进展依靠常规 ML 工程手段，而非领域洞见；其问题包括新颖性判断失准、算力利用不足、过快转向局部调参。

这里将 **Research Taste（科研品味）** 作为理解框架：能否判断什么问题值得研究、哪些假设具有领域依据及新颖性、如何分配实验预算、何时放弃局部优化而调整研究方向。**这是对论文机制的解释，不是论文已证明或独立量化的能力指标。**

## Harness 的实际组成

论文公开的是**跨任务通用的三个 Skills**，它们不是三个独立 Harness，也不是给每个科学领域定制了一套 Skills。

| 组件 | 研究行为 / 具体设计 | 原始代码 |
| --- | --- | --- |
| Research Skill | 四路并行文献调研：领域知识×数据/模型、领域知识×训练/评估、通用 ML×数据/模型、通用 ML×训练/评估；按 Tier 1（高风险高回报）/Tier 2（有文献支持的常规方法）规划假设；记录 hypothesis、rationale、metrics、runtime 并校准新颖性。 | [research/SKILL.md](https://github.com/maszhongming/agent4sci/blob/main/agent4sci/skills/claude/skills/research/SKILL.md) |
| Experiment Skill | 优先尝试 Tier 1，独立实验目录、并行计算和 smoke tests；区分工程失败与假设失败，避免无诊断地退回保守调参。 | [experiment/SKILL.md](https://github.com/maszhongming/agent4sci/blob/main/agent4sci/skills/claude/skills/experiment/SKILL.md) |
| Checklist Skill | 定期审查是否陷入增量优化、是否放弃了高价值假设、GPU/任务是否被有效利用、是否需要 pivot。 | [checklist/SKILL.md](https://github.com/maszhongming/agent4sci/blob/main/agent4sci/skills/claude/skills/checklist/SKILL.md) |

此外，Harness 还包括：
- **Subagent**：文献调研子代理，输出带引用的研究综述；[定义](https://github.com/maszhongming/agent4sci/blob/main/agent4sci/skills/claude/agents/literature-review.md)。
- **Hook**：Claude 路径使用每小时触发的工具 Hook，提醒并强制进行 Checklist；[reminder.sh](https://github.com/maszhongming/agent4sci/blob/main/agent4sci/skills/claude/hooks/reminder.sh) / [settings.json](https://github.com/maszhongming/agent4sci/blob/main/agent4sci/skills/claude/settings.json)。**Codex 路径的 Checklist 是按需 Skill，不应误写为同样的强制每小时 Hook。**
- **Runner 与独立评估**：hill-climb 仅获取训练/验证数据；独立 evaluation 使用隔离测试集，auditing 检查评测操纵。这是实验可信度机制，不是上述三个 Skill。

### 领域通用与领域专属的边界

共享 Skills 定义“如何研究”；具体 benchmark 容器提供“研究什么”：`task.md`、原论文、基线代码、训练/验证数据、`CLAUDE.md` 或 `AGENTS.md` 等任务指令和评价指标。测试数据只在独立评估阶段提供。

因此，论文展示的是**通用研究工作流 + 任务专属上下文/环境**，没有证明作者为物理、生物、化学等领域各写了一套专门的 Research Taste Skills。

参见：[Benchmark image contract](https://github.com/maszhongming/agent4sci/blob/main/docs/image-contract.md)。

## 主要证据与边界

- 评测范围：20 个 benchmarks、25 个 tasks、11 个科学领域。
- 加入 Skills 后，论文报告 Claude Opus 平均相对提升从 **10.4% 到 20.1%**，Codex 从 **4.4% 到 8.1%**。这些是相对基线的任务性能改进，不是“研究品味分数”。
- PFDelta 2000 的案例提供了改变解题范式的具体例子：神经网络生成初值，再使用有条件的数值修正。但单个案例不足以证明广泛科研创新。
- 三个 Skills 由人类根据失败轨迹手工设计；**并未实现 Agent 自主发现与持续改写 Harness 的 RSI 闭环**。
- 成效可能依赖任务与模型特性；不要把“更大胆的假设”直接等同于“更好的 Research Taste”，也不要将论文结果直接外推到 DUO。

## 对 DUO / RSI 的可检验启发（尚未实施）

1. **研究策略与执行分离**：将提出假设/选择方向/预算决策与具体代码实验区分；保留明确的 hypothesis、rationale、metric、stop/pivot reason。
2. **研究价值与性能分开评价**：除了最终指标，还记录假设多样性、领域依据、失败诊断与新颖性；不能只用“实验更多”或“提升更大”推断真正科研能力。
3. **先做控制实验再集成**：如未来要借鉴，冻结任务与评测，分别比较基线 Agent、添加 Research、添加 Experiment、添加 Checklist 的收益及开销；尤其需要检查是否超过合理 simple loop，而非默认复杂 Harness 有效。
4. **独立评估与预算约束**：训练/验证和最终测试严格隔离；记录 tokens、时间、模型调用与失败成本；不能把开发集的局部收益当成可泛化改进。
5. **RSI 的进一步问题**：是否能在严格的外部评估下，让系统依据失败轨迹自动提出、检验、保留或回滚对“研究策略本身”的修改？这是潜在研究方向，**不是 Agent4Sci 已完成的功能**。

## 检索关键词

Agent4Sci; Automating ML for Science; Research Taste; research-like behavior; scientific agent; research skill; experiment skill; checklist skill; Hook; domain-general harness; task-specific benchmark environment; independent evaluation; auditing; RSI; DUO.
