# 快速开始

[English](./QUICKSTART.md) · 简体中文

这里有两条路径：[免费安装检查](#免费安装检查)用本地测量走完流程；
[真实任务 starter](#真实任务-starter)让模型生成一次提示词修改，再用原版和候选各回答四道文档问题。

前置条件：Linux、Node 24+、pnpm、已有 DSH 安装。已验证宿主为
DSH 0.1.2-rc.1 / Cordis 4.0.2。当前是开发者预览版，详见
[支持范围](./CURRENT_STATUS.md)。安装插件不会自动配置模型账号或授予费用额度。

## 安装到隔离 profile

0.6.3 是尚未发布的源码预览，真实验收待完成。以下命令把当前公开源码打成
本地 tarball 再安装；此步骤需要 Git 和 npm，无需安装源码依赖或构建。
保留 DUO_SOURCE_COMMIT 和 SHA256SUMS。校验文件记录本地产物，不是独立
签名的发布凭据。上一个 Release 仍是
[v0.6.2](https://github.com/CZ-ZL/duo/releases/tag/v0.6.2)，不包含新 starter。

在新工作目录执行以下 Bash 命令。只替换 DSH 路径：
`DUO_DSH_PACKAGE` 是含有 `lib/bin.js` 的已安装包目录，不是私有
profile 或密钥。其余路径在当前目录下创建。
如果 registry 无法访问，先阅读下方[复用宿主依赖](#复用宿主依赖安装)，再执行安装命令。

```sh
export DUO_DSH_PACKAGE=/absolute/path/to/node_modules/@deepseek-ai/dsh
export DSH_HOME="$PWD/duo-install-home"
export DSH_TELEMETRY_DISABLED=1
export npm_config_cache="$PWD/npm-cache"
git clone --depth 1 https://github.com/CZ-ZL/duo.git duo-source
git -C duo-source rev-parse HEAD > DUO_SOURCE_COMMIT
npm pack ./duo-source/dsh-plugin --offline --ignore-scripts --pack-destination "$PWD"
sha256sum dual-loop-dsh-plugin-0.6.3.tgz > SHA256SUMS
sha256sum -c SHA256SUMS
mkdir -p "$DSH_HOME/profiles/starter"
node --input-type=module -e 'import{writeFileSync}from"node:fs";writeFileSync(process.env.DSH_HOME+"/profiles/starter/package.json",JSON.stringify({name:"duo-starter-profile",version:"1.0.0",private:true,type:"module",dsh:{profile:{bundles:[],patchReload:"startup"}}}),{flag:"wx"})'
node "$DUO_DSH_PACKAGE/lib/bin.js" plugin --profile starter add "$PWD/dual-loop-dsh-plugin-0.6.3.tgz" --ignore-scripts --store-dir "$PWD/pnpm-store" --fetch-retries=0 --fetch-timeout=15000
node "$DUO_DSH_PACKAGE/lib/bin.js" --profile starter --dump-config
export DUO_PACKAGE="$DSH_HOME/profiles/starter/node_modules/@dual-loop/dsh-plugin"
node "$DUO_PACKAGE/bin/duo.mjs" --help
```

任一步失败就停止。安装依赖可能访问包 registry，但不调用模型。npm 缓存与 pnpm store 都保留在当前工作目录，避免写全局缓存。
遇到 ERR_PNPM_META_FETCH_FAIL 时保留输出，恢复 registry 连接后再重试，不关闭 TLS 校验。
安装对象是插件 tarball，不是 GitHub 仓库根目录。这些步骤不读取或改写日常
profile。保留安装包与校验文件，便于以后回退。

### 复用宿主依赖安装

如果已经完整安装 DSH 0.1.2-rc.1，DUO 可以使用该宿主已有的 peer 依赖，
适用于 npm registry 暂时无法访问的情况。这不会安装 DSH、补下载缺失依赖，
也不意味着真实模型调用可以离线完成。

在上面的安装代码块中，仅把 `plugin add` 命令替换为：

```sh
node "$DUO_DSH_PACKAGE/lib/bin.js" plugin --profile starter add "$PWD/dual-loop-dsh-plugin-0.6.3.tgz" --ignore-scripts --store-dir "$PWD/pnpm-store" --fetch-retries=0 --fetch-timeout=15000 --offline --config.auto-install-peers=false
```

随后继续执行 `--dump-config`、`--help` 及下方选定的任务路径。
如果在线安装已经失败，保留日志，在新的工作目录从头执行这些步骤。
这条路径使用 DSH 已有的宿主依赖解析，不复制私有 profile，也不需要手工链接模块。
pnpm 可能提示隔离 profile 中缺少 peer；必须通过发现和计划确认组件实际加载。
若组件缺失或版本不兼容，先停止并补齐所需宿主依赖，再运行任务。打包成功本身
不能证明加载成功。上面的标准 registry 安装路径仍然可用。

## 免费安装检查

示例修改给定文本的行尾空格，验证安装和运行流程，不测试 LLM 任务能力。
工作目录必须尚不存在。

```sh
export DUO_WORK="$PWD/duo-local-check"
node "$DUO_PACKAGE/bin/duo.mjs" init --root "$DUO_WORK" --dsh-package "$DUO_DSH_PACKAGE" --example optimize
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_describe > "$DUO_WORK/describe.json"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_plan --args '{"view":"summary"}' > "$DUO_WORK/plan.json"
cat "$DUO_WORK/plan.json"
```

检查计划中的 basic 模式、本地 provider、`paid:false`、`network:false`
和 CNY0，然后执行并保存报告：

```sh
export DUO_PLAN_DIGEST="$(node -e 'const p=require(process.env.DUO_WORK+"/plan.json");if(p.isError)throw Error(JSON.stringify(p.error));process.stdout.write(p.value.planDigest)')"
export DUO_RUN_ID="$(node -e 'process.stdout.write(require(process.env.DUO_WORK+"/plan.json").value.runId)')"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_run --args "{\"planDigest\":\"$DUO_PLAN_DIGEST\"}" > "$DUO_WORK/run.json"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_report --args "{\"runId\":\"$DUO_RUN_ID\"}" > "$DUO_WORK/report.json"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_report --args "{\"runId\":\"$DUO_RUN_ID\",\"view\":\"summary\"}" > "$DUO_WORK/report-summary.json"
cat "$DUO_WORK/report-summary.json"
```

预期运行状态为 `completed`、模式为 `single_fidelity`、没有 Slow 证据，
内层模型费用为 CNY0，`target.txt` 不变。候选可以在开发测量上入选，但由于
没有独立 final，结论仍为 `insufficient_evidence`；两者不是一回事。
重复读取报告不启动工作。

只评估时另建目录，将 init 改为 `--example evaluate`，
后续 describe/plan/run/report 步骤相同，不运行 Generator。

## 真实任务 starter

**验收状态：** 已实现并通过离线检查，真实模型与陌生 Caller 验收仍待单独
授权执行。离线检查不是一次已经跑通的真实演示。

样例 Agent 根据虚构的部署手册回答问题。DUO 先测原提示词，再让模型生成一个
Delta，执行候选并测量输出。评估器检查实际命令、端点、引用，以及文档未提供
SLA 时是否明确不回答。它不会执行部署命令。

| 输入 | 随包模板 / 生成的工作文件 |
|---|---|
| 可编辑提示词 | [target.txt](./examples/model/target.txt) → `target.txt` |
| 公开样例文档 | [runbook.md](./examples/model/runbook.md) → `runbook.md` |
| 四道题与预期答案 | [tasks.json](./examples/model/tasks.json) → `tasks.json` 与执行快照 `dataset.json` |
| 内容与引用评估器 | [evaluator.js](./examples/model/evaluator.js) |
| 模型及费率配置 | [model.example.json](./examples/model/model.example.json) |
| Provider 组合和实验配置 | 自动生成的 `cordis.patch.yml` 与 `experiment.json` |

此 starter 支持现有 `deepseek-official / deepseek-flash` 路由。
其他组合见 [Provider 契约](./PROVIDERS.md)。这些模型 provider 针对
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

## 错误、继续使用与组件替换

| 情况 | 下一步 |
|---|---|
| 缺少 Evaluator | 用 describe/design 查看缺项，恢复随包适配器或接入兼容函数，不能填假分数。 |
| `DUO_STARTER_MODEL_UNSUPPORTED` | 使用声明支持的配置，或按 Provider 契约接入其他组合；这次 init 未派发模型工作。 |
| `DUO_STARTER_AUTHORIZATION_REQUIRED` | 获得授权后修改工作目录的 `experiment.json` 权限和额度，再看新计划；此前保持零额度。 |
| `DUO_STARTER_CREDENTIAL_REQUIRED` | 从环境提供所需凭据；本次被拒绝的调用没有启动模型。 |
| `DUO_PLAN_CHANGED` | Target/provider/数据变更后重新检查计划，不复用旧 digest。 |
| 未知费用、待结算 receipt、锁或中断请求 | 检查保留的状态和账本；不自动重放、不清账、不把未知费用当零、不删除未确认的锁。 |

[Agent Guide](./AGENT_GUIDE.md)说明公开生命周期，
[本地示例](./examples/product/README.md)覆盖 BYO Evaluator、自定义 Target、
组件替换、warm start、取消与受支持恢复；完整边界见
[API 参考](./AGENT_REFERENCE.md)。

升级时保留旧包与 profile，先在新隔离目录检查新版本。换 provider 后重新
plan，不在变更的组件图下恢复旧检查点。退回旧版本不会撤销费用，也不授权重放。
