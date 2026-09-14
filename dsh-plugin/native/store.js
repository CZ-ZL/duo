import { DatabaseSync } from 'node:sqlite'
import {
  mkdirSync,
  existsSync,
  lstatSync,
  realpathSync,
  readFileSync,
  readdirSync,
  openSync,
  closeSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import Schema from '@deepseek-ai/schemastery'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { moneyFields, assertMoneyEvidence } from './money.js'
import { JournalService, BudgetService, fail } from './definitions.js'

export const canonical = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonical(value[k]))
      .join(',') +
    '}'
  )
}
export const digest = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : canonical(value))
    .digest('hex')
const clone = (value) => JSON.parse(JSON.stringify(value))
export function units(value, limit = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    fail('DUO_BUDGET_INVALID', 'Amounts must be finite nonnegative numbers')
  const [base, exponent = '0'] = String(value).split('e'),
    [whole, fraction = ''] = base.split('.')
  const n = BigInt(whole + fraction),
    power = 9 + Number(exponent) - fraction.length
  const divisor = power < 0 ? 10n ** BigInt(-power) : 1n
  const scaled =
    power >= 0 ? n * 10n ** BigInt(power) : n / divisor + (!limit && n % divisor ? 1n : 0n)
  if (scaled > BigInt(Number.MAX_SAFE_INTEGER))
    fail('DUO_BUDGET_INVALID', 'Amount exceeds exact supported range')
  return Number(scaled)
}
export const money = (n) => n / 1e9
export function owner(pid = process.pid) {
  try {
    const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(')').at(-1).trim().split(/\s+/)
    return fields[0] === 'Z' ? null : { pid, start: fields[19] }
  } catch {
    return null
  }
}
const sameOwner = (a, b) => a && b && a.pid === b.pid && a.start === b.start

