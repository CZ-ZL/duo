# Contributing

Use the [documentation map](./docs/README.md) and [current code boundaries](./docs/ARCHITECTURE.md)
to locate a change. The [script map](./scripts/README.md) distinguishes product
verification from retained research utilities.

Read CURRENT_STATUS.md for supported persona, partial bounded configuration and
custom adapter boundaries. Please keep fixes
small and describe the user-visible behavior, relevant checks and remaining
limitations. Optional providers should use the existing service contracts.

Use [TESTING.md](./docs/development/TESTING.md) for the offline product gate and the separate
historical research tests. A fixture result is functional evidence, not evidence
that optimization improves quality or reduces total cost. Preserve failures and
unknown fees. Do not generate paid traffic as part of the test suite.

Before opening a pull request, reproduce the affected behavior and run the
relevant checks. Report your DSH, Cordis, Node and Python versions. Never include
credentials, user personas, private evaluator data, journals or raw model traces
in an issue or patch.

Use this repository's Issues for reproducible bugs and feature requests once it
is published. Describe expected versus observed behavior and include a minimal
redacted reproduction. No response-time commitment is offered. For suspected
vulnerabilities, follow [the security policy](./dsh-plugin/SECURITY.md).

The [MIT license](./LICENSE) applies to project code. Third-party datasets and host
packages retain their own licenses and are not relicensed by this repository.
