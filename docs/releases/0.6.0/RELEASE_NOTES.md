# DUO 0.6.0 — evidence strategy product release

This release defines Slow as bounded evidence acquisition and decision policy.
It does not claim that DUO outperforms a reasonable single loop. Existing research
results and the sealed 0.5.0 Product Foundation acceptance remain unchanged.

## Product behavior

- `evaluate`, `optimize-basic`, `optimize-dual` and `optimize-auto` share the
  existing DSH/Cordis lifecycle. Basic works with one evaluator; forced dual
  refuses missing additional evidence before dispatch. Auto exposes downgrade.
- Evidence sources describe measurement, coverage, independence, cost, side
  effects and versions. Unknown stays unknown. Price does not establish fidelity.
- Comparator aggregation and Gate decisions reuse existing plugin seams.
  Bounded acquisition, actual coverage, decisions and gaps appear in plans,
  Journal, feedback, reports and mode-aware history screening.
- Paused and active runs retain their allowance during cumulative admission.
  A short admission lock prevents overbooking; unknown costs remain blocking.
- Terminal selection considers eligible candidates in rank order, admits a valid
  runner-up after an evidence hold, and records one actual selection per generation.
  Multiple Gate proposals remain inspectable without becoming multiple winners.

## Maintainability and delivery

Product JavaScript and tests use consistent formatting. Pure evidence-source
metadata is shared without the former discovery/strategy import cycle. Public
strategy types compile with positive and invalid-input controls. The gate checks
formatting, declarations, installed package behavior and existing regressions.
The root and shipped package now include English and Chinese READMEs.

Current acceptance and repair history are tracked in
[the Goal queue](docs/slow-evidence-strategy/QUEUE.md) and
[acceptance receipt](docs/slow-evidence-strategy/ACCEPTANCE.json).
The delivery channel is the existing private GitHub repository; no npm publication.

## Compatibility and limits

Linux / Node 24 / DSH 0.1.2-rc.1 / Cordis 4.0.2 is the tested host target.
Provider changes invalidate old plan digests and checkpoints. Re-plan a new run;
do not resume an old contract under changed semantics. Contracts without a
preset and the explicit legacy API are retained, with their evidence limits.

Providers are trusted in-process. Qualification metadata is a provider claim,
not an oracle verified by DUO. The owner freezes the evidence schedule; the
policy requests its next applicable source, rather than purchasing arbitrary
new providers. Crashed admission locks need owner/state inspection. Recovery
only supports settled, unchanged checkpoints within the original deadline.
Windows/macOS, automatic adoption, arbitrary plugin config, caller-wide model
budget enforcement and method superiority are not established.

Graph/Bayesian algorithms and further method research remain outside this release.
