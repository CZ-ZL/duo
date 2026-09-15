# @dual-loop/dsh-plugin 0.6.1

English · [简体中文](./README.zh-CN.md)

DSH-native evaluation and optimization services. Read [CURRENT_STATUS.md](./CURRENT_STATUS.md), [AGENT_GUIDE.md](./AGENT_GUIDE.md), [PROVIDERS.md](./PROVIDERS.md) and [SECURITY.md](./SECURITY.md). The native runtime is JavaScript; Python is only for the explicit legacy/source compatibility path.

Install a reviewed tarball into an existing authorized DSH profile (Linux, Node24+, tested DSH0.1.2-rc.1 / Cordis4.0.2):

```sh
dsh plugin --profile YOUR_PROFILE add /absolute/path/dual-loop-dsh-plugin-0.6.1.tgz
dsh --profile YOUR_PROFILE --dump-config
```

This forwards installation to the profile package manager and may access the registry. Verify its exit status and bundle registration. It does not configure a Calling Agent model, grant permissions or execute an experiment. The host profile must supply an application and tools. The tested installation
toolchain uses pnpm 11.24.0. Peer declarations are checked against the actual
host in CI; earlier installation failures remain in the source acceptance report.

The default bundle exposes onboarding and defers execution until work providers are supplied. No synthetic research fixture is enabled. Existing row IDs remain for compatibility; duo-controller/observer/tool rows are disabled because duo-runtime composes those existing services when dependencies are available.

For an existing target/evaluator, set these rows in your own cordis.patch.yml:

```yaml
- id: duo-contract
  config:
    experiment: /absolute/path/to/your-experiment.json
- id: duo-journal
  config:
    root: /absolute/path/to/your-journal
- id: duo-runtime
  config:
    evaluationOnly: true
- insert:
  - id: my-work
    name: /absolute/path/to/your-authorized-provider.js
```

For optimization set evaluationOnly:false and supply a Generator too. Your provider implements the public Executor/Evaluators service contracts. Config patches replace the whole config object. Relative provider modules require a versioned profile package.json with type:module. Use ordinary DSH/Cordis replacement, not edits to DUO core.

Start immediately with [the public local examples](./examples/product/README.md):

```sh
duo init --root /tmp/my-duo --dsh-package /path/to/node_modules/@deepseek-ai/dsh --example evaluate
duo call --root /tmp/my-duo --tool dualloop_describe
duo call --root /tmp/my-duo --tool dualloop_plan
duo call --root /tmp/my-duo --tool dualloop_run --args '{"planDigest":"PASTE_PLAN_DIGEST"}'
duo call --root /tmp/my-duo --tool dualloop_report --args '{"runId":"PASTE_RUN_ID"}'
```

If the bin is not on PATH, invoke node /path/to/installed/package/bin/duo.mjs. init stages this package into a new isolated profile using an existing DSH; it never installs dependencies or overwrites an existing directory. The examples measure local text hygiene at CNY0, not Agent behavior. call is a transport to actual DSH ToolRuntime, not a second runtime or scripted Caller. Requests/responses/logs are retained in the workspace.

Advanced exports include /target, /config-target, /model-generator, /structured-generator, /config-generator, /model-executor, /function-evaluators, /docs-evaluators, /semantic-evaluators, /comparator, /gate, /history-feedback, /capabilities and /definitions. Live models need authorized host routes, compatible caller-owned data and explicit pricing/budget. The local example CLI deliberately does not inherit credentials.

The existing /offline-fixture export remains explicitly synthetic compatibility material, disabled by default. The /legacy API retains its Python/YAML contracts and separate ledgers. Current support does not imply method superiority, automatic adoption, arbitrary recovery, OS sandboxing or cross-platform compatibility.

This 0.6.1 build is a local release candidate until a matching private GitHub release receipt exists; it is not published to npm. The sealed 0.5.0 acceptance remains unchanged. Read [EVIDENCE_STRATEGY.md](./EVIDENCE_STRATEGY.md) for basic/dual/auto presets and evidence policy contracts.
