# Product expression and first use

Status: **ACTIVE — engineering delivered; live acceptance blocked by registry TLS**.
This is a bounded product-use Goal. Historical experiment Goals remain closed.
The current source package is 0.6.3; release delivery is tracked separately below.

## Short audit and changes

| Reader task | Previous entry and actual obstacle | Minimum change | Evidence |
|---|---|---|---|
| Understand work and output | Homepage began with general explanation and no directly inspectable result | Put task, actual historical result and two start paths before the loop diagram | README / README.zh-CN; independent readers below |
| Finish a free check | Complete commands existed in example guide; homepage stopped at plan | One packaged Quickstart runs through full and summary reports, with digest/id extraction | Installed archive, G3 |
| Start real model work | Existing model providers available, but CLI stripped credentials and had no complete task composition | Add one grounded-QA template using existing Generator, Executor and FunctionEvaluators | Seven targeted checks; G4/G5 still BLOCKED |
| Find model configuration | Provider guide pointed at nonexistent ../NATIVE_MODEL_GUIDE.md | Link current packaged Quickstart; keep old research guide as historical reference | G7 |
| Read packaged instructions | Canonical Quickstart lived in source docs, not the archive | Ship bilingual Quickstart; source path redirects | Archive member/link check |
| Read Agent lifecycle without repeated detail | Agent Guide repeated baseline/recovery qualifications | Move baseline detail to existing API reference; shorten package README; retain full contracts | Diff; existing product regressions |

No core runtime, registry, scheduler, selection or evidence policy was changed.
The CLI only prepares the supplied example and transports calls to DSH ToolRuntime.
Only an explicitly authorized grounded-QA run forwards the named credential;
local examples, planning and report reads do not inherit it.

The evaluator checks four runbook outcomes: deployment command, readiness endpoint,
rollback command and abstention on an undocumented SLA, including required citations.
Wrong facts and wrong citations fail; invalid output stays invalid. These controls
qualify the sample measurement plumbing, not an optimization gain.

## Gate record

| Gate | Status | Evidence / remaining work |
|---|---|---|
| G1 factual claims | PASS | Claims table below, actual historical-source extraction, current capability catalog and changed-code review |
| G2 homepage understanding | PASS | Two fresh sessions, English and Chinese; only the respective homepage supplied; five answers each match the product. Raw answers and input hashes retained under first-use/ |
| G3 free installed path | PASS | Fresh registry install of actual 0.6.3 tarball; exact Quickstart commands completed describe/plan/run/report and re-read; original SHA unchanged, repeated report byte-equal, no model environment inherited |
| G4 real starter | BLOCKED | Owner approved 6 requests / CNY1. Caller 1 stopped before model execution: registry TLS reset. Actual requests/cost 0/CNY0; candidate evaluation not reached |
| G5 unfamiliar live Caller | BLOCKED | Fresh public-guide-only Caller retained all actions and independently recovered npm-cache EROFS; install then blocked by registry. No implementer intervention, but no live-use pass |
| G6 preparation/errors | PASS | Installed package: absent evaluator reports duoEvaluators ABSENT, executionReady false, attach_authorized_evaluator; unsupported model refuses before workspace creation; unfunded plan refuses with next action and no dispatched work |
| G7 docs/package/demo | PASS | 145 links/anchors, 7 identical bilingual shell blocks, archive and rendered GitHub checks PASS. After the store repair and an HTTP200 registry recheck, a fresh public-source clone at 99c6458 followed exact Quickstart commands through report/re-read, original unchanged. Failed attempts retained in G7_ATTEMPTS.json |
| G8 regression/delivery | NOT_RUN | Cache-guide repair CI pending; prior full local gate PASS: 357 native, 451 Python product, 73 public-example checks, 31 Slow checks, 5 repair cases, 21 host profiles. Commit 99c6458 and CI35072852975 PASS; public source-install archive matches CI SHA. Current repair changes packaged guides only; runtime unchanged |

Local evidence root: `runs/first-use-convergence-20260916/` outside the public
source checkout. Public projections omit credentials, private paths, raw user
content and account ledgers. [LOCAL_RESULT.json](./first-use/LOCAL_RESULT.json)
records the current installation check. The homepage
[historical result](./first-use/HISTORICAL_RESULT.json) is extracted from retained
configuration-run artifacts with source hashes. It is labeled v0.4.0 and does
not stand in for current starter acceptance.

## Claims to evidence

| Homepage / guide claim | Current authority or observation |
|---|---|
| Supported prompt Target; bounded config needs compatible execution | native/capabilities.js; native/target.js; native/config-target.js; provider-contract.js; generated CURRENT_STATUS |
| Original retained; candidate overlay returned | Target apply creates isolated overlay; G3 original-file SHA equality; report candidate Delta |
| Owner provides task/evaluator/model/authority | Quickstart caller-input list; starter defaults paid/network false and CNY0; G6 refusals |
| Generation and actual execution supplied for grounded QA | examples/model/prepare.js binds existing model-generator/model-executor; native descriptor/load checks. **Live completion not yet claimed** |
| Content measurement, not JSON validity alone | examples/model/evaluator.js and starter-evaluator.test.js: 4/4 correct, 0/4 wrong, wrong endpoint/citation 3/4, malformed shapes invalid |
| Basic lacks independent Slow/final | Contract has only fast; evidence strategy and G3 report show single_fidelity/unavailable |
| Native fee scope and failure accounting | budget.js/model-call.js receipts; no Caller/local-compute accounting claim |
| Warm history and settled recovery | warm-start.js/controller.js; existing product-example and host acceptance rerun in G8 |
| Historical 100000→150000 / 6+12 checks / final12/12 / package cost | Extracted FINAL_SELECTION.json and COMPARISON_RESULT.json; source hashes in HISTORICAL_RESULT.json; no outcome rewritten |
| No demonstrated general method advantage | Preserved research/EXPERIMENTS.md and experiment-evidence.json; no new method run |

