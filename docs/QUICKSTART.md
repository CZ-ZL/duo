# Release quickstart and recovery boundaries

Use the [current status](../dsh-plugin/CURRENT_STATUS.md) and [release index](./releases/README.md)
to identify the exact developer-preview build and its installation artifact. Linux and the
recorded DSH/Node versions are the supported verification environment.

## Minimal local check

Start from the reviewed source checkout and an existing DSH installation. Choose
a new directory you own; `init` refuses to overwrite an existing directory.

```sh
export DUO_DSH_PACKAGE=/absolute/path/to/node_modules/@deepseek-ai/dsh
node dsh-plugin/bin/duo.mjs init --root /tmp/duo-evaluate-check --dsh-package "$DUO_DSH_PACKAGE" --example evaluate
node dsh-plugin/bin/duo.mjs call --root /tmp/duo-evaluate-check --tool dualloop_describe
node dsh-plugin/bin/duo.mjs call --root /tmp/duo-evaluate-check --tool dualloop_plan --args '{"view":"summary"}'
```

Inspect the target, providers, evaluate-only mode, permissions and CNY0 cap. Copy
the returned exact `planDigest` and `runId` into the two calls below:

```sh
node dsh-plugin/bin/duo.mjs call --root /tmp/duo-evaluate-check --tool dualloop_run --args '{"planDigest":"PASTE_PLAN_DIGEST"}'
node dsh-plugin/bin/duo.mjs call --root /tmp/duo-evaluate-check --tool dualloop_report --args '{"runId":"PASTE_RUN_ID","view":"summary"}'
```

Expected: completed evaluation, no candidate generations, `optimization_mode:
evaluate_only`, known native cost CNY0, and retained result/measurement records.
This measures local text hygiene. A Calling Agent using a paid outer model can
still incur fees outside that native ledger. The example does not prove Agent
task quality or general optimization benefits.

For installed-package use, invoke its `duo` binary with the same arguments; see
[package installation](../dsh-plugin/README.md). Check the tarball SHA256 against
the release receipt before installing into an authorized isolated profile.
Do not use an unverified intermediate archive from a failed acceptance attempt.

## Next supported journeys

Use the existing [product example guide](../dsh-plugin/examples/product/README.md)
for `optimize`, `byo`, `replace`, `warm` and `custom`. The public `schemas` tool
and [Agent Guide](../dsh-plugin/AGENT_GUIDE.md) are the interface authority. A custom Target
requires a compatible adapter; an arbitrary file is not automatically supported.

## Upgrade and rollback

1. Keep the previous verified package and its profile configuration. Preserve the
   original Target and all evidence/receipts. Do not copy or move active ledgers.
2. Verify the new package in a separate profile and new run root first. The package
   cannot authorize your model, tool access, network or side effects.
3. After a provider or implementation change, discover capabilities and inspect
   a new plan. A new root is not permission to reset an existing spending grant.
   Do not resume an old checkpoint under the new provider graph.
4. If the new version fails, stop new work and retain its state. Use the previous
   verified package/profile for later separately authorized work. This does not
   undo charges or authorize replay of interrupted operations. Candidate adoption
   is never an automatic part of an upgrade or rollback.

This procedure isolates versions. A new cross-version migration or arbitrary
rollback of pending work is not a supported product capability.

## Common outcomes

| Observed condition | Cause / next action | Work and cost boundary |
|---|---|---|
| `ERR_PNPM_META_FETCH_FAIL` during install | Inspect retained registry errors; restore access in the authorized environment and rerun the installation check. Do not disable TLS verification. | Dependency installation failed; no model work is started by the package verifier. Cached-host success does not prove a clean install. |
| Execution tools absent | Default preparation is present but compatible work providers are missing; inspect discovery output and attach authorized providers. | Preparation does not grant authority or dispatch optimization. |
| `DUO_PLAN_CHANGED` | Target, contract or provider identity changed; inspect a current plan and use its exact digest within authorization. | No work dispatched by this rejected run call; earlier ledger state still exists. |
| `DUO_ADDITIONAL_EVIDENCE_REQUIRED` | Explicit dual mode lacks applicable additional evidence; supply it or explicitly select basic/auto and inspect the new plan. | No silent downgrade or new grant. |
| Unknown cost / unresolved receipt / admission lock | Inspect status, budget and independently supported staged receipts; verify lock ownership. | No automatic retry, lock deletion, inferred zero charge or ledger reset. |
| `insufficient_evidence` / no qualified candidate | Current measurements do not justify a validated replacement; read decision basis and limitations. | A valid terminal outcome, not a reason to relax constraints or rerun without limits. |

For a bug report include version, host versions, preset, redacted arguments,
expected/observed behavior, error code and known/unknown cost state. Do not attach
credentials, private Targets, raw prompts, journals or private evaluator data.
See [CONTRIBUTING](../CONTRIBUTING.md) and the [security policy](../dsh-plugin/SECURITY.md).
