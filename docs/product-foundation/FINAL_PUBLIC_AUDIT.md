# Final public-source audit — 2026-09-16

Status: IN PROGRESS. The owner explicitly authorized public visibility after
this final audit. This supersedes earlier preparation-only visibility limits;
it does not authorize npm publication, paid model experiments or deployment.
The [existing A01–A13 contract](PRE_PUBLICATION_ACCEPTANCE.md) remains the
acceptance basis. Old failed results and later repairs remain separate records.

## Frozen scope and checks

| Check | Required outcome | Status |
|---|---|---|
| Q1 History and external exposure (A01) | Scan reachable history, current tree, release assets and Actions logs/artifacts; reconcile remote refs and other repository surfaces | Existing surfaces PASS; final CI output pending |
| Q2 Supply chain and attribution (A02) | Review package boundaries, lifecycle scripts, licenses and exact-version dependency advisories; no unresolved blocking finding | Package/OSV PASS; final CI npm advisory refresh pending |
| Q3 Critical code review (A03–A08) | Trace public input, plan, budget, evidence, selection and recovery; review changes since v0.6.0 with existing controls | PASS within declared trusted-provider scope; see review below |
| Q4 Product verification (A09–A11) | Complete existing exact-code product CI and artifact checks; distinguish fresh scripted evidence from earlier independent Caller evidence | Homepage CI PASS; publication-document package CI pending |
| Q5 Public guidance (A12) | Current setup, limitations, security contact and navigation usable without private context | Reporting instructions repaired; activate private form with public exposure |
| Q6 Decision and exposure (A13) | Save findings and artifact identity; only then change visibility and verify unauthenticated access | PENDING |

Research outcomes, candidate generation and new benchmarks are outside scope.
No professional security certification, exhaustive dependency source audit or
fresh independent Caller result is implied. Release blockers must be resolved;
optional refactoring remains deferred. Original data/receipts are preserved.

## Review methods

Online skill sources were read at pinned revisions, without installing global
plugins or running third-party skill scripts:

