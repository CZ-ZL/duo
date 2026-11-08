import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const versions = {
  '@deepseek-ai/cordis': '4.0.2',
  '@deepseek-ai/cordis-plugin-group': '1.0.2',
  '@deepseek-ai/cordis-plugin-hmr': '1.0.17',
  '@deepseek-ai/cordis-plugin-include': '1.0.7',
  '@deepseek-ai/cordis-plugin-loader': '1.0.3',
  '@deepseek-ai/cordis-plugin-timer': '1.1.4',
  '@deepseek-ai/cosmokit': '1.8.3',
  '@deepseek-ai/schemastery': '3.18.2',
}
function host(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'duo-host-check-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'lib'))
  writeFileSync(
    join(root, 'lib/bin.js'),
    'throw Error("host execution is forbidden in this check")',
  )
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.2-rc.1' }),
  )
  for (const [name, version] of Object.entries({ ...versions, ...overrides })) {
    const dir = join(root, 'node_modules', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }))
  }
  return root
}
function check(path) {
  const result = spawnSync(
    process.execPath,
    [new URL('../bin/duo.mjs', import.meta.url).pathname, 'check-host', '--dsh-package', path],
    { encoding: 'utf8' },
  )
  return { ...result, value: result.stdout.trim() ? JSON.parse(result.stdout) : null }
}

test('host check reports the verified composition without launching or modifying the host', (t) => {
  const path = host(t),
    before = readdirSync(path, { recursive: true }).sort()
  const result = check(path)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.value.status, 'compatible')
  assert.equal(result.value.modelRequests, 0)
  assert.equal(result.value.packages.length, 9)
  assert.deepEqual(result.value.issues, [])
  assert.deepEqual(readdirSync(path, { recursive: true }).sort(), before)
})

test('host check rejects the known incompatible Cordis family before any model work', (t) => {
  const result = check(host(t, { '@deepseek-ai/cordis': '4.1.0' }))
  assert.equal(result.status, 2, result.stderr)
  assert.equal(result.value.status, 'unsupported')
  assert.ok(
    result.value.issues.some(
      (x) => x.package === '@deepseek-ai/cordis' && x.actual === '4.1.0' && x.expected === '4.0.2',
    ),
  )
  assert.match(result.value.nextAction, /HOST|host/i)
})

test('host check reports missing metadata without creating the requested path', (t) => {
  const root = host(t),
    path = join(root, 'absent')
  const result = check(path)
  assert.equal(result.status, 2, result.stderr)
  assert.equal(result.value.status, 'unsupported')
  assert.ok(result.value.issues.some((x) => x.code === 'DSH_PACKAGE_UNAVAILABLE'))
  assert.ok(!readdirSync(root).includes('absent'))
})
