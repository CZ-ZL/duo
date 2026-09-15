# Exposed BigCodeBench feedback regression fixture

The task text in `b1-development-pack/dataset.json` is derived from BigCodeBench
v0.1.4. All 36 task IDs and input texts match the separately attributed adjacent
`code-contract-audit/dataset.json`. Its source and Apache-2.0 license are recorded
in [the adjacent provenance](../code-contract-audit/PROVENANCE.json) and
[license](../code-contract-audit/LICENSE). DUO arranged these inputs into a
full-development Fast partition and a historical `final` field.

Every partition is exposed public regression data. This is not the later formal,
shadow or Selection Audit final, and cannot become an unseen final again.
`b1-code-evaluation/evaluation.json` retains DUO's historical deterministic local
test observations used by `method-feedback.test.js`. Receipt paths name the old
author workspace; the receipt files are not distributed or required by that
test. These strings are historical provenance, not an installation instruction.

The fixture is excluded from the npm runtime tarball. Its contents and scores
were not changed during the 0.6.1 publication audit. See PROVENANCE.json for
current byte hashes. This notice completes attribution; it adds no method claim.
