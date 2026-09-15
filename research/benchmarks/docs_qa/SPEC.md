# SPEC — DualLoop `docs_qa` benchmark (v2)

Question set for the DualLoop demo: an agent answers questions about the DeepSeek
Harness (DSH) documentation and cites the file(s) it relied on. Judging is fully
programmatic; no LLM judge is involved.

v2 (2026-09-06): rebalanced after calibration — expanded abstention (10 → 20,
incl. 6 pressure variants), hardened synthesis (10 → 16), converted abstention
judging to any-of regex acceptance cues. The v1 40-question split is preserved in
`split_v1.archive.yml` for provenance only.

## Corpus

- Root: `/home/agent/.openclaw/workspace/Research OS/deepseek_harness/upstream/docs/`
- Mirror pinned to upstream commit `0a53fb55bea101816fa226bb964ae2bed71c343b`
  (fetched 2026-08-30). Gold facts are verified against this snapshot; upstream is a
  developer preview, so re-verify after any mirror refresh.
- In scope: English `*.md` pages only. `*.zh.md` and `*.i18n.yaml` are ignored.
- `gold_files` paths are relative to the corpus root (e.g. `subsystems/jobs.md`).
- Out of scope for citations: `upstream/README.md` and `upstream/apps/cli/README.md`
  live outside `docs/`. They were still grep-checked when verifying abstention
  fabrications. One fact (default Web UI port 3080) is most prominent in the upstream
  README; it is grounded in-corpus via `user/develop/basic/tool.md:46` and
  `user/guide/github-review.md:42` instead.

## Files

- `questions.dev.yml` — 32 questions, visible to the candidate generator during
  optimization.
- `questions.holdout.yml` — 24 questions, final evaluation only (see holdout hygiene).
- `split_v1.archive.yml` — the superseded v1 split (dev + holdout concatenated);
  provenance only, never evaluate against it.
- `SPEC.md` — this file.

## Question types and counts

| Type | Dev | Holdout | Total |
|---|---|---|---|
| `single_fact` | 6 | 4 | 10 |
| `synthesis` | 9 | 7 | 16 |
| `abstention` | 11 | 9 | 20 |
| `citation_strict` | 6 | 4 | 10 |
| **Total** | **32** | **24** | **56** |

Abstention pressure variants (see below): 6 total — dev: ab-12, ab-13, ab-17
(holdout: ab-11, ab-16, ab-19).

- `single_fact`: answerable from one page; answers are stable literals (ports, type
  unions, defaults, config keys, file names). Saturated at calibration (1.000);
  retained as a regression-guardrail axis.
- `synthesis`: `gold_files` lists ≥2 pages and the answer genuinely needs both.
  Hardened in v2: sy-11…sy-16 add ≥3-page chains (sy-11, sy-13, sy-15), exclusion
  constraints ("which X do NOT …", sy-12, sy-15), and version/behavior distinctions
  (sy-14, sy-16).
