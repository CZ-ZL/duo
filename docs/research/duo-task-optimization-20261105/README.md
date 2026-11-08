# DUO 任务级优化研究：阶段结案

研究截止：2026-11-05；公开整理：2026-11-08。

**保留强 Simple，不采用当前完整 DUO 或本轮机制对齐方案，停止这一配置的追加实验。** 三项研究已经完成各自执行或决策收尾；对齐研究的严格科学状态仍为 **UNRESOLVED**。这不是所有未来 DUO 设计无效的证明。

| 研究 | 独立样本与结果 | 本阶段判断 |
| --- | --- | --- |
| 10/21 组件消融 | 48 条新搜索，54 项比较；主对照达标任务 0/3 | full 不替代 Simple；保留小幅收益和退化，不只报告胜项 |
| 10/26 固定候选池归因 | 12 条既有轨迹，0 条新搜索；候选池质量与选择损失并存 | 不能统一归因于 Fast Gate，未验证在线修复收益 |
| 11/05 机制对齐 | 72 条计划搜索，65 交付、7 失败；126 项比较有明确终态 | 不采用当前对齐包；科学资格未满足 |

阅读入口：

- [Simple 公共基线说明](../SIMPLE_BASELINE.zh-CN.md)：跨实验复用的方法、逐代流程和已有能力；[本阶段 Simple 配置](SIMPLE_BASELINE.zh-CN.md)记录具体版本和预算。
- [中文研究工作论文](WORKING_PAPER.zh-CN.md)：问题、主要效应、消融与归因、工程取舍。
- [结构化结果](RESULTS.json)：54 项消融、12 个候选池及 126 项对齐比较的精选字段。
- [方法与限制](METHODS_AND_LIMITATIONS.md)：分母、模型记录、失败、成本与可复现范围。
- [研究规则](RESEARCH_PLAYBOOK.zh-CN.md)：从这阶段提炼的通用实验规则。
- [来源与公开材料映射](PROVENANCE.json)：原报告 SHA-256 和派生关系。

这次发布整理既有结果，没有新增模型调用、原生性能测量或重新计算全部原始流。代码的离线测试与这些历史研究是不同的证据。

## English summary

We retain the strong iterative Simple baseline and do not adopt the evaluated full DUO composition or alignment package. The component study contains 48 independent searches and 54 comparisons; none of the three tasks meets its repeated primary adoption threshold. A retrospective analysis of 12 existing search trajectories finds both candidate-pool quality differences and selection loss. The alignment study delivered 65 of 72 planned searches; 105 of 126 comparisons completed, 17 lacked delivery and 4 failed timing qualification. Its strict scientific verdict remains UNRESOLVED. Missing and incorrect outputs are reported separately from timing regressions. These findings concern the tested tasks, implementations and protocols, not all future dual-loop designs.

## Data availability

This repository publishes curated result fields, interpretation and provenance hashes. Original journals, requests, raw timing streams, full task inputs, generated programs and runtime snapshots are retained locally and are not included here. Hashes identify sources; they do not provide access to those sources. This is a results publication, **not a complete independently reproducible experiment package**. No third-party task statements, solutions or datasets are redistributed in this update.
