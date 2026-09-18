import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SqliteJournal, ReservedBudget, units, owner as ownerSelf } from '../../native/store.js'

const limits = { maxCostUsd: 1, maxSessions: 10, maxFastEvals: 3, maxSlowEvals: 2 }
async function setup(t, root = mkdtempSync(join(tmpdir(), 'duo-native-store-'))) {
  const ctx = new Context()
  const journal = await ctx.plugin(SqliteJournal, { root })
  const budget = await ctx.plugin(ReservedBudget)
  t.after(async () => {
    await budget.dispose()
    await journal.dispose()
  })
  return { ctx, root, ledger: () => ctx.duoBudget.open('run1', limits) }
}
test('native status does not create a missing run', async (t) => {
  const { ctx, root } = await setup(t)
  assert.equal(ctx.duoJournal.open('missing', { create: false }), null)
  assert.equal(existsSync(join(root, 'missing')), false)
})
test('bounded native history reads enforce event and UTF-8 byte limits without changing the journal', async (t) => {
  const { ctx, root } = await setup(t),
    j = ctx.duoJournal.open('history', { create: true })
  j.claim('history')
  j.append({ kind: 'candidate', text: '历史' })
  j.append({ kind: 'candidate', text: 'other' })
  j.complete({ status: 'completed' })
  const reader = ctx.duoJournal.open('history'),
    rows = reader.events(),
    bytes = Buffer.byteLength(rows.map(JSON.stringify).join(''))
  const { readFileSync } = await import('node:fs'),
    file = join(root, 'history', 'duo.sqlite'),
    before = readFileSync(file)
  assert.deepEqual(reader.events({ maxEvents: 2, maxBytes: bytes }), rows)
  assert.throws(() => reader.events({ maxEvents: 1, maxBytes: bytes }), {
    code: 'DUO_HISTORY_LIMIT',
  })
  assert.throws(() => reader.events({ maxEvents: 2, maxBytes: bytes - 1 }), {
    code: 'DUO_HISTORY_LIMIT',
  })
  for (const options of [
    { maxEvents: 0, maxBytes: bytes },
    { maxEvents: 2, maxBytes: NaN },
    { maxEvents: 2 },
    { maxBytes: bytes },
  ])
    assert.throws(() => reader.events(options), { code: 'DUO_HISTORY_LIMIT' })
  assert.deepEqual(readFileSync(file), before)
  assert.deepEqual(reader.events(), rows)
})
test('native budget reserves atomically and rejects duplicate or excess work', async (t) => {
  const { ledger } = await setup(t),
    b = ledger()
  b.reserve('op1', { phase: 'generation', maxCostUsd: 0.7, request: { prompt: 'x' } })
  assert.equal(b.snapshot().reservedCostUsd, 0.7)
  assert.equal(b.snapshot().costUsd, null)
  assert.throws(() => b.reserve('op1', { phase: 'generation', maxCostUsd: 0 }), {
    code: 'DUO_OPERATION_EXISTS',
  })
  assert.throws(() => b.reserve('op2', { phase: 'evaluation', maxCostUsd: 0.4 }), {
    code: 'DUO_BUDGET_EXHAUSTED',
  })
})
test('native receipt replay charges once and releases only unused reservation', async (t) => {
  const { ledger } = await setup(t),
    b = ledger()
  b.reserve('a', { phase: 'evaluation', tier: 'fast', maxCostUsd: 0.5 })
  const receipt = b.stage('a', 0.2, 'receipt-a')
  b.reconcile(receipt)
  b.reconcile(receipt)
  assert.equal(b.snapshot().costUsd, 0.2)
  assert.equal(b.snapshot().reservedCostUsd, 0)
  assert.equal(b.snapshot().fastAttempts, 1)
  assert.throws(() => b.settle('a', 0.1, 'conflict'), { code: 'DUO_RECEIPT_CONFLICT' })
})
test('native unknown survives reload and another receipt cannot clear it', async (t) => {
  const { ledger } = await setup(t),
    b = ledger()
  b.reserve('a', { phase: 'generation', maxCostUsd: 0.4 })
  b.reserve('b', { phase: 'evaluation', maxCostUsd: 0.4 })
  b.settle('a', null, 'unknown')
  b.settle('b', 0.1, 'known')
  const reloaded = ledger()
  assert.equal(reloaded.snapshot().costUsd, null)
  assert.equal(reloaded.snapshot().knownCostUsd, 0.1)
  assert.throws(() => reloaded.reserve('c', { phase: 'generation', maxCostUsd: 0 }), {
    code: 'DUO_COST_UNKNOWN',
  })
  reloaded.settle('a', 0.2, 'corrected')
  assert.equal(reloaded.snapshot().costUsd, 0.3)
})
test('native overrun is charged in full and stops further work', async (t) => {
  const { ledger } = await setup(t),
    b = ledger()
  b.reserve('a', { phase: 'generation', maxCostUsd: 0.1 })
  assert.throws(() => b.settle('a', 0.2, 'over'), { code: 'DUO_RESERVATION_OVERRUN' })
  assert.equal(b.snapshot().costUsd, 0.2)
  assert.throws(() => b.reserve('b', { phase: 'generation', maxCostUsd: 0 }), {
    code: 'DUO_RESERVATION_OVERRUN',
  })
})
test('native evaluation attempt limits are cumulative across reopen', async (t) => {
  const { ledger } = await setup(t)
  for (let i = 0; i < 3; i++) {
    const b = ledger()
    b.reserve('f' + i, { phase: 'evaluation', tier: 'fast', maxCostUsd: 0 })
    b.settle('f' + i, 0, 'r' + i)
  }
  assert.throws(
    () => ledger().reserve('f4', { phase: 'evaluation', tier: 'fast', maxCostUsd: 0 }),
    { code: 'DUO_BUDGET_EXHAUSTED' },
  )
})
test('native journal retains transitions and terminal result without overwriting claims', async (t) => {
  const { ctx } = await setup(t)
  const j = ctx.duoJournal.open('run1', { create: true })
  j.claim('digest')
  j.append({ kind: 'candidate', id: 'a' })
  j.complete({ status: 'completed', costUsd: 0 })
  assert.equal(j.events()[0].kind, 'candidate')
  assert.deepEqual(j.result(), { status: 'completed', costUsd: 0 })
  assert.throws(() => j.claim('different'), { code: 'DUO_PLAN_CHANGED' })
})
test('native checkpoint handoff freezes admission and preserves paid fixture settlement exactly once', async (t) => {
  const { ctx, ledger } = await setup(t),
    j = ctx.duoJournal.open('run1', { create: true })
  j.claim('digest')
  const b = ledger()
  b.reserve('measured', { phase: 'evaluation', tier: 'fast', maxCostUsd: 0.2 })
  b.settle('measured', 0.1, 'known')
  const receipts = b.receipts(),
    started = j.get('run').started,
    state = { format: 1, nextGeneration: 1, deadlineAt: Date.now() + 10000 }
  const checkpoint = j.saveCheckpoint(state, { boundary: 'baseline', pause: true })
  assert.equal(j.checkpointInfo().resumable, true)
  assert.throws(() => b.reserve('unapproved', { phase: 'generation', maxCostUsd: 0.1 }), {
    code: 'DUO_RESUME_REQUIRED',
  })
  assert.throws(() => j.append({ kind: 'uncheckpointed' }), { code: 'DUO_RESUME_REQUIRED' })
  assert.deepEqual(j.resume('digest', checkpoint), state)
  assert.equal(j.get('run').started, started)
  assert.deepEqual(b.receipts(), receipts)
  assert.equal(b.snapshot().costUsd, 0.1)
  assert.equal(j.checkpointInfo().resumable, false)
  b.reserve('next', { phase: 'generation', maxCostUsd: 0.2 })
  b.settle('next', 0.05, 'next-known')
  assert.equal(b.snapshot().costUsd, 0.15)
  j.complete({ status: 'completed' })
  assert.throws(() => j.resume('digest', checkpoint), { code: 'DUO_RUN_COMPLETE' })
})
test('checkpoint rejects a live running owner, expired deadline, changed evidence and missing settled receipt', async (t) => {
  for (const kind of ['live', 'expired', 'events', 'receipt']) {
    const { ctx, ledger } = await setup(t),
      j = ctx.duoJournal.open('run1', { create: true })
    j.claim('digest')
    const b = ledger()
    b.reserve('measured', { phase: 'evaluation', tier: 'fast', maxCostUsd: 0.2 })
    b.settle('measured', 0.1, 'known')
    const cp = j.saveCheckpoint(
      { format: 1, nextGeneration: 1, deadlineAt: Date.now() + (kind === 'expired' ? -1 : 10000) },
      { boundary: 'baseline', pause: kind !== 'live' },
    )
    if (kind === 'events')
      j.db
        .prepare('INSERT INTO events(payload) VALUES (?)')
        .run(JSON.stringify({ kind: 'unexpected' }))
    if (kind === 'receipt') j.db.exec('DELETE FROM receipts')
    assert.throws(() => j.resume('digest', cp), {
      code: {
        live: 'DUO_OWNER_ACTIVE',
        expired: 'DUO_DEADLINE_EXHAUSTED',
        events: 'DUO_CHECKPOINT_CHANGED',
        receipt: 'DUO_CHECKPOINT_CHANGED',
      }[kind],
    })
    assert.equal(b.operations().length, 1)
    assert.equal(j.checkpointInfo().resumable, false)
  }
})
test('no checkpoint is minted for an in-flight or unknown-cost operation', async (t) => {
  const { ctx, ledger } = await setup(t),
    j = ctx.duoJournal.open('run1', { create: true })
  j.claim('digest')
  const b = ledger()
  b.reserve('unknown', { phase: 'evaluation', tier: 'fast', maxCostUsd: 0.2 })
  const state = { format: 1, nextGeneration: 1, deadlineAt: Date.now() + 10000 }
  assert.throws(() => j.saveCheckpoint(state, { boundary: 'baseline', pause: true }), {
    code: 'DUO_COST_UNKNOWN',
  })
  b.settle('unknown', null, 'missing-usage')
  assert.throws(() => j.saveCheckpoint(state, { boundary: 'baseline', pause: true }), {
    code: 'DUO_COST_UNKNOWN',
  })
  assert.equal(j.get('checkpoint'), null)
  assert.equal(j.get('run').status, 'running')
  assert.equal(b.snapshot().costUsd, null)
})
test('native budget refuses limit drift and invalid amounts', async (t) => {
  const { ctx, ledger } = await setup(t)
  ledger()
  assert.throws(() => ctx.duoBudget.open('run1', { ...limits, maxCostUsd: 2 }), {
    code: 'DUO_BUDGET_CHANGED',
  })
  for (const amount of [-1, NaN, Infinity, true])
    assert.throws(() => ledger().reserve('bad', { phase: 'generation', maxCostUsd: amount }), {
      code: 'DUO_BUDGET_INVALID',
    })
})
test('inspection refuses an empty database without initializing its bytes', async (t) => {
  const { ctx, root } = await setup(t)
  const { mkdirSync, writeFileSync, statSync } = await import('node:fs')
  mkdirSync(join(root, 'empty'))
  const file = join(root, 'empty', 'duo.sqlite')
  writeFileSync(file, '')
  assert.throws(() => ctx.duoBudget.inspect('empty'), { code: 'DUO_STORAGE_INVALID' })
  assert.equal(statSync(file).size, 0)
})
test('completed journal cannot admit new operations', async (t) => {
  const { ctx, ledger } = await setup(t),
    b = ledger(),
    j = ctx.duoJournal.open('run1', { create: true })
  j.claim('digest')
  j.complete({ status: 'completed' })
  assert.throws(() => b.reserve('late', { phase: 'generation', maxCostUsd: 0 }), {
    code: 'DUO_RUN_COMPLETE',
  })
})
test('copied native ledger is not a new allowance', async (t) => {
  const { ctx, root, ledger } = await setup(t)
  ledger()
  const { mkdirSync, copyFileSync } = await import('node:fs')
  mkdirSync(join(root, 'copy'))
  copyFileSync(join(root, 'run1', 'duo.sqlite'), join(root, 'copy', 'duo.sqlite'))
  assert.throws(() => ctx.duoBudget.open('copy', limits), { code: 'DUO_STORAGE_INVALID' })
})
test('read-only handle cannot complete a claimed run', async (t) => {
  const { ctx } = await setup(t)
  ctx.duoJournal.open('run1', { create: true }).claim('digest')
  const reader = ctx.duoJournal.open('run1', { create: false })
  assert.throws(() => reader.complete({ status: 'completed' }), { code: 'DUO_STORAGE_READ_ONLY' })
  assert.equal(reader.result(), null)
})
test('existing missing table is refused without recreating empty accounting', async (t) => {
  const { root, ledger } = await setup(t)
  ledger()
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(join(root, 'run1', 'duo.sqlite'))
  db.exec('DROP TABLE operations')
  db.close()
  const other = new Context()
  const j = await other.plugin(SqliteJournal, { root })
  t.after(() => j.dispose())
  assert.throws(() => other.duoJournal.open('run1', { create: true }), {
    code: 'DUO_STORAGE_INVALID',
  })
})
test('corrupt operation amount never creates free reservation capacity', async (t) => {
  const { ledger } = await setup(t),
    b = ledger()
  b.reserve('x', { phase: 'generation', maxCostUsd: 0.5 })
  b.j.db
    .prepare('UPDATE operations SET payload=? WHERE id=?')
    .run(JSON.stringify({ ...b.operations()[0], reserved: -100 }), 'x')
  assert.throws(() => b.reserve('y', { phase: 'generation', maxCostUsd: 0.6 }), {
    code: 'DUO_STORAGE_INVALID',
  })
})
async function worker(t, root, body) {
  const { spawn } = await import('node:child_process'),
    { writeFileSync } = await import('node:fs')
  const file = join(root, 'worker-' + Math.random().toString(16).slice(2) + '.mjs')
  const code = `import {Context} from '@deepseek-ai/cordis';import {SqliteJournal,ReservedBudget} from ${JSON.stringify(new URL('../../native/store.js', import.meta.url).href)};const ctx=new Context();await ctx.plugin(SqliteJournal,{root:${JSON.stringify(root)}});await ctx.plugin(ReservedBudget);const b=ctx.duoBudget.open('run1',${JSON.stringify(limits)});${body}`
  writeFileSync(file, code)
  const child = spawn(
    process.execPath,
    [
      '--loader',
      new URL('../../../scripts/product/dsh_native_loader.mjs', import.meta.url).href,
      file,
    ],
    { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] },
  )
  let stdout = '',
    stderr = ''
  child.stdout.on('data', (d) => (stdout += d))
  child.stderr.on('data', (d) => (stderr += d))
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL')
  })
  const closed = new Promise((resolve) =>
    child.once('close', (code) => resolve({ code, stdout, stderr })),
  )
  const message = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('worker timeout: ' + stderr)), 5000)
    child.stdout.on('data', () => {
      if (stdout.includes('\n')) {
        clearTimeout(timer)
        resolve(JSON.parse(stdout.split('\n')[0]))
      }
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (!stdout.includes('\n')) reject(new Error('worker failed ' + code + ': ' + stderr))
    })
  })
  return { child, message, closed }
}
test('eight native Node processes share one reservation cap', async (t) => {
  const { root, ledger } = await setup(t),
    b = ledger()
  const workers = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      worker(
        t,
        root,
        `let admitted=false;try{b.reserve('w${i}',{phase:'generation',maxCostUsd:0.3});admitted=true}catch(e){if(e.code!=='DUO_BUDGET_EXHAUSTED')throw e}console.log(JSON.stringify({admitted}));await new Promise(r=>process.stdin.once('data',r));if(admitted)b.settle('w${i}',0.2,'rw${i}');process.exit(0);`,
      ),
    ),
  )
  assert.equal(workers.filter((w) => w.message.admitted).length, 3)
  assert.equal(b.snapshot().reservedCostUsd, 0.9)
  for (const w of workers) w.child.stdin.end('settle')
  for (const w of workers) assert.equal((await w.closed).code, 0)
  assert.equal(b.snapshot().knownCostUsd, 0.6)
})
test('real native child crash after staging reconciles exactly once', async (t) => {
  const { root, ledger } = await setup(t),
    b = ledger()
  const w = await worker(
    t,
    root,
    "b.reserve('crash',{phase:'generation',maxCostUsd:0.4});const receipt=b.stage('crash',0.1,'crash-receipt');console.log(JSON.stringify({receipt}));process.exit(23)",
  )
  assert.equal((await w.closed).code, 23)
  assert.equal(b.snapshot().blockedReason, 'DUO_COST_UNKNOWN')
  assert.throws(() => b.reserve('retry', { phase: 'generation', maxCostUsd: 0 }), {
    code: 'DUO_COST_UNKNOWN',
  })
  b.reconcile(w.message.receipt)
  b.reconcile(w.message.receipt)
  assert.equal(b.snapshot().costUsd, 0.1)
})
test('CNY admission, settlement and reload retain currency without relabelling USD history', async (t) => {
  const { ctx, ledger } = await setup(t),
    cny = { currency: 'CNY', maxCostCny: 3, maxSessions: 10, maxFastEvals: 3, maxSlowEvals: 2 }
  const b = ctx.duoBudget.open('cny', cny)
  b.reserve('a', { phase: 'generation', currency: 'CNY', maxCostCny: 0.15 })
  assert.equal(b.snapshot().reservedCostCny, 0.15)
  assert.equal(b.snapshot().costCny, null)
  assert.throws(() => b.reserve('bad', { phase: 'generation', maxCostUsd: 0.1 }), {
    code: 'DUO_CURRENCY_MISMATCH',
  })
  assert.throws(() => b.stage('a', 0.01, 'bad', { currency: 'USD' }), {
    code: 'DUO_CURRENCY_MISMATCH',
  })
  const h = b.stage('a', 0.0123, 'cny-receipt', { currency: 'CNY' })
  b.reconcile(h)
  b.reconcile(h)
  assert.equal(ctx.duoBudget.inspect('cny').costCny, 0.0123)
  assert.equal(b.snapshot().currency, 'CNY')
  assert.equal(b.snapshot().phases.generation.costCny, 0.0123)
  assert.equal(b.receipts()[0].currency, 'CNY')
  assert.equal(b.snapshot().costUsd, undefined)
  assert.throws(() => ctx.duoBudget.open('cny', limits), { code: 'DUO_BUDGET_CHANGED' })
  const usd = ledger()
  usd.reserve('a', { phase: 'generation', maxCostUsd: 0.5 })
  usd.settle('a', 0.2, 'usd')
  assert.equal(usd.snapshot().costUsd, 0.2)
  assert.equal(usd.snapshot().costCny, undefined)
})
test('CNY staging rejects nested USD tariffs and contradictory monetary evidence before releasing exposure', async (t) => {
  const { ctx } = await setup(t),
    b = ctx.duoBudget.open('nested-cny', {
      currency: 'CNY',
      maxCostCny: 3,
      maxSessions: 10,
      maxFastEvals: 3,
      maxSlowEvals: 2,
    })
  b.reserve('a', { phase: 'generation', currency: 'CNY', maxCostCny: 0.15 })
  for (const costEvidence of [
    { currency: 'CNY', costUsd: 0.01 },
    { currency: 'CNY', pricing: { currency: 'USD', inputUsdPerMillion: 3 } },
    { currency: 'CNY', frozenPricing: { currency: 'CNY', outputUsdPerMillion: 9 } },
  ]) {
    assert.throws(() => b.stage('a', 0.01, 'nested', { currency: 'CNY', costEvidence }), {
      code: 'DUO_CURRENCY_MISMATCH',
    })
    assert.equal(b.snapshot().reservedCostCny, 0.15)
    assert.equal(b.receipts().length, 0)
  }
})
test('native snapshot exposes every staged receipt with hash, operation, status and exact amounts', async (t) => {
  const { ctx, ledger } = await setup(t),
    b = ledger()
  b.reserve('op1', { phase: 'evaluation', tier: 'fast', maxCostUsd: 0.5 })
  const hash = b.stage('op1', 0.2, 'receipt-1')
  const staged = b.snapshot().receipts
  assert.equal(staged.length, 1)
  assert.deepEqual(staged[0], {
    hash,
    receiptId: 'receipt-1',
    operationId: 'op1',
    phase: 'evaluation',
    tier: 'fast',
    status: 'staged',
    applied: false,
    costUsd: 0.2,
    reservedCostUsd: 0.5,
  })
  b.reconcile(hash)
  const applied = ctx.duoBudget.inspect('run1').receipts[0]
  assert.equal(applied.status, 'settled')
  assert.equal(applied.applied, true)
  assert.equal(applied.hash, hash)
  assert.equal(ctx.duoBudget.inspect('run1').costUsd, 0.2)
})
test('service reconcile reports explicit applied, already-settled and unknown-receipt outcomes', async (t) => {
  const { ctx, ledger } = await setup(t),
    b = ledger()
  b.reserve('op1', { phase: 'evaluation', tier: 'fast', maxCostUsd: 0.4 })
  const hash = b.stage('op1', 0.1, 'r1')
  const applied = ctx.duoBudget.reconcile('run1', hash)
  assert.equal(applied.outcome, 'applied')
  assert.equal(applied.operationId, 'op1')
  assert.equal(applied.status, 'settled')
  assert.equal(applied.budget.costUsd, 0.1)
  const again = ctx.duoBudget.reconcile('run1', hash)
  assert.equal(again.outcome, 'already-settled')
  assert.equal(again.budget.costUsd, 0.1)
  assert.equal(again.budget.receipts.length, 1)
  const missing = ctx.duoBudget.reconcile('run1', 'f'.repeat(64))
  assert.equal(missing.outcome, 'unknown-receipt')
  assert.equal(missing.operationId, null)
  assert.equal(missing.budget.costUsd, 0.1)
})
test('service reconcile rejects settled rewrites and reports an applied overrun instead of hiding it', async (t) => {
  const { ctx, ledger } = await setup(t),
    b = ledger()
  b.reserve('op1', { phase: 'evaluation', tier: 'fast', maxCostUsd: 0.4 })
  b.settle('op1', 0.1, 'first')
  const extra = b.stage('op1', 0.2, 'second')
  const rejected = ctx.duoBudget.reconcile('run1', extra)
  assert.equal(rejected.outcome, 'rejected')
  assert.equal(rejected.code, 'DUO_RECEIPT_CONFLICT')
  assert.equal(rejected.budget.costUsd, 0.1)
  b.reserve('op2', { phase: 'generation', maxCostUsd: 0.1 })
  const over = b.stage('op2', 0.2, 'over')
  const overrun = ctx.duoBudget.reconcile('run1', over)
  assert.equal(overrun.outcome, 'applied')
  assert.equal(overrun.overrun, true)
  assert.equal(overrun.budget.blockedReason, 'DUO_RESERVATION_OVERRUN')
  assert.equal(overrun.budget.costUsd, 0.3)
})
test('dead owner runs are annotated as interrupted with explicit resume or new-run guidance', async (t) => {
  const { ctx, ledger } = await setup(t),
    j = ctx.duoJournal.open('run1', { create: true })
  j.claim('digest')
  const b = ledger()
  b.reserve('op1', { phase: 'generation', maxCostUsd: 0.4 })
  assert.equal(ctx.duoBudget.inspect('run1').interrupted ?? null, null)
  const dead = { pid: 2 ** 22 + 12345, start: '0' }
  j.set('run', { ...j.get('run'), owner: dead })
  const stuck = ctx.duoBudget.inspect('run1').interrupted
  assert.equal(stuck.ownerActive, false)
  assert.equal(stuck.resumable, false)
  assert.equal(stuck.checkpointDigest, null)
  assert.equal(stuck.nextStep, 'start_a_new_run')
  assert.equal(typeof stuck.guidance, 'string')
  const b2 = ledger()
  j.set('run', { ...j.get('run'), owner: ownerSelf() })
  b2.settle('op1', 0.1, 'op1-known')
  b2.reserve('measured', { phase: 'evaluation', tier: 'fast', maxCostUsd: 0.2 })
  b2.settle('measured', 0.1, 'known')
  const checkpoint = j.saveCheckpoint(
    { format: 1, nextGeneration: 1, deadlineAt: Date.now() + 10000 },
    { boundary: 'baseline', pause: true },
  )
  assert.equal(ctx.duoBudget.inspect('run1').interrupted ?? null, null)
  j.set('run', { ...j.get('run'), owner: dead })
  const resumable = ctx.duoBudget.inspect('run1').interrupted
  assert.equal(resumable.resumable, true)
  assert.equal(resumable.nextStep, 'resume_from_checkpoint')
  assert.equal(resumable.checkpointDigest, checkpoint)
})
test('cumulative known cost sums settled spend across retained runs and never converts other currencies', async (t) => {
  const { ctx, ledger } = await setup(t)
  assert.deepEqual(ctx.duoBudget.cumulativeKnownCost('USD'), {
    knownCostUnits: 0,
    runs: 0,
    excludedCurrencies: [],
  })
  const b = ledger()
  b.reserve('a', { phase: 'generation', maxCostUsd: 0.4 })
  b.settle('a', 0.1, 'known')
  const other = ctx.duoBudget.open('run2', limits)
  other.reserve('x', { phase: 'evaluation', tier: 'fast', maxCostUsd: 0.3 })
  other.settle('x', 0.05, 'run2-known')
  other.reserve('y', { phase: 'generation', maxCostUsd: 0.2 })
  ctx.duoJournal.open('bare', { create: true }).claim('bare')
  const total = ctx.duoBudget.cumulativeKnownCost('USD')
  assert.equal(total.runs, 2)
  assert.equal(total.knownCostUnits, units(0.15))
  assert.deepEqual(total.excludedCurrencies, [])
  const cny = ctx.duoBudget.open('cny-run', {
    currency: 'CNY',
    maxCostCny: 1,
    maxSessions: 10,
    maxFastEvals: 3,
    maxSlowEvals: 2,
  })
  cny.reserve('c', { phase: 'generation', currency: 'CNY', maxCostCny: 0.5 })
  cny.settle('c', 0.07, 'cny-known')
  const usd = ctx.duoBudget.cumulativeKnownCost('USD')
  assert.equal(usd.knownCostUnits, units(0.15))
  assert.deepEqual(usd.excludedCurrencies, ['CNY'])
  assert.deepEqual(ctx.duoBudget.inspect('run1').cumulative, {
    currency: 'USD',
    knownCostUsd: 0.15,
    maxCumulativeCostUsd: null,
    excludedCurrencies: ['CNY'],
  })
  assert.deepEqual(ctx.duoBudget.inspect('cny-run').cumulative, {
    currency: 'CNY',
    knownCostCny: 0.07,
    maxCumulativeCostCny: null,
    excludedCurrencies: ['USD'],
  })
})
test('native budget inspection exposes read-only cross-run cumulative known cost and the frozen cap', async (t) => {
  const { ctx } = await setup(t),
    capped = { ...limits, maxCumulativeCostUsd: 2 },
    b = ctx.duoBudget.open('run1', capped)
  b.reserve('a', { phase: 'generation', maxCostUsd: 0.4 })
  b.settle('a', 0.1, 'known')
  assert.deepEqual(b.snapshot().cumulative, {
    currency: 'USD',
    knownCostUsd: 0.1,
    maxCumulativeCostUsd: 2,
    excludedCurrencies: [],
  })
  const other = ctx.duoBudget.open('run2', capped)
  other.reserve('x', { phase: 'evaluation', tier: 'fast', maxCostUsd: 0.3 })
  other.settle('x', 0.05, 'r2')
  assert.equal(ctx.duoBudget.inspect('run1').cumulative.knownCostUsd, 0.15)
  const uncapped = ctx.duoBudget.open('free', limits)
  uncapped.reserve('g', { phase: 'generation', maxCostUsd: 0 })
  assert.deepEqual(ctx.duoBudget.inspect('free').cumulative, {
    currency: 'USD',
    knownCostUsd: 0.15,
    maxCumulativeCostUsd: null,
    excludedCurrencies: [],
  })
})
test('an explicit zero cumulative cap admits zero-cost work and blocks any positive known spend', async (t) => {
  const { ctx } = await setup(t),
    paid = ctx.duoBudget.open('paid-run', limits)
  paid.reserve('job', { phase: 'generation', maxCostUsd: 0.4 })
  paid.settle('job', 0.1, 'paid-receipt')
  const free = { ...limits, maxCostUsd: 0, maxCumulativeCostUsd: 0 }
  assert.throws(() => ctx.duoBudget.checkAdmission('free-run', free), {
    code: 'DUO_CUMULATIVE_BUDGET_EXCEEDED',
  })
  // A fresh family with zero known cost admits strictly zero-cost work.
  const { ctx: cleanCtx } = await setup(t, mkdtempSync(join(tmpdir(), 'duo-native-store-')))
  const clean = cleanCtx.duoBudget.open('free-run', free)
  clean.reserve('measure', { phase: 'evaluation', tier: 'fast', maxCostUsd: 0 })
  clean.settle('measure', 0, 'free-receipt')
  assert.doesNotThrow(() => cleanCtx.duoBudget.checkAdmission('free-run-2', free))
})

