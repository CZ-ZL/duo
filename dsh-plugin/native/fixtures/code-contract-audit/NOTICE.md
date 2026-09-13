# BigCodeBench fixture attribution and modifications

`dataset.json` and `answer-key.json` contain adapted BigCodeBench v0.1.4 task
prompts, reference implementations and tests. They retain their upstream
Apache-2.0 license, included in [LICENSE](LICENSE); the root DUO MIT license does
not replace it. Upstream: https://huggingface.co/datasets/bigcode/bigcodebench .

DUO modifications select36 tasks, arrange them into the dataset/answer-key schema,
and apply the documented development-contract test repairs. See
[PROVENANCE.json](PROVENANCE.json), the source benchmark guide and preparation
script for provenance. Every task in this regression fixture is public/exposed,
including the partition named `final`; none can serve as unseen final data.
These fixtures are excluded from the npm runtime tarball.
