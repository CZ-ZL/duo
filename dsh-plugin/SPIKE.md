# Phase B Spike — DSH-native packaging of DualLoop

**Date:** 2026-09-06 · **Scope:** time-boxed feasibility spike, offline only (zero DeepSeek API spend) · **dsh:** `@deepseek-ai/dsh@0.1.2-rc.1` (npx cache), mirror pinned at upstream commit `0a53fb55`

**Verdict: feasible.** A thin cordis plugin (`@dual-loop/dsh-plugin`) that wraps the Python protocol core via child process **loads in a real DSH profile, validates its config through the Schemastery schema, resolves through the documented bundle/patch layering, and its tools demonstrably drive the Python core** — all without an API key. The riskiest unknown (local-plugin install mechanics) is resolved, with one docs-vs-reality deviation that matters (below).

## What was built

```
dualloop/dsh-plugin/
  package.json        @dual-loop/dsh-plugin — type:module, main:index.js, dsh.bundle.patch declaration,
                      peerDeps on @deepseek-ai/{cordis,dsh-tools,schemastery} (mirrors @max-null/dsh-memory)
  index.js            the plugin: name/inject/Config/apply; registers dualloop_status + dualloop_run tools
  cordis.patch.yml    bundle layer: one insert row (id `dualloop`) with placeholder config
  README.md           install / configure / verify instructions
  SPIKE.md            this file
  dual-loop-dsh-plugin-0.1.0.tgz   pnpm pack artifact (the installable unit — see below)
```

Note (2026-09): the 0.1.0 tarball referenced here was never officially released,
is deprecated, and has been removed from the repository. The mechanics below are
historical record; the current install path is in README.md.

Python core: one additive shim, `python3 -m dualloop status --journal-dir DIR` (JSON journal summary; exit 0 on empty journal, fail-loud on malformed history). No behavior change; **108/108 tests still pass.**

The plugin is deliberately an adapter: it spawns `python3 -m dualloop run|status` with paths from its config and returns stdout. No experiment logic in TS.

## Load mechanics that worked (the spike's main deliverable)

1. **Pack:** `pnpm pack` → tarball. Plain JS + no build step means the tarball is the artifact (sidesteps the documented git-install `prepare`/allowBuilds catch entirely).
2. **Install:** `dsh plugin --profile dualloop-plugin-test add /abs/path/dual-loop-dsh-plugin-0.1.0.tgz`. pnpm installs the tarball as a **real directory** in the profile's `node_modules`; because the package declares `dsh.bundle`, `dsh plugin` auto-appends it to `dsh.profile.bundles`.
3. **Configure:** profile `cordis.patch.yml` overrides row id `dualloop`'s **entire** config block (patch = replace, not deep merge — must restate all keys).
4. **Verify:** `dsh --profile dualloop-plugin-test --dump-config` shows the composed layer (evidence below).

The reference profile `$DSH_HOME/profiles/dualloop-plugin-test/` is left installed as living evidence.

### Why the tarball and not a path install

First attempt — `dsh plugin add <source dir>` — installs as `link:` (symlink). Boot then **fails**:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@deepseek-ai/schemastery'
imported from /path/to/dualloop/dsh-plugin/index.js
```

Cause: Node realpaths the symlink, so the plugin's own bare imports resolve from the *source* directory, not the profile. dsh's runtime module fallback (`healProfilesModuleFallback` in `@deepseek-ai/dsh-app-boot`) maintains `$DSH_HOME/profiles/node_modules` as a symlink farm mirroring the dsh installation's dependency closure — that farm is only on the resolution path of modules that physically live under `$DSH_HOME/profiles/`. The upstream `hello-plugin` tutorial gets away with a directory install because it imports nothing. Any plugin with real imports needs the tarball (or npm publish). **This is the one finding the docs imply but never state plainly.**

### Profile creation mechanics

- `dsh plugin --profile <new> add <pkg>` initializes the profile with `@deepseek-ai/dsh-base` only (custom names don't get the `headless` template).
- In-box bundles **cannot** be added via `dsh plugin add @deepseek-ai/dsh-headless` — it forwards to pnpm, which hits the npm registry and 404s on the unpublished transitive `@deepseek-ai/dsh-code-runtime-worker`. Workaround (matches the pre-existing `dualloop`/`evo` profiles on this machine): hand-edit `dsh.profile.bundles` to `["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"]` and set `patchReload: "startup"`. Docs say "never write a profile manifest by hand"; reality currently requires it for this step.

## Evidence

`--dump-config` (config layering visible in the layer header — bundle patched by profile):

```
# == @dual-loop/dsh-plugin, patched by $DSH_HOME/profiles/dualloop-plugin-test/cordis.patch.yml
- id: dualloop
  name: '@dual-loop/dsh-plugin'
  config:
    experiment: /path/to/dualloop/experiments/mock.yml
    coreDir: /path/to/dualloop
    python: python3
    runTimeoutMs: 1800000
