# Quickstart · v0.6.3

English · [简体中文](QUICKSTART.zh-CN.md)

Download the release, check compatibility, and complete a free local run with a
saved report. Requires Linux, Node 24+, Bash and a supported DSH installation.
For a fresh host, follow [installation and compatibility](guides/INSTALL.md)
first. This path needs no model account.

## Download and check

Start in an empty directory. Replace only `DUO_DSH_PACKAGE` with the absolute
host package path. Continue only after each command succeeds; do not extract
or run an archive whose checksum fails.

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

The host check reads package metadata without changing profiles. Continue on
`compatible`; see [compatibility](guides/INSTALL.md#compatibility) otherwise.

## Free installation check

This example removes trailing spaces from a supplied text Target. It checks
installation and the full product flow, not an LLM's task ability. Choose a
directory that does not yet exist.

```sh
export DUO_WORK="$PWD/duo-local-check"
node "$DUO_PACKAGE/bin/duo.mjs" init --root "$DUO_WORK" --dsh-package "$DUO_DSH_PACKAGE" --example optimize
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_describe > "$DUO_WORK/describe.json"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_plan --args '{"view":"summary"}' > "$DUO_WORK/plan.json"
cat "$DUO_WORK/plan.json"
```

Inspect the plan: `optimize-basic`, local providers, `paid:false`,
`network:false`, CNY0. Then run and retrieve both the full and summary reports:

```sh
export DUO_PLAN_DIGEST="$(node -e 'const p=require(process.env.DUO_WORK+"/plan.json");if(p.isError)throw Error(JSON.stringify(p.error));process.stdout.write(p.value.planDigest)')"
export DUO_RUN_ID="$(node -e 'process.stdout.write(require(process.env.DUO_WORK+"/plan.json").value.runId)')"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_run --args "{\"planDigest\":\"$DUO_PLAN_DIGEST\"}" > "$DUO_WORK/run.json"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_report --args "{\"runId\":\"$DUO_RUN_ID\"}" > "$DUO_WORK/report.json"
node "$DUO_PACKAGE/bin/duo.mjs" call --root "$DUO_WORK" --tool dualloop_report --args "{\"runId\":\"$DUO_RUN_ID\",\"view\":\"summary\"}" > "$DUO_WORK/report-summary.json"
cat "$DUO_WORK/report-summary.json"
```

Expected: execution `completed`, `single_fidelity`, no Slow evidence, CNY0
inner model charges, and an unchanged `target.txt`. A candidate may be selected
on development measurements while the conclusion remains `insufficient_evidence`
because no independent final test was supplied. These are different statements.
Reading a report again starts no work.

For evaluate-only, use a fresh directory and `--example evaluate`; follow the
same describe/plan/run/report commands. No Generator runs in that mode.

## Real task starter

- [Real task starter](guides/MODEL_STARTER.md): connect an authorized model and compare document-QA prompts, with the task, evaluator, configuration and budget checks.
- [Agent Guide](AGENT_GUIDE.md): the public tool lifecycle.
- [Other local examples](examples/product/README.md): custom evaluation, component replacement, history and recovery.
- [Errors and recovery](guides/TROUBLESHOOTING.md), [security boundaries](SECURITY.md).

The DSH dependency remains an upstream preview. Providers run in the host
process; product checks do not establish arbitrary-plugin isolation or model
quality. The original Target is never automatically replaced.
