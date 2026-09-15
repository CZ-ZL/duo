# Repository organization — bounded execution queue

Owner-approved follow-up: 2026-09-16. Baseline: `1abb2e1`.
Status: COMPLETE within the authorized private repository scope.
This changes repository layout, references and verification entry paths; it
does not change optimization algorithms, authorization or historical outcomes.

| Task | Observable acceptance | Status |
|---|---|---|
| O1 Root documents | Root contains only primary product entry points, license/contribution and build files; guides, release notes and receipts physically relocated | COMPLETE: 36 → 13 root files; 23 root paths relocated/consolidated |
| O2 Scripts | Product verification and research utilities live in separate directories; Python imports, JS imports and copied profile drivers resolve | COMPLETE: two top-level script files; product/research subdirectories |
| O3 Native test layout | Tests/helpers/fixtures outside production native directory; published runtime exports unchanged | COMPLETE: native 79 → 43 files; tests/helpers/fixtures under tests/ |
| O4 Verification | Existing native and Python product tests, package checks and installed DSH journeys pass; moved historical data/receipts retain original bytes | COMPLETE: exact-code CI full gate PASS; 81 historical files byte-identical |
| O5 Private delivery | Reviewed changes and exact-commit CI recorded in existing private repository; no public/npm publication | COMPLETE: e674101 private main; CI35005165474 PASS; current release receipt |

Migration mappings and input hashes are retained in
`dualloop/runs/repository-organization-20260916/`, outside published source.
The public migration map records old → new paths and historical byte hashes.
Old receipts refer to the layouts of their original commits; they are not
rewritten as new acceptance results. Current documents resolve against this tree.

The release gate remains `bash scripts/release_gate.sh`. Public package exports,
DSH plugin names and the original Python import package remain compatible.
No pass-through compatibility-script forest or new management framework is added.
Method research and model calls stay paused. Ordinary relocation failures are
fixed with the existing checks; unrelated features remain outside this queue.

## Local verification

Native 340 PASS; host compatibility 21 profiles PASS; installed public 73 checks /
97 steps /14 profiles PASS; package 69 members, public types/format/docs sync PASS.
Python first collection had 23 import errors from a doubled research directory
prefix; fixed collection is 451 product /86 research excluded. The full local
run recorded 450 PASS /1 FAIL: an old Caller still copied its guide from the
root. The path was repaired; all 5 related entry tests then passed. This is not
claimed as a second full local run. The later CI supplies the fresh full result.

81 historical documents/data/receipts checked byte-for-byte against the original
commit, including all 39 frozen relocated files. Package runtime JS, exports,
dependencies and evaluator code are unchanged. Only 5 shipped Markdown files
change; tarball SHA256:
`d9fcf1880eed7b5d5a0ba9c8c28ab90dcb4c9cac0578ac809efcaef608d84d82`.
No live model requests; model cost CNY 0. The source migration map is in
[REPOSITORY_MIGRATION.json](../development/REPOSITORY_MIGRATION.json).

## Exact-code CI and delivery

Code commit: `e674101ea2f344cb43283d028320854103de644e`.
[CI35005165474](https://github.com/CZ-ZL/duo/actions/runs/35005165474) passed the
complete gate in 6m2s: fresh dependency-store installation, native 340 PASS,
Python 451 PASS /86 research deselected, public 73 checks /97 steps /14 profiles,
Slow 31 checks, baseline repair 5 cases and host compatibility 21 profiles.
Both development/host advisory queries returned zero advisories.

Downloaded CI tarball hash equals the local hash above. Its 462 files/archive
members had no sensitive-pattern hits. The source/history scan covered 438
files, 18 earlier commits and 668 blobs; unchanged generic author-path references
remain classified historical, with no unresolved credential-pattern hits.
Scans are bounded checks, not security certification.

GitHub's actual root listing has 13 files. All moved file modes are preserved.
Later receipt/index changes are documentation only; the 69 package members stay
identical to this CI artifact. The runner emitted the already-known non-blocking
action-runtime warning, retained in the log.

This pass is closed. No public visibility change, npm publication, new release
tag, paid model call or method experiment was performed. New source script paths
are intentional; use the migration map or the historical commit for old records.
No fresh independent Calling Agent judgment is claimed from scripted tests.
