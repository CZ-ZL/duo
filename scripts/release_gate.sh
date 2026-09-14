#!/usr/bin/env bash
# Zero-model product gate. Package installation may download dependencies.
set -euo pipefail
cd "$(dirname "$0")/.."
DSH_PKG="${DUO_DSH_PACKAGE:-$HOME/.dsh/profiles/node_modules/@deepseek-ai/dsh}"
OUT="$(python3 -c 'from pathlib import Path;import sys;print(Path(sys.argv[1]).resolve())' "${1:-/tmp/duo-release-$(date +%Y%m%d-%H%M%S)}")"
[ -f "$DSH_PKG/lib/bin.js" ] || { echo "FAIL: DSH package not found at $DSH_PKG (set DUO_DSH_PACKAGE)"; exit 1; }

mkdir "$OUT"
run_check() {
  local label="$1"
  shift
  echo "Checking $label"
  if "$@" > "$OUT/$label.log" 2>&1; then
    tail -8 "$OUT/$label.log"
  else
    local result=$?
    tail -60 "$OUT/$label.log"
    echo "FAILED: $label (exit $result); full log at $OUT/$label.log"
    return "$result"
  fi
}
# Fail early on actual installation before expensive behavioral suites. The
# same checks still all run; no failure is skipped or silently downgraded.
touch "$OUT/user.npmrc" "$OUT/global.npmrc"
cd dsh-plugin
run_check npm-pack env NPM_CONFIG_USERCONFIG="$OUT/user.npmrc" NPM_CONFIG_GLOBALCONFIG="$OUT/global.npmrc" NPM_CONFIG_CACHE="$OUT/npm-cache" npm pack --offline --ignore-scripts --json --pack-destination "$OUT"
cd ..
run_check package env DUO_DSH_PACKAGE="$DSH_PKG" python3 scripts/check_release_package.py "$OUT/npm-pack.log" "$OUT"
ARCHIVE="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))[0]["filename"])' "$OUT/npm-pack.log")"
run_check install python3 scripts/verify_product_install.py --archive "$OUT/$ARCHIVE" --dsh-package "$DSH_PKG" --output "$OUT/install"
run_check public-examples python3 scripts/verify_product_examples.py --package "$OUT/install/dsh-home/profiles/install-check/node_modules/@dual-loop/dsh-plugin" --dsh-package "$DSH_PKG" --output "$OUT/public-examples"
run_check sandbox python3 - "$OUT" <<'PY'
import json
from pathlib import Path
import sys
from scripts.code_evaluation import run_case

row = run_case('def task_func(x): return abs(x)',
               'import unittest\nclass TestCases(unittest.TestCase):\n'
               ' def test_control(self): self.assertEqual(task_func(-3), 3)\n',
               Path(sys.argv[1]) / 'sandbox-control')
print(json.dumps(row, indent=2))
if not row['taskPassed']:
    raise SystemExit('Isolated Python execution is unavailable; inspect sandbox.log and sandbox-control/stderr.txt. No unsafe fallback.')
PY
run_check native env DUO_DSH_PACKAGE="$DSH_PKG" node --loader ./scripts/dsh_native_loader.mjs --test dsh-plugin/native/*.test.js dsh-plugin/*.test.js
run_check docs node scripts/sync_product_docs.mjs --check
run_check python-product env DUO_DSH_PACKAGE="$DSH_PKG" python3 -m pytest tests/ -q -m 'not research' -p no:cacheprovider --basetemp "$OUT/pytest-work"
run_check host python3 scripts/verify_dsh_native.py --dsh-package "$DSH_PKG" --output "$OUT/verify"
echo "PRODUCT RELEASE GATE PASS — $OUT"
echo "Historical research replay, independent Calling Agent judgment and method efficacy are separate claims."
