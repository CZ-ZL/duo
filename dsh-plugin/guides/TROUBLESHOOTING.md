# Troubleshooting and continued use

[English](TROUBLESHOOTING.md) · [简体中文](TROUBLESHOOTING.zh-CN.md)

[Installation and host compatibility](INSTALL.md) · [Quickstart](../QUICKSTART.md)

| Outcome | Next action |
|---|---|
| No Evaluator | Use describe/design to identify the missing binding. Restore the shipped starter evaluator or connect a compatible function; do not invent scores. |
| `DUO_STARTER_MODEL_UNSUPPORTED` | Use the declared starter route/config, or follow Provider contracts for a different composition. No model work was dispatched by init. |
| `DUO_STARTER_AUTHORIZATION_REQUIRED` | Obtain authority. Then update working `experiment.json` permissions and budget and inspect a new plan. Keep zero allowance until approved. |
| `DUO_STARTER_CREDENTIAL_REQUIRED` | Supply the named credential through the environment. The refused call started no model work. |
| `DUO_PLAN_CHANGED` | Inspect a new plan after a target/provider/data change. Do not reuse the old digest. |
| Unknown cost, pending receipt, lock or interrupted request | Read retained status/ledger. No automatic replay, ledger reset, inferred zero fee or lock deletion. |

[Agent Guide](../AGENT_GUIDE.md) describes the public lifecycle.
[Local examples](../examples/product/README.md) cover BYO evaluators, a custom
Target, component replacement, warm start, cancellation and supported recovery.
[API reference](../AGENT_REFERENCE.md) defines those boundaries.

For upgrades, keep the previous verified archive and profile. Test the new version
in a new isolated workspace before using it. Re-plan after provider changes;
do not resume old checkpoints under a changed graph. Returning to an old version
does not undo charges or authorize replay.
