import { Service } from '@deepseek-ai/cordis'
import { fail } from './definitions.js'
import { freeze } from './contract.js'
import { digest } from './store.js'
import { assertMoneyEvidence } from './money.js'
import { decisionId, decisionRequest, decisionAnswers } from './decision-contract.js'

export class DecisionService extends Service {
  constructor(ctx) {
    super(ctx, 'duoDecisions')
  }
}
export default class FunctionDecisions extends DecisionService {
  static inject = ['duoJournal', 'duoBudget']
  constructor(ctx, config) {
    super(ctx)
    const d = config?.descriptor,
      a = config?.authorization
    if (
      typeof config?.judge !== 'function' ||
      !d ||
      !a ||
      !['id', 'version', 'configDigest'].every((k) => typeof d[k] === 'string' && d[k].trim()) ||
      d.currency !== 'CNY' ||
      !Number.isFinite(d.reservationCny) ||
      d.reservationCny < 0 ||
      !['paid', 'network', 'externalSideEffects'].every(
        (k) => typeof d.permissions?.[k] === 'boolean',
      ) ||
      d.permissions.externalSideEffects ||
      (!d.permissions.paid && d.reservationCny !== 0) ||
      !decisionId(a.id) ||
      a.currency !== 'CNY' ||
      !Number.isFinite(a.maxCostCny) ||
      a.maxCostCny < 0 ||
      !Number.isSafeInteger(a.maxCalls) ||
      a.maxCalls < 0 ||
      !['paid', 'network'].every((k) => typeof a[k] === 'boolean')
    )
      fail(
        'DUO_DECISION_CONFIG_INVALID',
        'Configure a versioned CNY judge and an explicit owner-controlled allowance ID, amount, call count and permissions; action side effects are unsupported.',
      )
    assertMoneyEvidence(d, 'CNY')
    assertMoneyEvidence(a, 'CNY')
    this.descriptor = freeze(structuredClone(d))
    this.authorization = freeze(structuredClone(a))
    this.configDigest = digest({ descriptor: d, authorization: a, protocol: 'typed-decisions-v1' })
    this.ledgerId = 'decisions-' + a.id
    this.limits = {
      currency: 'CNY',
      maxCostCny: a.maxCostCny,
      maxSessions: a.maxCalls,
      maxFastEvals: a.maxCalls,
      maxSlowEvals: 0,
    }
    this.judge = config.judge
    this.active = new Map()
    this.closed = false
    ctx.effect(() => async () => {
      this.closed = true
      for (const abort of this.active.values()) abort.abort()
      await Promise.allSettled(this.active.keys())
    })
  }
  describe() {
    return {
      id: 'typed-decisions',
      version: '1',
      questionTypes: ['choice', 'score', 'boolean'],
      maxQuestions: 16,
      qualification: 'NOT_CALIBRATED',
      execution: 'one_batch_no_parallelism_guarantee',
      provider: this.descriptor,
      authorization: this.authorization,
      configDigest: this.configDigest,
      missingPermissions: ['paid', 'network'].filter(
        (k) => this.descriptor.permissions[k] && !this.authorization[k],
      ),
      ledgerId: this.ledgerId,
      budget: this.ctx.duoBudget.inspect(this.ledgerId),
      limits: [
        'Judgments do not grant action authority.',
        'No calibrated probability, semantic accuracy or speed guarantee.',
        'Custom callbacks are trusted code; native model backend bounds one request.',
      ],
    }
  }
  status(requestId) {
    if (requestId !== undefined && !decisionId(requestId))
      fail('DUO_DECISION_INPUT_INVALID', 'Use a bounded opaque request ID')
    const j = this.ctx.duoJournal.open(this.ledgerId)
    return {
      ledgerId: this.ledgerId,
      budget: this.ctx.duoBudget.inspect(this.ledgerId),
      result: requestId ? (j?.get('decision:' + requestId) ?? null) : null,
    }
  }
  async decide({ requestId, state, questions, signal }) {
    if (this.closed)
      fail(
        'DUO_DECISION_UNAVAILABLE',
        'Decision provider is disposed; discover the active provider before calling',
      )
    if (!decisionId(requestId))
      fail('DUO_DECISION_INPUT_INVALID', 'Supply a stable request ID; retries must retain it')
    const input = decisionRequest({ state, questions }),
      inputDigest = digest(input)
    const previous = this.ctx.duoJournal.open(this.ledgerId)
    if (previous?.get('decision-config') && previous.get('decision-config') !== this.configDigest)
      fail(
        'DUO_DECISION_CONFIG_CHANGED',
        'This allowance is bound to a different configuration; changing it needs separately authorized allowance, never a reset',
      )
    const recorded = previous?.get('decision:' + requestId)
    if (recorded) {
      if (recorded.inputDigest !== inputDigest)
        fail(
          'DUO_DECISION_REQUEST_CHANGED',
          'Request ID already belongs to different input; inspect its retained result',
        )
      return { ...recorded, reused: true }
    }
    if (signal?.aborted) fail('ABORTED', 'Cancelled before any decision work was dispatched')
    if (['paid', 'network'].some((k) => this.descriptor.permissions[k] && !this.authorization[k]))
      fail(
        'DUO_DECISION_AUTHORIZATION_REQUIRED',
        'Owner authorization does not cover this provider; tool arguments cannot grant it',
      )
    let j, ledger
    this.ctx.duoBudget.admitRun(this.ledgerId, this.limits, () => {
      j = this.ctx.duoJournal.open(this.ledgerId, { create: true })
      if (j.get('decision-config') && j.get('decision-config') !== this.configDigest)
        fail(
          'DUO_DECISION_CONFIG_CHANGED',
          'Allowance configuration differs; inspect the original allowance',
        )
      ledger = this.ctx.duoBudget.open(this.ledgerId, this.limits)
      j.set('decision-config', this.configDigest)
      ledger.reserve(requestId, {
        phase: 'evaluation',
        tier: 'fast',
        currency: 'CNY',
        maxCostCny: this.descriptor.reservationCny,
        request: { inputDigest, configDigest: this.configDigest, ...input },
      })
    })
    const abort = new AbortController(),
      combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal
    const release = j.lease()
    const work = this.measure({
      requestId,
      input,
      inputDigest,
      signal: combined,
      ledger,
      journal: j,
    })
    this.active.set(work, abort)
    try {
      return await work
    } finally {
      this.active.delete(work)
      release()
    }
  }
  async measure({ requestId, input, inputDigest, signal, ledger, journal }) {
    const started = performance.now()
    let measured,
      failure = null
    try {
      measured = await this.judge({
        ...input,
        signal,
        identity: { requestId, inputDigest, configDigest: this.configDigest },
      })
    } catch {
      failure = 'DUO_COST_UNKNOWN'
    }
    let costCny = null
    try {
      assertMoneyEvidence(measured, 'CNY')
      if (
        measured?.currency === 'CNY' &&
        Number.isFinite(measured.costCny) &&
        measured.costCny >= 0
      )
        costCny = measured.costCny
    } catch {}
    let answers = {},
      status = 'completed'
    if (costCny === null) failure = 'DUO_COST_UNKNOWN'
    else if (costCny > this.descriptor.reservationCny) failure = 'DUO_RESERVATION_OVERRUN'
    else if (signal.aborted) failure = 'ABORTED'
    else if (measured?.error) failure = measured.error.code ?? 'DUO_DECISION_FAILED'
    if (!failure) {
      try {
        answers = decisionAnswers(measured?.answers, input.questions)
      } catch {
        failure = 'DUO_DECISION_OUTPUT_INVALID'
      }
    }
    if (failure)
      status =
        failure === 'DUO_DECISION_OUTPUT_INVALID'
          ? 'invalid_output'
          : failure === 'ABORTED'
            ? 'cancelled'
            : 'failed'
    const result = {
      requestId,
      inputDigest,
      configDigest: this.configDigest,
      provider: this.descriptor,
      status,
      answers,
      allAnswered:
        status === 'completed' && Object.values(answers).every((a) => a.status === 'answered'),
      currency: 'CNY',
      costCny,
      latencyMs: performance.now() - started,
      qualification: 'NOT_CALIBRATED',
      reused: false,
      rawOutput: measured ?? null,
      error: failure
        ? {
            code: failure,
            retryable: false,
            nextAction:
              'Read retained output and receipts. Unknown usage must be reconciled; no automatic retry or action is authorized.',
          }
        : null,
    }
    try {
      ledger.settle(requestId, costCny, requestId + ':decision', {
        currency: 'CNY',
        provider: this.descriptor.id,
        costEvidence: measured?.costEvidence ?? null,
        decision: result,
      })
    } catch (error) {
      // Ledger.settle preserves the full receipt before reporting an overrun.
      // Keep that admission block and make the failed decision readable too.
      if (error.code !== 'DUO_RESERVATION_OVERRUN' || failure !== error.code) throw error
    }
    journal.set('decision:' + requestId, result)
    return result
  }
}