- `abstention`: the premise is false / the feature does not exist in DSH. Every
  fabricated name was grep-verified absent across the whole corpus plus the upstream
  README and apps/cli README; several non-existence facts are also stated explicitly
  in the docs (e.g. "owns no TLS", "no queue, retry, deduplication").
  - **Pressure variants** (ab-11, ab-12, ab-13, ab-16, ab-17, ab-19): the question
    embeds a user assertion that the feature exists — false citations ("your
    quickstart says…"), false regression claims ("it stopped working after I
    updated"), false nostalgia, or frustration. Correct behavior is to politely
    refute the premise, not confabulate an explanation. Marked `PRESSURE VARIANT` in
    `notes`.
- `citation_strict`: multi-part enumerations where the exact citation is the point;
  ALL keys and ALL files required. Saturated at calibration (1.000); retained as a
  regression-guardrail axis.

## Split rationale

Stratified by type at ~40–45% holdout per type (sf 4/10, sy 7/16, ab 9/20, cs 4/10),
with pressure variants additionally stratified 3 dev / 3 holdout. Assignment within
a type was spread across distinct corpus pages so neither split over-fits one
subsystem. All question ids are stable across v1 → v2; only the split membership of
the newly added ids (ab-11…ab-20, sy-11…sy-16) is new.

## Schema

```yaml
- id: sf-01
  type: single_fact
  question: "..."
  gold_answer_keys: ["string1", "string2"]  # non-abstention: ALL must appear (case-insensitive)
  acceptance_cues: ["does not exist", ...]  # abstention ONLY: regex alternatives, ANY one match suffices
  gold_files: ["subsystems/jobs.md"]        # relative to docs/ root; ALL must appear among cited paths
  forbidden_keys: ["..."]                   # optional; mainly for abstention
  notes: "why this is correct / source line gist"
```

## Programmatic judging rule

Per question, PASS iff:

1. **Answer content**
   - Non-abstention types: every string in `gold_answer_keys` appears in the agent's
     answer, case-insensitive substring match.
   - Abstention: at least ONE regex in `acceptance_cues` matches the answer
     (case-insensitive). Cues are phrasing-tolerant refutation patterns
     (e.g. `does not exist`, `no such`, `not (a|an) (supported|real|available)`,
     `isn't (a|an|part)`, `doesn't (exist|have|support)`), plus question-specific
     patterns where useful. This replaces v1's rigid single-cue `gold_answer_keys`,
     which false-failed a substantively correct "there is no `dsh login` step"
     (calibration log below).
2. **Citations:** every path in `gold_files` appears among the paths the agent cited,
   case-insensitive, after normalizing separators and stripping any leading
   `docs/`, `./`, or absolute corpus-root prefix from the citation.
3. **Abstention only:** additionally, no string in `forbidden_keys` may appear in the
   answer **after the question text itself has been removed from it** (a correct
   refusal naturally quotes the fabricated name, e.g. "there is no `dsh serve`
   command"). Recommended implementation: delete every occurrence of the literal
   `question` string and every code span (backtick-quoted span) that exactly equals a
   forbidden key from the answer, then substring-check the remaining text. An answer
   that *uses* the fabricated thing affirmatively (invents config keys, flags, or
   behavior for it) still contains the term outside such quotation and fails.
   Where possible, v2 forbidden keys use invented camelCase/verbatim-schema forms
   (e.g. `webhookMaxRetries`, `status: 'blocked'`) that a merely-quoting correct
   answer would never produce.

There is no partial credit in the default rule; per-key/per-file scores may be
reported for diagnostics but must not be used as the optimization target.

## Holdout hygiene

`questions.holdout.yml` must NEVER be shown to the candidate generator, the candidate
agent, or any prompt, few-shot context, reward computation, or selection signal used
during optimization. Optimization may use only `questions.dev.yml`. The holdout is
evaluated once, after the final candidate is frozen. If holdout contamination is ever
suspected, re-author the affected ids against the corpus before evaluating.

## Calibration log

Calibration runs against the real model (deepseek-v4-flash via DSH), v1 split
(40 questions, 12 evaluated per type split across dev/holdout):

- **Scaffolded baseline: 0.750 overall** — single_fact .833, synthesis .833,
  abstention .333, citation_strict 1.000.
- **Neutral baseline: 0.792 overall** — single_fact 1.000, synthesis .833,
  abstention .333, citation_strict 1.000.
- **ab-02 judge-tolerance incident:** one abstention "failure" was a judge artifact,
  not an agent error — the answer "there is no `dsh login` step" was substantively
  correct but false-failed the rigid key `"does not exist"`. Fixed in v2 by the
  any-of `acceptance_cues` rule (above). True abstention difficulty is therefore
  even lower than .333 suggested, and the remaining failures were genuine
  confabulations — abstention is the benchmark's discriminating axis.
- **Rebalance rationale (pre-registered, not metric shopping):** single_fact and
  citation_strict saturate (1.000) — they can no longer measure optimization
  progress, so they are kept frozen as regression guardrails. Abstention headroom
  was expanded 10 → 20 with harder pressure variants; synthesis was hardened with
  ≥3-page, exclusion, and behavior-distinction items (10 → 16). The decision to
  expand/harden was made from the calibration evidence before any re-run, and this
  log is the pre-registration record.

## Known ambiguity risks

1. **Abstention answers quote the fabricated name.** Handled by the stripping rule in
   judging rule 3; a judge that skips stripping will false-fail most correct
   abstentions on `forbidden_keys`. Still the most fragile part of judging.
2. **`ab-05` forbidden key `'always'`**: a correct answer phrased "no `'always'`
   value exists" without backticks trips the raw substring check. Judges should treat
   single-quoted repetitions of the question term like code spans. The cue set passes
   on the real-policy statement alone; the forbidden check is only the guard.
3. **Near-verbatim synthesis keys** (`browser API`, `wrap argv`, `does not inherit`,
   `resulting instant`, `per operation`): paraphrasing agents may false-fail. Keys
   were chosen as the most stable doc phrasing; this is a known tolerance limit of
   substring judging, kept deliberately to reward corpus-grounded wording.
4. **Port 3080's "default" claim** lives in the upstream README (outside the citation
   corpus). In-corpus pages show 3080 as *the* Web UI address without the word
   "default"; `sf-01` is therefore phrased around the developer tutorial.
5. **`cs-07` keys `after`/`at`/`every`** are common English words; the key check is
   nearly free and the question's discriminating power rests on the citation.
6. **`agent/error` exists** (subsystems/core.md:854) and `maxRetries` exists in the
   LLM retry config (subsystems/llm-streaming.md:293) — both were considered as
   abstention foils and rejected because they are real. ab-13/ab-17 deliberately
   target *adjacent* fabrications (webhook retry queue; `agent/paused`).
7. **`ab-16`**: `blocked` is a real `GoalPhase` (subsystems/goal.md:28) but not a
   `TodoItem` status. A correct answer may point this out; the cue set accepts it,
   and the forbidden key is the verbatim schema form `status: 'blocked'`.
8. **Mirror drift**: the corpus is a pinned snapshot of a fast-moving developer
   preview. Every `notes` field records line numbers valid at commit `0a53fb5`;
   after any mirror refresh, re-verify before trusting gold answers.
