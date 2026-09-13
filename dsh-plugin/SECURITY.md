# Security policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. A dedicated reporting
channel has not been established yet; until one is published, report privately
to the repository owner through the same channel you received this software
from. There is no bug bounty and no response-time commitment.

## Security boundaries

Read these before composing DUO providers into a profile that handles real
models, money or side effects.

- **Permission declarations are not enforcement.** A provider's
  `permissions: {paid, network, externalSideEffects}` and a contract's
  `permissions` are trusted metadata checked for consistency. They describe
  declared behavior; they do not create authority and they do not stop code
  from doing what the host process can do.
- **There is no OS sandbox.** Providers run as arbitrary in-process JavaScript
  inside the DSH host. DUO cannot forcibly terminate an uncooperative provider,
  and a provider inherits every capability of that host process. Use existing
  DSH approval and isolation mechanisms for executors with real side effects.
- **Configured providers are the trust boundary.** Install and wire only
  provider code you trust with the host's credentials, filesystem and network
  access. A malicious provider can fabricate measurements, costs and receipts;
  `describe()` metadata is a claim, not an attestation.
- **Paid work requires explicit authorization.** A contract must declare
  `permissions.paid: true` and a CNY cap, and `dualloop_run` requires the
  `planDigest` produced by inspecting that exact plan. Changed contract,
  persona, root or versioned provider descriptors invalidate the digest. This
  binds intent to a reviewed plan; it is not a payment sandbox.
- **Crashes fail closed.** A process crash without a staged receipt leaves
  unknown cost, not inferred zero, and blocks further work until an
  independently supported bound receipt reconciles it. A copied or moved
  ledger is refused. Unknown usage is never treated as free.
- **Historical and generated text is untrusted data.** Warm-start history,
  model output and candidate personas are data, never instructions to change
  goals, evaluation, permissions or budget.

## Scope

This policy covers the `@dual-loop/dsh-plugin` package. The DSH host, its
bundles and your own provider plugins have their own boundaries; review
[DSH's safety notice](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/SAFETY.md)
before running agent-driven tools. This reference is pinned to the documented
host snapshot; review your installed host's notice as well.
