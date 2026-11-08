# Quickstart · v0.6.3

[English](QUICKSTART.md) · 简体中文

本页完成下载、兼容检查和一次免费本地运行，交付可保存的报告。
需要 Linux、Node 24+、Bash 和受支持的 DSH 安装。尚未安装宿主，先按
[安装与兼容性](guides/INSTALL.zh-CN.md)准备。此路径无需模型账号。

## 下载并检查

在空目录执行下面命令，只替换 `DUO_DSH_PACKAGE` 为宿主包的绝对路径。
每条命令成功后再继续；校验失败时不要解压或运行。

```sh
mkdir duo-0.6.3 && cd duo-0.6.3
curl -fLO https://github.com/CZ-ZL/duo/releases/download/v0.6.3/dual-loop-dsh-plugin-0.6.3.tgz
curl -fLO https://github.com/CZ-ZL/duo/releases/download/v0.6.3/SHA256SUMS
sha256sum --check SHA256SUMS
tar -xzf dual-loop-dsh-plugin-0.6.3.tgz
export DUO_PACKAGE="$PWD/package"
export DUO_DSH_PACKAGE="/absolute/path/to/node_modules/@deepseek-ai/dsh"
node "$DUO_PACKAGE/bin/duo.mjs" check-host --dsh-package "$DUO_DSH_PACKAGE"
```

宿主检查只读取包元数据，返回 `compatible` 才继续；它不修改 profile。
版本不匹配见[兼容说明](guides/INSTALL.zh-CN.md#兼容范围)。

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

- [真实任务 starter](guides/MODEL_STARTER.zh-CN.md)：接入已授权模型，比较文档问答提示词；包含任务、评估器、配置和预算检查。
- [Agent Guide](AGENT_GUIDE.md)：公开工具的调用顺序。
- [其他本地示例](examples/product/README.md)：自定义评估器、组件替换、历史复用和恢复。
- [错误与恢复](guides/TROUBLESHOOTING.zh-CN.md)、[安全边界](SECURITY.md)。

DSH 依赖仍是上游预览版。Provider 在宿主进程中运行，支持范围内的产品检查
不等于任意插件隔离或模型能力证明。原始 Target 不会被自动替换。