test('concurrent native run admission preserves one cumulative allowance across processes', async (t) => {
  const { root, ledger } = await setup(t),
    cap = { ...limits, maxCostUsd: 0.7, maxCumulativeCostUsd: 1 }
  ledger() // The shared worker fixture is initialized before testing distinct run admission.
  const workers = await Promise.all(
    Array.from({ length: 3 }, (_, i) =>
      worker(
        t,
        root,
        `
  let admitted=false,code=null;
  try{ctx.duoBudget.admitRun('admission-${i}',${JSON.stringify(cap)},()=>{
    const j=ctx.duoJournal.open('admission-${i}',{create:true});j.claim('plan-${i}');ctx.duoBudget.open('admission-${i}',${JSON.stringify(cap)});
  });admitted=true}catch(e){code=e.code;if(!['DUO_CUMULATIVE_BUDGET_EXCEEDED','DUO_BUDGET_ADMISSION_BUSY'].includes(code))throw e}
  console.log(JSON.stringify({admitted,code}));await new Promise(r=>process.stdin.once('data',r));process.exit(0);
 `,
      ),
    ),
  )
  assert.equal(workers.filter((w) => w.message.admitted).length, 1)
  for (const w of workers) w.child.stdin.end('finish')
  for (const w of workers) assert.equal((await w.closed).code, 0)
  assert.equal(existsSync(join(root, '.duo-admission.lock')), false)
})
test('unknown costs block a different capped run and an existing admission lock is never stolen', async (t) => {
  const { ctx, root, ledger } = await setup(t),
    b = ledger()
  b.reserve('unknown', { phase: 'generation', maxCostUsd: 0.2 })
  b.settle('unknown', null, 'unknown-receipt')
  assert.throws(() => ctx.duoBudget.checkAdmission('new', { ...limits, maxCumulativeCostUsd: 3 }), {
    code: 'DUO_COST_UNKNOWN',
  })
  const { writeFileSync, readFileSync } = await import('node:fs'),
    lock = join(root, '.duo-admission.lock')
  writeFileSync(lock, 'unverified-owner')
  let called = false
  assert.throws(
    () =>
      ctx.duoBudget.admitRun('new', limits, () => {
        called = true
      }),
    { code: 'DUO_BUDGET_ADMISSION_BUSY' },
  )
  assert.equal(called, false)
  assert.throws(() => ctx.duoBudget.checkAdmission('planned', limits), {
    code: 'DUO_BUDGET_ADMISSION_BUSY',
  })
  assert.equal(readFileSync(lock, 'utf8'), 'unverified-owner')
})

test('schema and origin become visible in the same Journal commit', async (t) => {
  const { DatabaseSync } = await import('node:sqlite')
  const { ctx } = await setup(t),
    visible = []
  const original = DatabaseSync.prototype.exec
  DatabaseSync.prototype.exec = function (sql) {
    const result = original.call(this, sql)
    if (
      sql.includes('COMMIT') &&
      this.prepare('PRAGMA application_id').get().application_id === 1146441510
    )
      visible.push(this.prepare("SELECT value FROM meta WHERE key='origin'").get()?.value ?? null)
    return result
  }
  try {
    ctx.duoJournal.open('atomic-origin', { create: true })
  } finally {
    DatabaseSync.prototype.exec = original
  }
  assert.ok(visible.length > 0)
  assert.ok(
    visible.every((value) => typeof value === 'string'),
    'A committed DUO schema must always include its origin',
  )
})
