# Repository organization — bounded execution queue

Owner-approved follow-up: 2026-09-16. Baseline: `1abb2e1`.
This changes repository layout, references and verification entry paths; it
does not change optimization algorithms, authorization or historical outcomes.

| Task | Observable acceptance | Status |
|---|---|---|
| O1 Root documents | Root contains only primary product entry points, license/contribution and build files; guides, release notes and receipts physically relocated | COMPLETE: 36 → 13 root files; 23 root paths relocated/consolidated |
| O2 Scripts | Product verification and research utilities live in separate directories; Python imports, JS imports and copied profile drivers resolve | COMPLETE: two top-level script files; product/research subdirectories |
| O3 Native test layout | Tests/helpers/fixtures outside production native directory; published runtime exports unchanged | COMPLETE: native 79 → 43 files; tests/helpers/fixtures under tests/ |
| O4 Verification | Existing native and Python product tests, package checks and installed DSH journeys pass; moved historical data/receipts retain original bytes | LOCAL PASS with recorded repair; exact-commit CI pending |
| O5 Private delivery | Reviewed changes and exact-commit CI recorded in existing private repository; no public/npm publication | PENDING |

Migration mappings and input hashes are retained in
`dualloop/runs/repository-organization-20260916/`, outside published source.
A public migration map will record old → new paths and historical byte hashes.
Old receipts refer to the layouts of their original commits; they are not
rewritten as new acceptance results. Current documents resolve against this tree.

The release gate remains `bash scripts/release_gate.sh`. Public package exports,
DSH plugin names and the original Python import package remain compatible.
No pass-through compatibility-script forest or new management framework is added.
Method research and model calls stay paused. Ordinary relocation failures are
fixed with the existing checks; unrelated features remain outside this queue.

## Local verification

Native 340 PASS; host compatibility21 profiles PASS; installed public73 checks /
97 steps /14 profiles PASS; package69 members, public types/format/docs sync PASS.
Python first collection had23 import errors from a doubled research directory
prefix; fixed collection is451 product /86 research excluded. The full local
run recorded450 PASS /1 FAIL: an old Caller still copied its guide from the
root. The path was repaired; all5 related entry tests then passed. This is not
claimed as a second full local run; CI will run the full suite on the final tree.

81 historical documents/data/receipts checked byte-for-byte against the original
commit, including all39 frozen relocated files. Package runtime JS, exports,
dependencies and evaluator code are unchanged. Only5 shipped Markdown files
change; tarball SHA256:
`d9fcf1880eed7b5d5a0ba9c8c28ab90dcb4c9cac0578ac809efcaef608d84d82`.
No live model requests; model cost CNY0. The source migration map is in
[REPOSITORY_MIGRATION.json](../development/REPOSITORY_MIGRATION.json).

No further feature work or research is part of this pass. Next: exact-commit
private CI, archive verification, and the matching delivery receipt.
