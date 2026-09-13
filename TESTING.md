# Test scopes

Use Linux, Node 24+, Python 3.10+, PyYAML and pytest, and an existing DSH
`0.1.2-rc.1` installation. The native plugin does not require Python at runtime.

The code-evaluation checks additionally require Linux user/mount/PID/network
namespaces with UID mapping, `/usr/bin/python3`, chroot and libseccomp. The gate
first runs an isolated reference program and reports bounded startup stderr on
failure. It does not weaken isolation when a host denies these capabilities.
The attempted GitHub Ubuntu 24.04 image refused `/proc/self/uid_map`; the workflow
uses Ubuntu 22.04 as its compatibility target. See Actions for actual run results.

## Product verification

```sh
export DUO_DSH_PACKAGE=/absolute/path/to/node_modules/@deepseek-ai/dsh
bash scripts/release_gate.sh /tmp/new-duo-release-check
```

This runs every native test, the self-contained Python checks, 21 isolated DSH
CLI scenarios, and inspection of the actual npm tarball. The `packaged` scenario
uses the shipped contract/persona and default fixture provider without inserting
the verifier's alternate work provider. No model credentials or model calls are
needed. Provider output remains explicitly synthetic.

Every stage retains a complete log. A failing stage fails the gate. The output
directory must be new. Existing dependencies are reused; no installation occurs.

The standalone commands are:

```sh
node --loader ./scripts/dsh_native_loader.mjs --test dsh-plugin/native/*.test.js dsh-plugin/*.test.js
python3 -m pytest tests/ -q -m 'not research'
python3 scripts/verify_dsh_native.py --dsh-package "$DUO_DSH_PACKAGE" --scenario packaged --output /tmp/new-duo-demo
```

## Historical research replay

`tests/research_cases.json` explicitly lists test functions which require the
original benchmark snapshots, calibration details or experiment receipts under
`runs/`. `conftest.py` marks those functions `research`; it does not skip them or
change their assertions. The product command explicitly deselects them. They
must not be reported as passed, replaced by fixture results, or counted as
method-effectiveness validation.

```sh
python3 -m pytest tests/ -q -m research
```

That command requires the original, separately reviewed research archive at its
recorded paths. It will fail when the inputs are absent. A complete `pytest
tests/` also includes these tests and requires the same archive. This source
distribution excludes raw run directories and does not yet provide a standalone
public archive reproducing the historical experiments.

The initial source-only audit retained 28 failures and 45 errors, predominantly
missing research files, alongside 421 passes and 41 skips without the optional
DSH environment variable. That failure record is not replaced by the scoped
product result. The new self-contained legacy wiring control exercises actual
construction with temporary synthetic seed details; the historical-score test
is preserved separately.

## Evidence limits

Passing these checks establishes local package behavior with the named installed
DSH snapshot. It does not establish fresh registry installation, Windows/macOS
support, TypeScript semantic compilation, real Calling Agent judgment, or quality
and cost advantages of the optimization method. Those require their own evidence.
