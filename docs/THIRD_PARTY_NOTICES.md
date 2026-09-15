# Third-party material

DUO source is MIT-licensed except separately attributed third-party material.

## Design inspiration

Haochen Wang, Yi Wu, Daryl Chang, Li Wei and Lukasz Heldt.
[*Self-Evolving Recommendation System: End-To-End Autonomous Model Optimization
With LLM Agents*](https://arxiv.org/abs/2602.10226), 2026,
arXiv:2602.10226, DOI: [10.48550/arXiv.2602.10226](https://doi.org/10.48550/arXiv.2602.10226).

Its offline-inner / online-outer optimization structure inspired DUO. This is
conceptual attribution, not a claim that the paper's code is included. DUO is an
independent adaptation to Agent components; it does not reproduce YouTube's
production infrastructure, inherit the paper's results or imply author endorsement.

## Runtime foundations

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) supplies the
Agent host, model and tool execution. The [Cordis](https://github.com/cordiverse/cordis)
plugin model supplies service composition and lifecycle. DUO uses the
DSH host's @deepseek-ai/cordis package. These dependencies are declared
in dsh-plugin/package.json; their licenses remain with their distributions.
DUO is an independent plugin, not an official DeepSeek product.

## Included third-party material

- `research/benchmarks/docs_qa/dsh-snapshot/`: DeepSeek Harness documentation, MIT. The
  directory includes the upstream license, pinned commit and file provenance.
- `dsh-plugin/tests/fixtures/code-contract-audit/`: adapted BigCodeBench v0.1.4
  regression tasks, reference implementations and tests, Apache-2.0. The
  directory includes LICENSE, NOTICE.md and PROVENANCE.json. All fixture
  partitions are exposed test data, including the historical `final` label.
- `dsh-plugin/tests/fixtures/code-method-goal/`: a second public regression
  fixture using the same 36 BigCodeBench task inputs and retained local test
  observations. See its NOTICE.md and PROVENANCE.json and the adjacent
  `code-contract-audit/LICENSE` (Apache-2.0). Its `final` field is also exposed
  regression data, never an unseen evaluation set. Neither fixture ships in
  the runtime tarball.

Runtime peer dependencies retain their own licenses and are not vendored here.
