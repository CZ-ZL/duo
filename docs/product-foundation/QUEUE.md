# DUO Product Foundation & Productization

Status: IN_PROGRESS. Baseline: 0.4.0 / `6729d4c`; repository `CZ-ZL/duo`, private, branch main (remote verified 2026-09-14). Target: a frozen, supported 0.5.0 product foundation. Existing research Goals/results remain closed and unchanged. No method/model research or paid requests in this queue.

This queue implements the owner's 2026-09-14 productization instructions (§1–13), using existing Cordis services and file-based task tracking. Completion requires the supported product journeys, package acceptance and private GitHub CI/delivery, not benchmark benefit. No new scheduler or Goal API is created.

| Task / source | Observable completion condition | Dependencies | Status / evidence |
|---|---|---|---|
| P0 factual audit (§2–4) | Every responsibility mapped to public boundary, coupling, replacement and minimum change; latest remote verified | none | COMPLETE: AUDIT.md; private main matches local baseline |
| P1 capability consistency (§5A–C,7) | One authoritative capability catalog drives discovery/schema/docs; supported and partial targets explicit; configured custom adapter discoverable | P0 | IMPLEMENTED / LOCAL VERIFIED: p1-red.log (2 expected failures), p1-green.log (23 passes); docs synchronization in P4 |
| P2 target lifecycle (§3–5B) | Core uses target-owned identity/history projection; persona/config warm history validated; custom target runs without core changes; final/fixture/budget boundaries retained | P1 | IMPLEMENTED / LOCAL VERIFIED: p2-red.log (2 expected failures), p2-green-2.log (16 passes); old persona controls retained |
| P3 default public flow and failures (§6–7) | Evaluate/optimize preparation through shipped interfaces; defaults deterministic/local; structured errors include action, recovery and cost/effect uncertainty | P2 | IMPLEMENTED / LOCAL VERIFIED: p3-red.log, p3-green.log (25 passes); existing tools extended, no new tool names |
| P4 package, examples and lean pass (§8–9) | Five public examples included and runnable without research archives; compatible legacy API retained; status/docs/version synchronized; before/after simplifications recorded | P3 | IMPLEMENTED / LOCAL VERIFIED: public-acceptance-2, 55 checks/80 steps; install-offline actual DSH plugin add; 63 tarball members; LEAN.md |
| P5 product acceptance (§10) | Fresh profile/tarball passes all 14 owner scenarios; independent Agent follows only shipped instructions; record steps/interventions/failures/limits | P4 | LOCAL_PRODUCT_ACCEPTANCE_PASS: independent Caller six runs/43 calls plus final docs/preset follow-up, zero implementer interventions; native 295 PASS; Python 451 PASS /86 research deselected; 21 DSH profiles PASS. Registry download blocked locally by TLS EOF; CI must verify fresh dependencies. |
| P6 private release (§11–13) | final gate, artifact/security review, diff review, version and current status; commit/push existing private repo; CI success recorded | P5 | READY_FOR_PRIVATE_CI: local acceptance and independent Caller passed; reviewed authorized push next; npm registry publication excluded |

Execution loop: inspect → minimal implementation → relevant tests → diff review → update this queue. Keep local receipts outside the published source under `runs/product-foundation-20260914`; publish concise sanitized acceptance metadata. Only call an item complete when its evidence exists.

Authorization: local development, isolated dependency/install acceptance, commit/push to existing private CZ-ZL/duo and CI are authorized by this task. No paid model request is authorized by this queue; use deterministic/local providers. No original user profile or ledger mutation. External failures block only the relevant acceptance/delivery item; continue independent work and retain evidence.

Research backlog only: new benchmarks, DUO/single-loop comparison, Graph/Bayesian, weak-to-strong, Generator/Slow research, additional loops, evaluator evolution, dashboard, marketplace, cloud. No automatic follow-on.
