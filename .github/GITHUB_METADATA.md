# GitHub metadata checklist (do not execute without maintainer confirmation)

Proposed settings for <https://github.com/CZ-ZL/duo>. Every `gh` command below
mutates the remote and **requires explicit user confirmation before running**.
Nothing on this page has been executed.

## Proposed repository description (one line)

> DSH-native Dual-Loop Autonomous Optimization plugin: bounded persona/system-prompt optimization inside DeepSeek Harness (experimental; no proven advantage over a single loop)

## Proposed topics

`deepseek` `dsh` `deepseek-harness` `cordis` `agent-optimization`
`prompt-optimization` `evaluation` `llm-agents` `research-code` `experimental`

## Pre-publicity secret scan (completed 2026-09-14, read-only)

Ran `git grep` over all 354 tracked files for common secret patterns. Findings:

- [x] No `.env`, `.pem`, `.key` or credential-store files are tracked
      (`.gitignore` excludes them; only an upstream-mirrored docs page
      `benchmarks/docs_qa/dsh-snapshot/docs/subsystems/credentials.md` matched
      the filename search — documentation, not a secret).
- [x] No `sk-...` API-key-shaped strings — all matches were false positives
      (English words like "task-specific" and sha256 hashes of fixture
      filenames).
- [x] No `DEEPSEEK_API_KEY=<value>` assignments anywhere in tracked files.
- [x] No `BEGIN ... PRIVATE KEY` blocks.
- [x] Generic `secret:`/`token:` assignments are synthetic test fixtures
      (`dsh-plugin/native/*test.js` placeholders such as `'FINAL_SECRET'`),
      not real credentials.
- [x] **Internal absolute paths in documentation scrubbed 2026-09-14:**
      `CODE_BENCHMARK_GUIDE.md`, `dsh-plugin/SPIKE.md`,
      `examples/native/code-properties.md` and `examples/native/code-review.md`
      now use `$DUO_DSH_PACKAGE`, `$DSH_HOME` and `/path/to/...` placeholders.
- [x] **Accepted pre-publicity disclosure (not secrets):** internal absolute
      paths remain in hash-frozen inputs and are retained deliberately —
      historical fixture paths retained to preserve frozen evidence hashes:
      - `benchmarks/docs_qa/SPEC.md` and `benchmarks/docs_qa/questions.*.yml` —
        corpus-root paths under the author's workspace
      - `dsh-plugin/native/fixtures/code-method-goal/b1-code-evaluation/evaluation.json` —
        historical `receiptPath` values under the author's `dualloop/runs/` tree
      These expose the author's local layout only; rewriting them would change
      frozen evidence hashes.

## Maintainer commands (require explicit confirmation; do NOT run now)

```sh
# 1. Set description and topics
gh repo edit CZ-ZL/duo \
  --description "DSH-native Dual-Loop Autonomous Optimization plugin: bounded persona/system-prompt optimization inside DeepSeek Harness (experimental; no proven advantage over a single loop)"
gh api repos/CZ-ZL/duo/topics -X PUT \
  -f "names[]=deepseek" -f "names[]=dsh" -f "names[]=deepseek-harness" \
  -f "names[]=cordis" -f "names[]=agent-optimization" -f "names[]=prompt-optimization" \
  -f "names[]=evaluation" -f "names[]=llm-agents" -f "names[]=research-code" \
  -f "names[]=experimental"

# 2. Create the v0.4.0 release with the verified tarball asset.
#    Use the tarball produced by the 2026-09-14 release gate
#    (runs/root-cause-diagnostic-20260913/release-gate-v040-20260914/**/dual-loop-dsh-plugin-0.4.0.tgz);
#    verify its hash BEFORE uploading (verified at gate time:
#    f670e0ef2a71ac49c88d5c8e4b995aaf95b9f95f146629f0fc33cae88cf38738).
sha256sum dual-loop-dsh-plugin-0.4.0.tgz
gh release create v0.4.0 dual-loop-dsh-plugin-0.4.0.tgz \
  --repo CZ-ZL/duo \
  --title "v0.4.0 — config target and fetch evaluation harness" \
  --notes-file RELEASE_NOTES_v0.4.0.md \
  --prerelease

# 3. Flip the repository public — irreversible exposure of full history;
#    confirm the secret scan items above are resolved first.
gh repo edit CZ-ZL/duo --visibility public --accept-visibility-change-consequences
```
