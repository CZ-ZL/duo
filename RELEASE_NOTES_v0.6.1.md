# DUO 0.6.1 — bounded product repairs

Status: private source and CI artifact delivered; not publicly released or tagged.
The private v0.6.0 release and
its evidence remain unchanged. See the [pre-publication contract](docs/product-foundation/PRE_PUBLICATION_ACCEPTANCE.md)
and [F01 follow-up](docs/product-foundation/F01_REPAIR.md) for the
current release decision; the [initial audit](docs/product-foundation/PRE_PUBLICATION_AUDIT.zh.md) remains historical. A successful old CI badge does not verify this candidate.

## User-visible changes

- A valid, measurable baseline that violates a quality constraint can enter
  repair. Candidates must still satisfy the unchanged constraints. Invalid or
  insufficient baseline evidence stops search. Plan, Journal and report explain
  baseline feasibility; no candidate is deployed automatically.
- Preparation now points to four resources that actually ship in the package.
  The local evaluator control example distinguishes fixed correct/incorrect
  outputs through the public DSH path. Control-purpose data is admitted only for
  non-final evaluate-only work; optimization and final continue to reject it.
- Guides describe legal CNY0 configuration and actual public warm-start fields.
  Omit the optional positive cumulative cap for a free local example; keep
  per-run `maxCostCny: 0` and `permissions.paid: false`. This grants no paid authority.
- Release preparation adds scoped acceptance criteria, attribution for the
  second exposed BigCodeBench fixture, and complete baseline-repair CI receipts.
  It does not change historical fixture contents or experiment results.

## Compatibility and limitations

The audit's custom Target identity blocker is repaired: final execution and
reporting use the Target-supplied original ID. The custom example now returns
`original` (provider version 2). Observer version 7 emits report version 9;
existing field names and public service exports remain compatible.

Tested host: Linux, DSH 0.1.2-rc.1, Cordis 4.0.2, Node 24.14.1, pnpm 11.24.0.
Native API v2 and retained public exports remain. Default comparator descriptors
are version 2 following the baseline repair. Old plan digests do not authorize
this changed implementation: inspect a new plan after upgrading.

Providers are trusted in-process code; declarations are not an OS sandbox or
independent measurement qualification. Built-in configuration support is partial.
Recovery is restricted to unchanged, settled checkpoints and the original
deadline. Caller inference is outside native accounting. No Windows/macOS,
arbitrary interrupted-call replay, automatic deployment or method advantage is
claimed. See [upgrade and fault handling](RELEASE_QUICKSTART.md).

## Evidence

Current tarball: `dual-loop-dsh-plugin-0.6.1.tgz` (69 files).
SHA256: `c53c183ba5fd16bb262c540ed77bbcc458575d30451e397c1672c4661b356221`.
The previous unrepaired archive and its evidence remain in the initial audit.

Fresh verification: native 340 PASS; Python product 451 PASS /86 research
excluded; actual installed public acceptance 73 checks /97 steps /14 profiles;
Slow evidence 31 checks; baseline repair 5 cases /26 commands; DSH compatibility
21 profiles. The new identity tests first recorded 1 PASS /6 FAIL, then 7 PASS.
Format, public types, package contents and cached-host installation passed.

Bilingual diagrams now show Fast history and Slow feedback separately; the
[current architecture](docs/ARCHITECTURE.md), [documentation map](docs/README.md)
and [script map](scripts/README.md) distinguish runtime, developer tools and
historical research. Paper inspiration and host/fixture attribution are explicit.

Independent Caller trials predate the preparation/control and identity repairs.
They support unchanged journeys; changed paths have scripted installed-DSH
acceptance, not a fresh independent Agent trial. These local controls establish
product behavior, not optimization quality.

Local fresh-store attempts remain failed with registry fetch errors. The
[exact-code CI](https://github.com/CZ-ZL/duo/actions/runs/35001366148) at
`80f06eea5161791585f05cdc6639cd328bb57bf7` passed the complete gate, including
fresh-store installation and the same native/Python/installed/host counts above.
Both development and installed-host npm advisory reports returned zero
advisories. The downloaded CI tarball matches the local SHA256; its artifact
scan covered 462 files/members with no sensitive-pattern hits.

Later documentation-only receipts and navigation edits preserve all tested
runtime/package bytes. The source and artifact are in the private repository;
no v0.6.1 tag, public visibility change or npm publication was performed. Prior
failures and the runner's action-runtime warning remain recorded. No paid model
requests were introduced.
