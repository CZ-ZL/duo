import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Package-only callers must receive the canonical instructions. Repository
// navigation now links here instead of maintaining duplicate root copies.
test('the package contains the canonical calling-agent guides', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  for (const f of ['AGENT_GUIDE.md', 'AGENT_REFERENCE.md']) {
    assert.ok(manifest.files.includes(f), f + ' missing from package files')
    assert.ok(readFileSync(new URL('../../' + f, import.meta.url), 'utf8').trim())
  }
})
