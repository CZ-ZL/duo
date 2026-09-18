#!/usr/bin/env node
// Dynamic preparation-path gate: every example-style relative path returned by
// the shipped public preparation flow (dualloop_design preparation actions)
// must exist inside the actually installed package. Static source checks cannot
// catch packaging drift; see runs/…/blank-caller-round2-20260915/PREPARATION_PATH_AUDIT.json.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2),
  at = (name) => {
    const i = args.indexOf('--' + name)
    if (i < 0 || !args[i + 1]) throw new Error(`missing --${name}`)
    return args[i + 1]
  }
const pkg = resolve(at('package')),
  output = resolve(at('output'))

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

const onboarding = await import(pathToFileURL(resolve(pkg, 'native/onboarding.js')).href)
if (typeof onboarding.designDraft !== 'function')
  throw new Error('installed onboarding module does not export designDraft')
const designed = onboarding.designDraft({}, '/tmp/duo-preparation-path-check.json', {}, undefined),
  actions = designed.preparation?.actions
if (!Array.isArray(actions)) throw new Error('installed preparation returned no actions')
const paths = [...new Set(collectExamplePaths(actions))],
  missing = paths.filter((p) => !existsSync(resolve(pkg, p)))
mkdirSync(output, { recursive: true })
writeFileSync(
  resolve(output, 'preparation-paths.json'),
  JSON.stringify(
    { package: pkg, checked: paths, missing, status: missing.length ? 'FAIL' : 'PASS' },
    null,
    2,
  ),
)
if (missing.length) {
  console.error(`preparation references absent resources: ${missing.join(', ')}`)
  process.exit(1)
}
console.log(`preparation paths verified in installed package (${paths.length} checked)`)
