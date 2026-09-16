# @dual-loop/dsh-plugin 0.6.3

English · [简体中文](./README.zh-CN.md)

DUO lets a DSH Agent evaluate an original prompt or supported component, try
candidate changes against your tests, and return the changes, decisions and costs.

**[Start here: install → free check or real task → saved report](./QUICKSTART.md)**

The Quickstart includes every command, the supplied task/evaluator and the
owner-provided model configuration. Its real starter acceptance is still pending;
the local path checks product operation without model calls.

Developer preview: Linux / Node24+, tested DSH0.1.2-rc.1 / Cordis4.0.2.
Version 0.6.3 is an unreleased source preview; the Quickstart packages its public
source into an installable tarball. Previous released builds have versioned GitHub
assets. Do not install the repository root or assume an npm release. Installation may fetch dependencies; it does not configure a model
account or authorize experiments.

- [Agent Guide](./AGENT_GUIDE.md): when and how to call the public tools.
- [Current support](./CURRENT_STATUS.md): Target and mode boundaries.
- [API reference](./AGENT_REFERENCE.md), [Provider contracts](./PROVIDERS.md):
  advanced configuration, replacement and recovery.
- [Evidence strategy](./EVIDENCE_STRATEGY.md): basic, dual and actual evidence acquired.
- [Security](./SECURITY.md): trusted providers, host permissions and adoption.

The default bundle offers preparation until compatible work providers are attached.
The shipped starter supplies its own composition. Built-in model providers support
persona/prompt; other Targets require matching providers. No candidate is
automatically adopted. DUO inner costs exclude Calling Agent inference and local
resources. Python/YAML compatibility remains behind /legacy; native use needs no Python.