- [Shipping and Launch](https://github.com/addyosmani/agent-skills/blob/be4e44a9fbc5e8df0beaefadbb28bd22ee61cc39/skills/shipping-and-launch/SKILL.md),
  with its completion and security references: installation, tests, dependencies,
  documentation and recovery readiness.
- [Differential Review](https://github.com/trailofbits/skills/blob/027bc47a69a276c340717bafdc3708263094b9a4/plugins/differential-review/skills/differential-review/SKILL.md):
  baseline comparison, critical callers, regression evidence and explicit limits.

Application-specific exclusions: DUO exposes local DSH tools, not a hosted web
service. HTTP login, CORS, DNS/CDN, web vitals, feature-flag traffic rollout and
service SLO monitoring are NOT APPLICABLE. Relevant local equivalents are
trusted-provider boundaries, bounded execution, Journal/status and documented
checkpoint recovery. No hosting infrastructure is added to satisfy a checklist.

Publishing source makes history, forks and Actions records externally visible;
changing it back cannot recall downloaded copies. See
[GitHub visibility documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility).
Raw local review evidence is retained in `dualloop/runs/final-publication-audit-20260916`,
outside the published repository. Findings and final disposition follow below.

## Findings and repairs

| ID | Severity / evidence | Disposition |
|---|---|---|
| QC01 | LOW / FACT: package SECURITY.md directed readers to their original private distribution channel, which public newcomers do not have | Updated package and existing GitHub security policy to a private reporting form with a non-disclosing fallback; activation and readback are part of publication |
| QC02 | LOW / FACT: four workflow actions referenced mutable major-version tags | Pinned the current tag commits; retained contents:read, no persisted checkout credentials, and disabled dependency install scripts; final CI verifies these exact pins |
| QC03 | LOW / FACT: package installation docs and release procedure still described private-only distribution | Current guidance uses the release index and owner-authorized visibility; sealed older receipts remain unchanged |

No new HIGH/CRITICAL issue was identified in the reviewed scope. This is not a
proof that no vulnerability exists. Baseline F01 was an earlier real defect;
its negative control and repair remain recorded, not erased by this verdict.

## Code review and regression evidence

Baseline: remote v0.6.0 points to `141581c9281c164fcb437880296b7a35f061918b`.
Reviewed head: `5ec271077c8007f75164e96364545dddb07de3b1`.
All 11 changed current native JavaScript/type files were reviewed, with critical
one-hop provider, storage, history and CLI paths. Relocated tests were matched
through the migration maps; they are not counted as deleted validation.

| Area | Review and evidence |
|---|---|
| Plan/run and paid work | controller.js binds current Target/provider/spec identities before admission; invoke reserves before work and leaves invalid/missing currency or cost unresolved. Provider permissions remain declared metadata, not an OS/payment sandbox. |
| Baseline repair | controller.js:507 and policies.js:38 separate a measured quality failure from unusable evidence. Git blame traces the old baseline refusal to 5a45eb9. Scope/sample/type checks remain; candidates still need unchanged constraints. baseline-repair.test.js covers failed evidence, infeasible candidates/final, denial and settled recovery. |
| Selection/final identity | controller.js:977, observer.js:230 and evidence-strategy.js use the actual baseline ID. baseline-identity.test.js covers one final measurement, candidate comparison, ties, evaluate-only and no false candidate-validation claim. |
| Comparator callers | Controller comparisons and the exclusion comparator retain scoped evidence and feasible-candidate checks. Dynamic Cordis replacement prevents treating a text-reference count as a complete call graph; no synthetic coverage percentage is asserted. |
| Budget/recovery | store.js:805 counts unfinished allowances and unknown receipts before admission, under an exclusive write lock. Existing controller/store/product-review tests exercise concurrency, uncertain charges, cancellation and no blind replay. Storage is caller-owned; malicious trusted providers remain outside the integrity guarantee. |
| Evidence/history | provider-contract.js checks advertised target, measurement, currency and permissions; warm-start.js projects bounded search-only records. control purpose is admitted only for evaluate-only; final remains excluded from search feedback. |
| Execution/Target | Config Delta allowlists one fetch field and binds parent version; CLI calls Node with an argument vector and a bounded environment, not a constructed shell command. The native executor uses the configured DSH host. |

The historical changes modify quality admission and final identity, not ownership
or payment authority. Concrete misuse cases checked against existing controls:
replace the Target/provider after planning; return wrong-currency or unknown-cost
receipts; feed missing constraint metrics as a repair; force promotion of an
infeasible candidate; replay an unfinished run; feed final/control measurements
into history. Their existing regression paths are included in exact-code CI.

The new publication changes affect three shipped Markdown files and workflow
pins only. Native runtime bytes, exports, model configuration, objectives and
all experiment outcomes remain unchanged. The new 69-member package SHA256 is
`0e842f5531e8261c801484ca196bba9d74c6272993fdd0bcbeacf046d9f40869`.

## Exposure and dependencies reviewed so far

Source scan: 441 intended files, 21 reachable commits and 852 blobs; zero
unresolved credential-signature or private filename hits. The 27 current generic
author-path matches remain classified historical/test/legacy references.
Remote refs comprise main and the two recorded tags, all covered by local objects.

Downloaded five assets from both old Releases, ten retained CI artifacts and
eleven completed-run log bundles, including failed/cancelled runs. Recursive
inspection covered 2,690 files/members with no credential-signature hits.
Issues and issue/review/commit comments were empty; wiki, discussions and Pages
were disabled. Later CI outputs are checked separately before exposure.

Homepage CI35008412237 passed native 340, Python product 451 (86 research tests
excluded), installed public 73 checks/97 steps, Slow 31 checks, baseline repair
five cases, fresh dependency-store installation and 21 host profiles. Both npm
dependency graphs returned zero advisories. OSV exact-version queries for
PyYAML 6.0.2 and pytest 9.0.3 returned no listed vulnerabilities; this does not
certify every version admitted by a dependency range. No forced audit upgrade.

## Acceptance limits and remaining actions

Independent Caller evidence is earlier evidence from the product/Slow tracks;
their public guide and CLI inputs remain intact. This audit does not run a fresh
blank Agent or claim the later preparation controls were independently revalidated.
Fresh installed-profile checks cover those paths as scripted product evidence.
Research-only tests needing private archives stay explicitly excluded.

No exhaustive third-party source audit, entropy-based secret proof, penetration
test or method-effectiveness claim is made. Linux developer-preview boundaries,
trusted provider code and settled-checkpoint-only recovery remain documented.
Hosted traffic metrics and production fleet rollout are outside this release.

Remaining: verify the new exact package/Action pins in CI, inspect its output,
record the final decision, change visibility under the owner's explicit grant,
enable private reporting, and verify public access without authentication.
No paid models, npm publication, new tag or automatic candidate adoption.