```

Live headless boot, `DEEPSEEK_API_KEY` unset (zero cost — no credentials exist on this machine at all): plugin loads, schema-validated config applied, both `ctx.tools.register` calls complete, then the boot reaches the model call and fails as expected:

```
[dual-loop] plugin loaded (experiment: .../experiments/mock.yml, journal: .../experiments/journal)
dsh: MISSING_CREDENTIAL: llm-deepseek: no API key for provider route "deepseek-official"; ...
```

Tool-surface demo (offline; the mock experiment is the project's no-API regression fixture). Driven through the installed plugin with a mock cordis ctx:

```
registered tools: dualloop_status,dualloop_run
--- dualloop_run ({generations: 1}) → python3 -m dualloop run --experiment /tmp/dl-spike/mock.yml ---
experiment : mock-skill-quality
mode       : optimize
stop       : completed
evals      : fast=9 slow=3 cost=$0.6900
champion   : dl-0007
--- dualloop_status → JSON.parse'd by the tool before returning ---
journal: /tmp/dl-spike/journal | transitions: 39 | candidates: 9 | champion: dl-0007
```

Also verified through the schema: empty config rejected at load (fail-loud), defaults filled (`python`, `runTimeoutMs`).

## Docs vs reality

| # | Docs say | Actually |
|---|---|---|
| 1 | `dsh plugin add ./hello-plugin` installs a local plugin | True only for **dependency-free** plugins. With bare imports, `link:` realpathing breaks resolution; use `pnpm pack` tarball (the docs bless tarballs for distribution but don't explain *this* failure mode). |
| 2 | Never hand-edit the profile manifest | Required today to put an in-box bundle (`dsh-headless`) into a custom profile — registry add 404s. |
| 3 | Bundle = `dsh.bundle.patch` + patch rows reference the package by name | Exactly as documented; auto-enrollment into `bundles` on `add` works. |
| 4 | Patch replaces a row's whole `config`, no deep merge | Confirmed — profile patch must restate all keys. |
| 5 | Config via Schemastery schema, fail loud on bad config | Confirmed; empty config rejects at load. |

## Idiom checklist (against the dsh skill's rules)

Namespace exports only (no `export default` — postmortem 0001) ✓ · `inject = ['tools']` so the plugin goes PENDING rather than wrongly active without dsh-base ✓ · registration as effects (auto-rollback on unload) via `ctx.tools.register` ✓ · `defineTool` with canonical `output.schema` + `render` ✓ · `exec.signal` forwarded to the child process ✓ · no timers/handles held (child processes are awaited per call) ✓ · policy stays out of the tool (no approval/guard logic inside) ✓ · plain JS matching the tutorial shape, no build step ✓.

## Remaining gaps to a "real" Phase B

1. **No Service seam.** The spike registers tools directly. The seam-idiomatic version is Definition (a cordis `Service` subclass, not a TS interface) → Provider (the loop driver) → Consumer (the tools), so a future native-TS provider can replace the child-process provider by changing one config row.
2. **Tool invocation was never exercised inside a live agent session** — that needs a configured model (API spend). What is proven: plugin activation in a real boot, and tool `execute` against the real core outside a session.
3. **No approval-layer chord** for human review of `dualloop_run` on non-mock contracts (DEFERRED in DESIGN.md anyway; the test profile pins `approval: never`, fail-closed).
4. **Error surfacing is plain-text.** A core traceback becomes an `isError` tool result; fine for a spike, but a real plugin should map core failure modes (budget exhausted, contract invalid) to structured tool errors.
5. **Config is file-path based.** `coreDir` is a localhost-ism; a distributable plugin wants a pip-installed `dualloop` (then `coreDir` disappears).
6. **Candidate-delta format** (cordis patch overlays generated by the core) is untouched here — it lives in the Python Mutator; Phase B proper should demo a delta applied as a DSH profile patch.

## Effort estimate

Actual spike: ~1 day equivalent (most of it in the load-mechanics investigation). Remaining to "real" Phase B per DESIGN.md (service seam + provider/consumer split, structured errors, approval chord, third-party install docs): **2–3 days**, assuming dsh stays at this API level. The child-process adapter itself is done and needs no rework — the seam refactor wraps it, it doesn't replace it.

## Recommendation: is child-process wrapping presentable as "DSH-native"?

**Yes, with honest framing — and the framing should lead with what this spike proved.** The plugin *is* DSH-native by the definition that matters to the DSH team: it installs through `dsh plugin`, composes through bundle/patch layering, validates config through Schemastery, registers through `ctx.tools` with `defineTool`'s canonical contract, honors inject-based lifecycle, and would hot-swap cleanly. What runs *inside* the tools is a child process — but that is a defensible engineering choice, not a smell: the protocol core is deliberately language-stable, offline-testable Python (108 tests), and DESIGN.md's integration boundary ("DSH executes; DualLoop orchestrates") never promised a TS reimplementation. Two conditions for the honest version:

1. **Present it as "thin cordis shell over a language-stable core," with the seam refactor (gap #1) as the named next step** — that shows we know what the fully-idiomatic shape is and made a deliberate protocol-first sequencing call (DESIGN.md principle 11), not that we couldn't do the TS version.
2. **Don't oversell "installable into any DSH profile"** until gap #2 is closed with a real (budgeted) model session — one live `dualloop_run` through the headless runner on the mock contract would do it and costs one trivial session.

If the audience pushes, the thin-service version (cordis `Service` provider wrapping the same child process) is days, not weeks — say so, and show this file.