class RunJournal {
  constructor(file, { readOnly = false, initialize = false } = {}) {
    this.file = file
    this.readOnly = readOnly
    this.leases = new Set()
    this.closing = false
    this.db = new DatabaseSync(file, { readOnly })
    this.db.exec('PRAGMA busy_timeout=5000;')
    if (!readOnly) this.db.exec('PRAGMA synchronous=FULL;')
    try {
      if (initialize) {
        this.db.exec('BEGIN IMMEDIATE')
        try {
          this.db.exec(`
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS receipts (hash TEXT PRIMARY KEY, identity TEXT UNIQUE NOT NULL, payload TEXT NOT NULL);
            PRAGMA application_id=1146441510; PRAGMA user_version=1;`)
          if (!this.get('origin')) this.set('origin', resolve(file))
          this.db.exec('COMMIT')
        } catch (error) {
          this.db.exec('ROLLBACK')
          throw error
        }
      }
      const version = this.db.prepare('PRAGMA user_version').get().user_version
      const app = this.db.prepare('PRAGMA application_id').get().application_id
      if (version !== 1 || app !== 1146441510)
        fail('DUO_STORAGE_INVALID', 'Existing database is not native DUO schema v1')
      for (const [table, columns] of Object.entries({
        meta: ['key', 'value'],
        events: ['seq', 'payload'],
        operations: ['id', 'payload'],
        receipts: ['hash', 'identity', 'payload'],
      }))
        if (
          canonical(
            this.db
              .prepare('PRAGMA table_info(' + table + ')')
              .all()
              .map((c) => c.name),
          ) !== canonical(columns)
        )
          fail(
            'DUO_STORAGE_INVALID',
            'Existing native database schema is incomplete or incompatible',
          )
      if (this.get('origin') !== resolve(file))
        fail(
          'DUO_STORAGE_INVALID',
          'Database belongs to another native run path; audited migration required',
        )
    } catch (error) {
      this.db.close()
      throw error
    }
  }
  assertOwner() {
    const run = this.get('run')
    if (!run || !sameOwner(run.owner, owner()))
      fail('DUO_RUN_UNCERTAIN', 'Journal mutation requires its current live owner')
    if (this.result()) fail('DUO_RUN_COMPLETE', 'Terminal journal is immutable')
    if (run.status === 'paused')
      fail(
        'DUO_RESUME_REQUIRED',
        'A paused run requires an explicitly checked checkpoint continuation',
      )
  }
  transaction(fn) {
    if (this.readOnly) fail('DUO_STORAGE_READ_ONLY', 'Inspection cannot mutate a journal')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }
  get(key) {
    const row = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)
    return row ? JSON.parse(row.value) : null
  }
  set(key, value) {
    this.db
      .prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, canonical(value))
  }
  claim(planDigest) {
    return this.transaction(() => {
      const old = this.get('run')
      if (old) {
        if (old.planDigest !== planDigest) fail('DUO_PLAN_CHANGED', 'Run belongs to another plan')
        fail(
          'DUO_RUN_UNCERTAIN',
          'Run already claimed; inspect retained state before any execution',
        )
      }
      this.set('run', { planDigest, status: 'running', owner: owner(), started: Date.now() })
    })
  }
  settledAccounting() {
    const configured = this.get('budget')
    if (!configured) fail('DUO_CHECKPOINT_CHANGED', 'Checkpoint has no existing budget')
    const ledger = new Ledger(this, configured.limits, { inspect: true }),
      operations = ledger.operations(),
      receipts = ledger.receipts(),
      blocked = ledger.blocked(operations)
    if (blocked) fail(blocked, 'Unresolved costs or an overrun prevent checkpoint continuation')
    if (operations.some((op) => op.status !== 'settled'))
      fail('DUO_COST_UNKNOWN', 'Every checkpoint operation must be settled')
    for (const op of operations) {
      const receipt = receipts.find((r) => r.hash === op.receipts.at(-1))
      if (!receipt) fail('DUO_CHECKPOINT_CHANGED', 'A settled checkpoint operation has no receipt')
      const { hash, ...body } = receipt
      if (
        digest(body) !== hash ||
        body.cost !== op.cost ||
        body.ledgerId !== configured.id ||
        body.operationId !== op.id ||
        body.requestHash !==
          digest({
            id: op.id,
            phase: op.phase,
            tier: op.tier,
            reserved: op.reserved,
            request: op.request,
          })
      )
        fail(
          'DUO_CHECKPOINT_CHANGED',
          'Checkpoint receipt identity differs from its settled operation',
        )
    }
    return { configured, operations, receipts }
  }
  saveCheckpoint(state, { boundary, pause = false }) {
    return this.transaction(() => {
      this.assertOwner()
      const run = this.get('run')
      if (!['baseline', 'generation'].includes(boundary) || state?.format !== 1)
        fail('DUO_CHECKPOINT_CHANGED', 'Only versioned settled search boundaries are supported')
      const body = {
        format: 1,
        planDigest: run.planDigest,
        boundary,
        state: clone(state),
        accountingDigest: digest(this.settledAccounting()),
        priorEventsDigest: digest(this.events()),
      }
      const checkpoint = { ...body, digest: digest(body) }
      this.set('checkpoint', checkpoint)
      this.db.prepare('INSERT INTO events(payload) VALUES (?)').run(
        canonical({
          kind: 'checkpoint',
          digest: checkpoint.digest,
          boundary,
          nextGeneration: state.nextGeneration,
          paused: pause,
        }),
      )
      if (pause) this.set('run', { ...run, status: 'paused' })
      return checkpoint.digest
    })
  }
  checkedCheckpoint() {
    const checkpoint = this.get('checkpoint'),
      run = this.get('run')
    if (!checkpoint || checkpoint.format !== 1 || checkpoint.state?.format !== 1)
      fail('DUO_RESUME_UNSUPPORTED', 'No supported settled-boundary checkpoint exists')
    if (this.result()) fail('DUO_RUN_COMPLETE', 'Terminal results cannot resume')
    const { digest: hash, ...body } = checkpoint,
      events = this.events(),
      tail = events.pop()
    if (
      digest(body) !== hash ||
      run?.planDigest !== checkpoint.planDigest ||
      tail?.kind !== 'checkpoint' ||
      tail.digest !== hash ||
      digest(events) !== checkpoint.priorEventsDigest
    )
      fail(
        'DUO_CHECKPOINT_CHANGED',
        'Work or evidence changed after the retained checkpoint; no replay is supported',
      )
    if (digest(this.settledAccounting()) !== checkpoint.accountingDigest)
      fail('DUO_CHECKPOINT_CHANGED', 'Checkpoint budget or receipts changed')
    if (
      !Number.isSafeInteger(checkpoint.state.deadlineAt) ||
      Date.now() >= checkpoint.state.deadlineAt
    )
      fail(
        'DUO_DEADLINE_EXHAUSTED',
        'Original run deadline has expired; continuation does not renew it',
      )
    if (run.status !== 'paused' && sameOwner(run.owner, owner(run.owner?.pid)))
      fail('DUO_OWNER_ACTIVE', 'An active run owner has not released this boundary')
    return checkpoint
  }
  checkpointInfo() {
    const c = this.get('checkpoint')
    if (!c) return null
    let reason = null
    try {
      this.checkedCheckpoint()
    } catch (error) {
      reason = error.code ?? 'DUO_CHECKPOINT_CHANGED'
    }
    return {
      format: c.format,
      digest: c.digest,
      boundary: c.boundary,
      nextGeneration: c.state?.nextGeneration,
      deadlineAt: c.state?.deadlineAt,
      resumable: reason === null,
      reason,
      requiresCurrentPlan: true,
    }
  }
  resume(planDigest, checkpointDigest) {
    return this.transaction(() => {
      const run = this.get('run')
      if (run?.planDigest !== planDigest)
        fail('DUO_PLAN_CHANGED', 'Continuation belongs to another plan')
      if (this.get('checkpoint')?.digest !== checkpointDigest)
        fail('DUO_CHECKPOINT_CHANGED', 'Inspect the current checkpoint digest before continuing')
      const checkpoint = this.checkedCheckpoint()
      this.set('run', {
        ...run,
        status: 'running',
        owner: owner(),
        resumes: (run.resumes ?? 0) + 1,
      })
      this.db.prepare('INSERT INTO events(payload) VALUES (?)').run(
        canonical({
          kind: 'resumed',
          checkpointDigest,
          boundary: checkpoint.boundary,
          previousOwner: run.owner,
          owner: owner(),
          at: Date.now(),
        }),
      )
      return clone(checkpoint.state)
    })
  }
  append(event) {
    return this.transaction(() => {
      this.assertOwner()
      this.db.prepare('INSERT INTO events(payload) VALUES (?)').run(canonical(event))
    })
  }
  events(limits) {
    if (limits === undefined)
      return this.db
        .prepare('SELECT payload FROM events ORDER BY seq')
        .all()
        .map((r) => JSON.parse(r.payload))
    if (
      !limits ||
      !['maxEvents', 'maxBytes'].every((k) => Number.isSafeInteger(limits[k]) && limits[k] > 0)
    )
      fail('DUO_HISTORY_LIMIT', 'Bounded history reads require positive event and byte caps')
    // Check size before materializing JSON, in the same read snapshot. A savepoint
    // also works on read-only connections and does not change journal contents.
    this.db.exec('SAVEPOINT duo_bounded_history')
    try {
      const size = this.db
        .prepare(
          'SELECT COUNT(*) AS n, COALESCE(SUM(length(CAST(payload AS BLOB))),0) AS bytes FROM events',
        )
        .get()
      if (size.n > limits.maxEvents || size.bytes > limits.maxBytes)
        fail('DUO_HISTORY_LIMIT', 'Source journal exceeds the bounded history read allowance')
      return this.db
        .prepare('SELECT payload FROM events ORDER BY seq')
        .all()
        .map((r) => JSON.parse(r.payload))
    } finally {
      this.db.exec('RELEASE duo_bounded_history')
    }
  }
  result() {
    return this.get('result')
  }
  complete(result) {
    this.transaction(() => {
      this.assertOwner()
      this.set('result', result)
      this.set('run', { ...this.get('run'), status: result.status })
    })
  }
  lease() {
    if (this.closing) fail('DUO_STORAGE_CLOSING', 'Native journal is draining')
    let release
    const done = new Promise((r) => (release = r))
    this.leases.add(done)
    return () => {
      this.leases.delete(done)
      release()
    }
  }
  async close() {
    this.closing = true
    await Promise.allSettled([...this.leases])
    this.db.close()
  }
}
export class SqliteJournal extends JournalService {
  describe() {
    return {
      id: 'sqlite_journal_v1',
      version: '2',
      deterministic: true,
      checkpoint: 'settled_search_boundary_v1',
    }
  }
  static Config = Schema.object({ root: Schema.string().required() })
  constructor(ctx, config) {
    super(ctx)
    this.root = resolve(config.root)
    this.handles = new Map()
    ctx.effect(() => async () => {
      await Promise.allSettled([...this.handles.values()].map((j) => j.close()))
      this.handles.clear()
    })
  }
  open(runId, { create = false } = {}) {
    if (typeof runId !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(runId))
      fail('DUO_RUN_ID_INVALID', 'Use a bounded opaque run identifier')
    const directory = join(this.root, runId),
      file = join(directory, 'duo.sqlite')
    if (!existsSync(file) && !create) return null
    if (
      existsSync(directory) &&
      (lstatSync(directory).isSymbolicLink() || realpathSync(directory) !== resolve(directory))
    )
      fail('DUO_STORAGE_INVALID', 'Run directory aliases are not supported')
    if (existsSync(file) && (lstatSync(file).isSymbolicLink() || lstatSync(file).nlink !== 1))
      fail('DUO_STORAGE_INVALID', 'Database aliases are not supported')
    const key = runId + ':' + (create ? 'writer' : 'reader')
    if (!this.handles.has(key)) {
      const initialize = !existsSync(file)
      if (create) mkdirSync(directory, { recursive: true })
      this.handles.set(
        key,
        new RunJournal(file, { readOnly: !create, initialize: initialize && create }),
      )
    }
    return this.handles.get(key)
  }
}
class Ledger {
  constructor(journal, limits, { inspect = false, tiers = null, cumulative = null } = {}) {
    this.j = journal
    this.m = moneyFields(limits)
    this.cumulative = cumulative
    const resolved = { ...limits, maxCostUnits: units(limits[this.m.cap], true) }
    for (const key of ['maxSessions', 'maxFastEvals', 'maxSlowEvals'])
      if (!Number.isSafeInteger(limits[key]) || limits[key] < 0)
        fail('DUO_BUDGET_INVALID', 'Finite integer operation and evaluation limits are required')
    const init = () => {
      const old = this.j.get('budget')
      if (old && canonical(old.limits) !== canonical(resolved))
        fail('DUO_BUDGET_CHANGED', 'Native ledger limits are immutable')
      if (old?.tiers && tiers && canonical(old.tiers) !== canonical(tiers))
        fail('DUO_BUDGET_CHANGED', 'Native ledger tier ladder is immutable')
      this.tiers = old?.tiers ?? (old ? null : tiers)
      if (!old) {
        if (inspect) fail('DUO_STORAGE_INVALID', 'Budget has not been initialized')
        this.j.set('budget', { id: randomUUID(), limits: resolved, ...(tiers ? { tiers } : null) })
      }
    }
    if (inspect) init()
    else this.j.transaction(init)
  }
  // Pool classification: the first search stage spends the cheap (fast)
  // allowance; every deeper stage and final spend the shared expensive (slow)
  // allowance. Ledgers without a stored ladder keep the legacy fixed names.
  poolOf(tier) {
    if (tier === null) return null
    if (this.tiers)
      return tier === this.tiers[0]
        ? 'fast'
        : this.tiers.slice(1).includes(tier) || tier === 'final'
          ? 'slow'
          : undefined
    return tier === 'fast'
      ? 'fast'
      : ['review', 'slow', 'final'].includes(tier)
        ? 'slow'
        : undefined
  }
  operations() {
    return this.j.db
      .prepare('SELECT id,payload FROM operations ORDER BY rowid')
      .all()
      .map((r) => {
        let op
        try {
          op = JSON.parse(r.payload)
        } catch {
          fail('DUO_STORAGE_INVALID', 'Malformed operation record')
        }
        const integer = (n) => Number.isSafeInteger(n) && n >= 0
        if (
          !op ||
          op.id !== r.id ||
          !['generation', 'selection', 'evaluation'].includes(op.phase) ||
          this.poolOf(op.tier) === undefined ||
          !integer(op.reserved) ||
          !['reserved', 'unknown', 'settled'].includes(op.status) ||
          !(op.status === 'settled' ? integer(op.cost) : op.cost === null) ||
          !op.owner ||
          !integer(op.owner.pid) ||
          !op.owner.pid ||
          typeof op.owner.start !== 'string' ||
          !Array.isArray(op.receipts) ||
          op.receipts.some((h) => typeof h !== 'string') ||
          typeof op.overrun !== 'boolean'
        )
          fail('DUO_STORAGE_INVALID', 'Invalid native operation accounting state')
        return op
      })
  }
  save(op) {
    this.j.db
      .prepare(
        'INSERT INTO operations VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
      )
      .run(op.id, canonical(op))
  }
  blocked(ops) {
    for (const op of ops) {
      if (op.overrun) return 'DUO_RESERVATION_OVERRUN'
      if (
        op.status === 'unknown' ||
        (op.status === 'reserved' && !sameOwner(op.owner, owner(op.owner.pid)))
      )
        return 'DUO_COST_UNKNOWN'
    }
    return null
  }
  snapshot() {
    const ops = this.operations(),
      limits = this.j.get('budget').limits,
      m = this.m
    const totals = (list) => {
      const known = list.reduce((n, o) => n + (o.status === 'settled' ? o.cost : 0), 0),
        reserved = list.reduce((n, o) => n + (o.status !== 'settled' ? o.reserved : 0), 0)
      return {
        [m.cost]: list.some((o) => o.status !== 'settled') ? null : money(known),
        [m.known]: money(known),
        [m.reserved]: money(reserved),
        operations: list.length,
      }
    }
    return {
      ...totals(ops),
      currency: m.currency,
      blockedReason: this.blocked(ops),
      limits,
      fastAttempts: ops.filter((o) => this.poolOf(o.tier) === 'fast').length,
      slowAttempts: ops.filter((o) => this.poolOf(o.tier) === 'slow').length,
      phases: Object.fromEntries(
        ['generation', 'selection', 'evaluation'].map((p) => [
          p,
          totals(ops.filter((o) => o.phase === p)),
        ]),
      ),
      ...(this.cumulative ? { cumulative: this.cumulative() } : null),
      receipts: this.receipts().map((r) => {
        const op = ops.find((o) => o.id === r.operationId)
        return {
          hash: r.hash,
          receiptId: r.receiptId,
          operationId: r.operationId,
          phase: op?.phase ?? null,
          tier: op?.tier ?? null,
          status: op ? (op.receipts.includes(r.hash) ? op.status : 'staged') : 'orphan',
          applied: !!op && op.receipts.includes(r.hash),
          [m.cost]: r.cost === null ? null : money(r.cost),
          [m.reserved]: op ? money(op.reserved) : null,
        }
      }),
    }
  }
  reserve(id, options) {
    const { phase, tier = null, request = {} } = options,
      m = moneyFields(options)
    if (m.currency !== this.m.currency)
      fail('DUO_CURRENCY_MISMATCH', 'Reservation currency differs from the immutable ledger')
    const reserved = units(options[m.cap]),
      identity = owner(),
      pool = this.poolOf(tier)
    if (
      typeof id !== 'string' ||
      !id ||
      !['generation', 'selection', 'evaluation'].includes(phase) ||
      pool === undefined ||
      !identity
    )
      fail('DUO_BUDGET_INVALID', 'Valid operation identity, phase, tier and Linux owner required')
    return this.j.transaction(() => {
      const ops = this.operations(),
        limits = this.j.get('budget').limits
      if (this.j.result()) fail('DUO_RUN_COMPLETE', 'Terminal runs cannot admit new operations')
      if (this.j.get('run')) this.j.assertOwner()
      if (ops.some((o) => o.id === id))
        fail('DUO_OPERATION_EXISTS', 'Operation already reserved; never repeat it blindly')
      const blocked = this.blocked(ops)
      if (blocked) fail(blocked, 'Unresolved operation or overrun blocks new admission')
      const exposure = ops.reduce((n, o) => n + (o.status === 'settled' ? o.cost : o.reserved), 0)
      if (
        ops.length >= limits.maxSessions ||
        exposure + reserved > limits.maxCostUnits ||
        (pool === 'fast' &&
          ops.filter((o) => this.poolOf(o.tier) === 'fast').length >= limits.maxFastEvals) ||
        (pool === 'slow' &&
          ops.filter((o) => this.poolOf(o.tier) === 'slow').length >= limits.maxSlowEvals)
      )
        fail('DUO_BUDGET_EXHAUSTED', 'Operation exceeds the remaining authorized allowance')
      this.save({
        id,
        phase,
        tier,
        reserved,
        request: clone(request),
        owner: identity,
        status: 'reserved',
        cost: null,
        receipts: [],
        overrun: false,
      })
      return id
    })
  }
  stage(id, amount, receiptId, evidence = {}) {
    assertMoneyEvidence(evidence, this.m.currency)
    const cost = amount === null ? null : units(amount)
    if (typeof receiptId !== 'string' || !receiptId)
      fail('DUO_RECEIPT_INVALID', 'Receipt identity required')
    return this.j.transaction(() => {
      const op = this.operations().find((o) => o.id === id)
      if (!op) fail('DUO_RECEIPT_INVALID', 'Reservation not found')
      const receipt = {
        ...(this.m.currency === 'CNY' ? { currency: 'CNY' } : {}),
        ledgerId: this.j.get('budget').id,
        operationId: id,
        requestHash: digest({
          id: op.id,
          phase: op.phase,
          tier: op.tier,
          reserved: op.reserved,
          request: op.request,
        }),
        cost,
        receiptId,
        evidence: clone(evidence),
      }
      const hash = digest(receipt),
        existing = this.j.db.prepare('SELECT hash FROM receipts WHERE identity=?').get(receiptId)
      if (existing && existing.hash !== hash)
        fail('DUO_RECEIPT_CONFLICT', 'Receipt identity already belongs to different contents')
      this.j.db
        .prepare('INSERT OR IGNORE INTO receipts VALUES (?,?,?)')
        .run(hash, receiptId, canonical(receipt))
      return hash
    })
  }
  reconcile(hash) {
    return this.j.transaction(() => {
      const row = this.j.db.prepare('SELECT payload FROM receipts WHERE hash=?').get(hash)
      if (!row)
        return {
          outcome: 'unknown-receipt',
          receiptHash: hash,
          operationId: null,
          status: null,
          overrun: false,
          reason: 'No staged receipt with this hash exists in this run',
        }
      const receipt = JSON.parse(row.payload),
        op = this.operations().find((o) => o.id === receipt.operationId)
      if (
        (receipt.currency ?? 'USD') !== this.m.currency ||
        digest(receipt) !== hash ||
        receipt.ledgerId !== this.j.get('budget').id ||
        !op ||
        receipt.requestHash !==
          digest({
            id: op.id,
            phase: op.phase,
            tier: op.tier,
            reserved: op.reserved,
            request: op.request,
          })
      )
        fail('DUO_RECEIPT_INVALID', 'Receipt binding mismatch')
      if (op.receipts.includes(hash))
        return {
          outcome: 'already-settled',
          receiptHash: hash,
          operationId: op.id,
          status: op.status,
          overrun: op.overrun,
          reason: 'Receipt was already applied to its operation',
        }
      if (op.status === 'settled')
        fail('DUO_RECEIPT_CONFLICT', 'Settled operation cannot be rewritten')
      if (
        op.status === 'reserved' &&
        !sameOwner(op.owner, owner()) &&
        sameOwner(op.owner, owner(op.owner.pid))
      )
        fail('DUO_OWNER_ACTIVE', 'Cannot reconcile another live owner')
      op.status = receipt.cost === null ? 'unknown' : 'settled'
      op.cost = receipt.cost
      op.overrun = receipt.cost !== null && receipt.cost > op.reserved
      op.receipts.push(hash)
      this.save(op)
      return {
        outcome: 'applied',
        receiptHash: hash,
        operationId: op.id,
        status: op.status,
        overrun: op.overrun,
        reason: op.overrun ? 'Full observed overrun retained; further admission stopped' : null,
      }
    })
  }
  settle(id, cost, receiptId, evidence = {}) {
    const hash = this.stage(id, cost, receiptId, evidence)
    if (this.reconcile(hash).overrun)
      fail('DUO_RESERVATION_OVERRUN', 'Full observed overrun retained; further admission stopped')
    return hash
  }
  receipts() {
    return this.j.db
      .prepare('SELECT hash,payload FROM receipts ORDER BY rowid')
      .all()
      .map((r) => ({ hash: r.hash, ...JSON.parse(r.payload) }))
  }
}
export function runInterruption(j, checkpoint = j.checkpointInfo()) {
  const run = j.get('run')
  if (!run || j.result() || sameOwner(run.owner, owner(run.owner?.pid))) return null
  const resumable = checkpoint?.resumable === true
  return {
    ownerActive: false,
    resumable,
    checkpointDigest: checkpoint?.digest ?? null,
    nextStep: resumable ? 'resume_from_checkpoint' : 'start_a_new_run',
    guidance: resumable
      ? 'The owning process is gone; continue this exact run with dualloop_run resumeFrom set to checkpointDigest, within the original deadline.'
      : 'The owning process is gone and no settled checkpoint can continue this run; reconcile any staged receipts listed in dualloop_budget_status, then start a new run. Retained evidence stays immutable.',
  }
}
export class ReservedBudget extends BudgetService {
  describe() {
    return {
      id: 'reserved_budget_v1',
      version: '2',
      deterministic: true,
      cumulativeAdmission: 'retained_allowance_v1',
    }
  }
  static inject = ['duoJournal']
  // Read a consistent snapshot of each existing ledger. The admission lock
  // serializes new claims; active runs retain their entire frozen allowance.
  retainedBudgets(currency, { admission = false } = {}) {
    const root = this.ctx.duoJournal.root,
      rows = [],
      excludedCurrencies = new Set()
    if (!existsSync(root)) return { rows, excludedCurrencies: [] }
    for (const runId of readdirSync(root)) {
      if (!/^[a-zA-Z0-9_-]{1,96}$/.test(runId) || !existsSync(join(root, runId, 'duo.sqlite')))
        continue
      const j = this.ctx.duoJournal.open(runId)
      j.db.exec('SAVEPOINT duo_cumulative_read')
      try {
        const configured = j.get('budget'),
          run = j.get('run')
        if (!configured) {
          if ((admission && run) || j.db.prepare('SELECT COUNT(*) AS n FROM operations').get().n)
            fail(
              'DUO_STORAGE_INVALID',
              'A claimed run or operation has no initialized budget; inspect retained state',
            )
          continue
        }
        const rowCurrency = moneyFields(configured.limits).currency
        if (rowCurrency !== currency) {
          excludedCurrencies.add(rowCurrency)
          continue
        }
        const ledger = new Ledger(j, configured.limits, { inspect: true })
        const operations = ledger.operations()
        rows.push({
          runId,
          limits: configured.limits,
          operations,
          active: !!run && !j.result(),
          blocked: ledger.blocked(operations),
        })
      } finally {
        j.db.exec('RELEASE duo_cumulative_read')
      }
    }
    return { rows, excludedCurrencies: [...excludedCurrencies].sort() }
  }
  cumulativeKnownCost(currency) {
    const { rows, excludedCurrencies } = this.retainedBudgets(currency)
    const knownCostUnits = rows.reduce(
      (sum, r) => sum + r.operations.reduce((n, o) => n + (o.status === 'settled' ? o.cost : 0), 0),
      0,
    )
    if (!Number.isSafeInteger(knownCostUnits))
      fail('DUO_BUDGET_INVALID', 'Cumulative amount exceeds the exact supported range')
    return { knownCostUnits, runs: rows.length, excludedCurrencies }
  }
  admissionBusy() {
    fail(
      'DUO_BUDGET_ADMISSION_BUSY',
      'Journal admission is locked; inspect .duo-admission.lock and its owner before retrying. Never remove a live or unverified lock',
    )
  }
  checkAdmission(runId, limits) {
    // Plans are read-only and advisory. Actual run admission rechecks under
    // the exclusive lock; an in-progress claim is not storage corruption.
    const lock = join(this.ctx.duoJournal.root, '.duo-admission.lock')
    if (existsSync(lock)) this.admissionBusy()
    try {
      return this.checkRetainedAllowance(runId, limits)
    } catch (error) {
      if (existsSync(lock)) this.admissionBusy()
      throw error
    }
  }
  checkRetainedAllowance(runId, limits) {
    const m = moneyFields(limits),
      capKey = 'maxCumulativeCost' + m.cap.slice('maxCost'.length)
    const { rows } = this.retainedBudgets(m.currency, { admission: true })
    // An uncapped new contract cannot consume an allowance promised to an
    // unfinished capped run. Terminal runs contribute actual settled cost only.
    const caps = [
      limits[capKey],
      ...rows.filter((r) => r.active).map((r) => r.limits[capKey]),
    ].filter((x) => x !== undefined)
    if (!caps.length) return
    const cap = Math.min(...caps),
      ownAllowance = units(limits[m.cap], true)
    let exposure = ownAllowance,
      known = 0,
      retainedAllowance = 0
    for (const row of rows) {
      if (row.blocked)
        fail(row.blocked, 'Unresolved costs in the shared Journal prevent cumulative admission')
      const cost = row.operations.reduce((sum, o) => sum + (o.status === 'settled' ? o.cost : 0), 0)
      known += cost
      if (row.runId === runId) continue
      const reserved = row.operations.reduce(
        (sum, o) => sum + (o.status !== 'settled' ? o.reserved : 0),
        0,
      )
      const liability = row.active
        ? Math.max(row.limits.maxCostUnits, cost + reserved)
        : cost + reserved
      exposure += liability
      retainedAllowance += liability - cost
    }
    if (!Number.isSafeInteger(exposure) || !Number.isSafeInteger(known))
      fail('DUO_BUDGET_INVALID', 'Cumulative exposure exceeds the exact supported range')
    if (exposure > units(cap, true))
      throw Object.assign(
        new HarnessError(
          'Settled cost plus retained unfinished allowances and this run exceed the cumulative cap',
          'DUO_CUMULATIVE_BUDGET_EXCEEDED',
        ),
        {
          component: 'duoBudget',
          retryable: false,
          nextAction:
            'Inspect retained runs and complete their supported checkpoints, or reduce the new allowance; any higher cap requires explicit authorization',
          cumulative: {
            currency: m.currency,
            [m.known]: money(known),
            [m.cap]: limits[m.cap],
            [capKey]: cap,
            ...(retainedAllowance ? { retainedAllowance: money(retainedAllowance) } : {}),
          },
        },
      )
  }
  admitRun(runId, limits, admit) {
    const root = this.ctx.duoJournal.root,
      lock = join(root, '.duo-admission.lock')
    mkdirSync(root, { recursive: true })
    let fd
    try {
      fd = openSync(lock, 'wx', 0o600)
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      this.admissionBusy()
    }
    try {
      writeFileSync(fd, JSON.stringify({ owner: owner(), runId }) + '\n')
      this.checkRetainedAllowance(runId, limits)
      return admit()
    } finally {
      closeSync(fd)
      unlinkSync(lock)
    }
  }
  cumulativeSnapshot(limits) {
    const m = moneyFields(limits),
      cap = 'maxCumulativeCost' + m.cap.slice('maxCost'.length),
      { knownCostUnits, excludedCurrencies } = this.cumulativeKnownCost(m.currency)
    return {
      currency: m.currency,
      [m.known]: money(knownCostUnits),
      [cap]: limits[cap] ?? null,
      excludedCurrencies,
    }
  }
  open(runId, limits, tiers) {
    return new Ledger(this.ctx.duoJournal.open(runId, { create: true }), limits, {
      tiers: tiers ?? null,
      cumulative: () => this.cumulativeSnapshot(limits),
    })
  }
  inspect(runId) {
    const j = this.ctx.duoJournal.open(runId)
    if (!j?.get('budget')) return null
    const limits = j.get('budget').limits,
      snapshot = new Ledger(j, limits, {
        inspect: true,
        cumulative: () => this.cumulativeSnapshot(limits),
      }).snapshot(),
      interrupted = runInterruption(j)
    return interrupted ? { ...snapshot, interrupted } : snapshot
  }
  reconcile(runId, hash) {
    const reader = this.ctx.duoJournal.open(runId)
    if (!reader?.get('budget')) fail('DUO_RECEIPT_INVALID', 'Native ledger not found')
    const j = this.ctx.duoJournal.open(runId, { create: true }),
      limits = j.get('budget').limits,
      b = new Ledger(j, limits, { cumulative: () => this.cumulativeSnapshot(limits) })
    let outcome
    try {
      outcome = b.reconcile(hash)
    } catch (error) {
      if (!error?.code?.startsWith('DUO_')) throw error
      outcome = { outcome: 'rejected', receiptHash: hash, code: error.code, reason: error.message }
    }
    return { ...outcome, budget: b.snapshot() }
  }
}
