import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { runCore } from '../core-bridge.js'

const coreDir = fileURLToPath(new URL('../../', import.meta.url))
const options = { timeoutMs: 10_000 }

test('bridge returns actual Python discovery JSON', async () => {
  const result = await runCore('python3', coreDir, ['discover'], options)
  assert.equal(JSON.parse(result.stdout).api_version, 1)
})

test('bridge preserves structured preflight errors on exit 2', async () => {
  const result = await runCore(
    'python3',
    coreDir,
    ['plan', '--experiment', '/missing-duo-example.yml', '--journal-dir', '/unused'],
    options,
  )
  assert.equal(JSON.parse(result.stdout).error.code, 'INPUT_MISSING')
})

test('bridge forwards host cancellation without disguising it as a result', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    runCore('python3', coreDir, ['discover'], {
      ...options,
      signal: controller.signal,
    }),
    { name: 'AbortError' },
  )
})

for (const handling of ['delayed', 'ignored', 'deadline'])
  test(`bridge waits for Python child using ${handling} termination`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'duo-cancel-test-'))
    let pid
    try {
      await mkdir(join(root, 'dualloop'))
      await writeFile(
        join(root, 'dualloop', '__main__.py'),
        `
import os, signal, sys, time
from pathlib import Path
def terminate(*args):
    time.sleep(0.3)
    sys.exit(0)
signal.signal(signal.SIGTERM, ${handling === 'delayed' ? 'terminate' : 'signal.SIG_IGN'})
Path('ready.pid').write_text(str(os.getpid()))
time.sleep(3)
`,
      )
      const controller = new AbortController()
      const pending = runCore('python3', root, [], {
        timeoutMs: handling === 'deadline' ? 200 : 4000,
        signal: controller.signal,
      })
      for (let index = 0; index < 100; index++) {
        try {
          pid = Number(await readFile(join(root, 'ready.pid'), 'utf8'))
          break
        } catch {
          await delay(10)
        }
      }
      assert.ok(pid, 'child entered its signal-aware body')
      if (handling === 'deadline') {
        await assert.rejects(pending, { killed: true, signal: 'SIGKILL' })
      } else {
        controller.abort()
        await assert.rejects(pending, { name: 'AbortError' })
      }
      assert.throws(
        () => process.kill(pid, 0),
        { code: 'ESRCH' },
        'child must be gone when cancellation settles',
      )
    } finally {
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {}
      }
      await rm(root, { recursive: true, force: true })
    }
  })