## Failure and intervention record

- The missing model-config CLI path first failed three targeted tests, then passed
  after adding the public example setup.
- Evaluator controls exposed malformed-answer acceptance and incomplete source
  metadata; both were corrected before any live call. Native dataset identity
  reuses modelSettings instead of an independent hash convention.
- A real unauthorised plan initially returned the generic provider error and
  unknown-cost advice. The thin CLI now names missing authority and the contract
  fields to inspect, before dispatch. The original failure is retained.
- G2 needed no implementer explanation. Both readers correctly separated the
  historical example, local installation check and pending real starter. They
  noted that exact contracts, provider lists, artifact paths and checkpoint
  details require the linked guides, as intended.
- Public-source install round 1 failed with pnpm ERR_SQLITE_ERROR at its default store. Supplying the documented isolated writable store passed that point, then dependency downloads failed with ERR_PNPM_META_FETCH_FAIL. A direct Node fetch reported ECONNRESET before TLS establishment; the unchanged reference install verifier also failed. No TLS bypass or hidden cached-install success was used. Prior fresh-install PASS remains a separate earlier run. Once the read-only probe returned HTTP200, a new public-source install at 99c6458 completed the entire guide and repeated report read at zero inner model cost.
- The first G5 session has now run and stopped before model work. It read only public
  product material, required DSH safety guidance and owner resources. npm pack
  encountered EROFS on the global cache; the Caller independently recovered via
  the public npm cache option. Both Quickstarts now put that cache in the
  workspace. Fresh-cache offline packaging and package checks pass. DSH plugin
  installation then failed ERR_PNPM_META_FETCH_FAIL; curl SSL_ERROR_SYSCALL
  and Node ECONNRESET reproduced the registry TLS failure. The parent separately
  reproduced it for both required packages. No TLS bypass or private wiring.
  See [LIVE_ATTEMPT_1.json](./first-use/LIVE_ATTEMPT_1.json) for source hashes,
  timing, input scope, zero-consumption settlement and remaining authorization.
  Zero implementer interventions does not count as successful use when no
  candidate was executed.

## Scope of the cleanup

Before: source-only Quickstart, package README and long Agent Guide overlapped,
and current model setup depended on a stale reference to research documentation.

After: README explains the product; the packaged Quickstart closes both paths;
Agent Guide describes tool use; API/Provider references retain full detail;
Research/Acceptance keep historical evidence. Existing files were reused with
a redirect, not replaced by another documentation hierarchy.

## Authorization and next executable task

The old corrected Root Cause allocation is settled with zero executable requests;
unused allowance was released. The later local Caller grant allowed zero paid work.
Neither authorizes this Goal.

Owner approved at most **6 inner model requests / CNY1** on 2026-09-16. Normal G4/G5 is one
three-request run (baseline, generation, candidate execution). Remaining requests
are only for a fresh session after retained failure inspection and a public-material
fix. No automatic retries, no borrowed funds, no automatic candidate adoption.
Stop on unknown cost, limit exhaustion, absent authority or no further validation
value. Calling Agent host cost is outside DUO accounting.

The new grant is recorded separately from the earlier proposal and closed ledgers.
The first independent Caller receives 3 requests / CNY0.50, public Quickstart and
owner configuration/authority. Retain its actions, document reads, elapsed time,
failures and any assistance. Use that same run for G4/G5. Update the homepage
example only from observed results.
Total Goal stays open until all mandatory gates pass.

## Engineering delivery

Code and packaged guides: [99c6458](https://github.com/CZ-ZL/duo/commit/99c6458a58405fd506b0946e09b61350c361a549).
[CI35072852975](https://github.com/CZ-ZL/duo/actions/runs/35072852975) passed the
full product gate and both dependency advisory checks. The publicly cloned and
locally installed archive matches the CI artifact:

`0910ead5c7dcf44d6b11783ed24ae8db04bff15e1d21a352b75c853a2028057a`.

[Delivery receipt](./first-use/DELIVERY.json) binds the version, gates and cost
scope. The current follow-up changes the two shipped installation guides only;
runtime bytes remain identical. Its own package/CI evidence must be checked before
delivery. GitHub rendered English/Chinese articles and the updated About entry
were checked in the prior delivery. Version 0.6.3 remains an untagged source preview; v0.6.2 remains the latest
Release. No npm publication or visibility change. Inner model requests/cost for
this Goal: **0 / CNY0**; Caller host and local compute are not priced here.

G4/G5 have spending authority but are blocked by registry connectivity. The
6-request / CNY1 grant is entirely unspent. Restore connectivity, then use a new
Caller with the repaired public guide; no new spending grant is required within
that cumulative cap. The Goal stays open. No model result or improvement is claimed.
