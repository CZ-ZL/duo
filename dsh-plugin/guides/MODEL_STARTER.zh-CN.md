# 真实任务 starter

[English](MODEL_STARTER.md) · [简体中文](MODEL_STARTER.zh-CN.md)

先完成[安装与免费检查](../QUICKSTART.zh-CN.md)，在当前 shell 保留 `DUO_PACKAGE` 和 `DUO_DSH_PACKAGE`。本路径使用你已明确授权的模型配置和额度。

**验收状态：**独立 Caller 已按公开指南完成真实 starter，使用评估器 v2。
原版与生成候选平分，最终保留原版，见[运行记录](https://github.com/CZ-ZL/duo/blob/main/docs/product-foundation/first-use/STARTER_RESULT.json)。
这验证产品使用路径；本次没有独立 Slow 或 final 测试。

样例 Agent 根据虚构的部署手册回答问题。DUO 先测原提示词，再让模型生成一个
Delta，执行候选并测量输出。评估器检查实际命令、端点、引用，以及文档未提供
SLA 时是否明确不回答。它不会执行部署命令。

评估器 `starter-runbook-fast` v2 精确检查事实与引用，忽略首尾空白和一层完整的
行内代码反引号，不从解释性文字中提取答案，也不接受不同的命令或端点。
逐题 `answerExact` 另行记录原始答案文字是否精确匹配。下表生成路径相对于 `DUO_WORK`。

| 输入 | 随包模板 / 生成的工作文件 |
|---|---|
| 可编辑提示词 | [target.txt](../examples/model/target.txt) → `target.txt` |
| 公开样例文档 | [runbook.md](../examples/model/runbook.md) → `runbook.md` |
| 四道题与预期答案 | [tasks.json](../examples/model/tasks.json) → `tasks.json` 与执行快照 `dataset.json` |
| 内容与引用评估器 | [evaluator.js](../examples/model/evaluator.js) |
| 模型及费率配置 | [model.example.json](../examples/model/model.example.json) |
| Provider 组合和实验配置 | 自动生成的 `dsh-home/profiles/duo-product/cordis.patch.yml` 与 `experiment.json` |

此 starter 支持现有 `deepseek-official / deepseek-flash` 路由。
其他组合见 [Provider 契约](../PROVIDERS.md)。这些模型 provider 针对
persona/prompt；只换 Target 不会使它们自动兼容其他对象。

### 提供模型配置与授权

复制模板到自己的文件，按[官方价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)
核对费率与时段规则，再将 `verifiedDate` 记录为当前 UTC 日期。
不能只改日期而不核对费率。过期费率会在付费执行前被拒绝。

```sh
cp "$DUO_PACKAGE/examples/model/model.example.json" "$PWD/duo-model.json"
export DUO_MODEL_CONFIG="$PWD/duo-model.json"
```

调用方提供：DSH 安装路径、模型配置文件引用、新工作目录、环境中的已授权
`DEEPSEEK_API_KEY`、人民币额度。使用已有的凭据注入方式，不把密钥写入
JSON、命令参数、profile、报告或 Git。

正常完成最多 **3 次模型请求**：执行原版、生成一个候选、执行候选。
每次执行批量回答四道题。本地评分不额外调用模型，自动重试关闭。
非法输出会保留，可能使这条路径无法完成。模板费率下，三个请求的保守预留
总额为 CNY0.30；这不是预计消费，也不是授权。

没有授权时，可以先准备：

```sh
export DUO_WORK="$PWD/duo-qa-preparation"
node "$DUO_PACKAGE/bin/duo.mjs" init --root "$DUO_WORK" --dsh-package "$DUO_DSH_PACKAGE" --example grounded-qa --model-config "$DUO_MODEL_CONFIG"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_describe
```

付费工作的 plan/run 会被阻止。看到 provider 已加载不代表已有执行权限。

获得授权后另选目录，将 `DUO_AUTHORIZED_CNY` 设为用户实际批准的上限。
下面的命令要求这个值已存在，不替用户填正额度：

```sh
: "${DUO_AUTHORIZED_CNY:?Set this to the owner-approved CNY limit; do not invent a budget}"
export DUO_WORK="$PWD/duo-qa-run"
node "$DUO_PACKAGE/bin/duo.mjs" init --root "$DUO_WORK" --dsh-package "$DUO_DSH_PACKAGE" --example grounded-qa --model-config "$DUO_MODEL_CONFIG" --allow-paid --max-cost-cny "$DUO_AUTHORIZED_CNY"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_describe > "$DUO_WORK/describe.json"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_plan --args '{"view":"summary"}' > "$DUO_WORK/plan.json"
cat "$DUO_WORK/plan.json"
```

运行前检查：模型、Target 路径、Evaluator、数据集、一代一个候选、basic
模式、没有 Slow/final，以及授权上限。工作文件可以编辑；准备后改任务要修改
真正用于执行的 `dataset.json`，单独改 `tasks.json` 或 `runbook.md`
不会重建快照。预期答案须与文档匹配；变更测量时更新数据/评估版本并重新
plan。运行开始后不再改数据。

### 执行并读取结果

```sh
export DUO_PLAN_DIGEST="$(node -e 'const p=require(process.env.DUO_WORK+"/plan.json");if(p.isError)throw Error(JSON.stringify(p.error));process.stdout.write(p.value.planDigest)')"
export DUO_RUN_ID="$(node -e 'process.stdout.write(require(process.env.DUO_WORK+"/plan.json").value.runId)')"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_run --allow-paid --args "{\"planDigest\":\"$DUO_PLAN_DIGEST\"}" > "$DUO_WORK/run.json"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_status --args "{\"runId\":\"$DUO_RUN_ID\"}" > "$DUO_WORK/status.json"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_report --args "{\"runId\":\"$DUO_RUN_ID\"}" > "$DUO_WORK/report.json"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_report --args "{\"runId\":\"$DUO_RUN_ID\",\"view\":\"summary\"}" > "$DUO_WORK/report-summary.json"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_budget_status --args "{\"runId\":\"$DUO_RUN_ID\"}" > "$DUO_WORK/budget.json"
cat "$DUO_WORK/report-summary.json"
```

报告包含候选身份、Delta、Fast 测量、选择依据、限制和内层累计费用。
`sessions/` 保留执行产物与用量，`journal/` 保留实验与费用凭据，
`calls/` 保留公开调用、返回值和宿主日志。替换为自己的任务后，这些文件可能
含私有内容，不要直接公开整个工作目录。

运行完成、候选入选、独立确认是三个不同状态。本例为
`single_fidelity / unavailable`，不声称独立 final 验证。保留原版也是有效
结果；候选非法或未执行不能算真实 starter 验收成功。不会覆盖原始
`target.txt` 来采用候选。

费用依据实际模型用量与冻结费率计算，已知用量的失败请求也计入；它不是账户
发票。Calling Agent 推理和本地计算资源不在 DUO 账本中，本地 provider
费用为零不代表总成本为零。费用无法核对、额度到限或候选未完成评估时停止，
检查保留证据后再决定是否单独授权重试。换工作目录不重置授权。
