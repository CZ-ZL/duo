# @dual-loop/dsh-plugin · 0.6.3

English · [简体中文](README.zh-CN.md)

DUO lets a DSH Agent compare originals and candidates, returning changes,
measurements, decisions and costs. The original stays in place; adoption is the user's decision.

**[Start: install → free run → saved report](QUICKSTART.md)**

Supports Linux / Node 24+; verified with DSH 0.1.2-rc.1 / Cordis 4.0.2.
Use the [v0.6.3 archive](https://github.com/CZ-ZL/duo/releases/tag/v0.6.3).
The repository root is not the plugin; this package is not published to npm.
[Installation and compatibility](guides/INSTALL.md) covers isolated hosts and
existing profiles. DSH remains an upstream preview; providers execute in-process.

- [Real task starter](guides/MODEL_STARTER.md): a model experiment with its task, evaluator and budget checks.
- [Agent Guide](AGENT_GUIDE.md), [API reference](AGENT_REFERENCE.md): public calls and recovery.
- [Provider contracts](PROVIDERS.md): component replacement and extension.
- [Current support](CURRENT_STATUS.md), [evidence strategy](EVIDENCE_STRATEGY.md), [security](SECURITY.md).

The default bundle provides preparation until work providers are attached;
`duo init` creates complete examples. Built-in model providers support persona/prompt;
other Targets need matching providers. DUO inner costs exclude Caller inference
and local resources. Python/YAML compatibility is under `/legacy`; native use
needs no Python. Model spending and candidate adoption require their own authority.
