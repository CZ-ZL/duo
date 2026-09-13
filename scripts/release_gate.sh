#!/usr/bin/env bash
# Offline product gate. Retained-research replay is separate (TESTING.md).
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
run_check native env DUO_DSH_PACKAGE="$DSH_PKG" node --loader ./scripts/dsh_native_loader.mjs --test dsh-plugin/native/*.test.js dsh-plugin/*.test.js
run_check python-product env DUO_DSH_PACKAGE="$DSH_PKG" python3 -m pytest tests/ -q -m 'not research' -p no:cacheprovider --basetemp "$OUT/pytest-work"
run_check host python3 scripts/verify_dsh_native.py --dsh-package "$DSH_PKG" --output "$OUT/verify"
touch "$OUT/user.npmrc" "$OUT/global.npmrc"
cd dsh-plugin
run_check npm-pack env NPM_CONFIG_USERCONFIG="$OUT/user.npmrc" NPM_CONFIG_GLOBALCONFIG="$OUT/global.npmrc" NPM_CONFIG_CACHE="$OUT/npm-cache" npm pack --offline --ignore-scripts --json --pack-destination "$OUT"
cd ..
run_check package python3 scripts/check_release_package.py "$OUT/npm-pack.log" "$OUT"
echo "PRODUCT RELEASE GATE PASS — $OUT"
echo "Historical research replay, registry installation and real model efficacy are separate claims."
