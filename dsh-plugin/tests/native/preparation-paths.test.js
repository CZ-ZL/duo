import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as Onboarding from '../../native/onboarding.js'

// Package root as shipped: npm packs dsh-plugin/ itself, so preparation
// references must resolve inside this directory (runs/…/blank-caller-round2-20260915
// PREPARATION_PATH_AUDIT.json recorded four examples/native paths that were
// absent from the installed package).
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function collectExamplePaths(value, found = []) {
  if (typeof value === 'string') {
    if (value.startsWith('examples/')) found.push(value)
  } else if (Array.isArray(value)) {
    for (const item of value) collectExamplePaths(item, found)
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectExamplePaths(item, found)
  }
  return found
}

test('public preparation references only example resources present in the package', () => {
  const designed = Onboarding.designDraft(
      {},
      '/tmp/duo-preparation-path-check.json',
      {},
      undefined,
    ),
    actions = designed.preparation?.actions
  assert.ok(Array.isArray(actions), JSON.stringify(designed.preparation))
  const paths = [...new Set(collectExamplePaths(actions))]
  assert.ok(
    paths.length >= 4,
    `expected at least the four build_evaluator resources, got ${JSON.stringify(paths)}`,
  )
  const missing = paths.filter((p) => !existsSync(resolve(packageRoot, p)))
  assert.deepEqual(
    missing,
    [],
    `preparation references resources absent from the package: ${missing.join(', ')}`,
  )
})
