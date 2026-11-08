import { fail } from './definitions.js'
import { moneyFields, assertMoneyEvidence } from './money.js'
const clone = (value) => structuredClone(value)

// Reserve before dispatch; retain unknown exposure and leases until calls settle.
export function createOperations({
  plan,
  signal,
  j,
  budget,
  check,
  stages,
  stageAttempts,
  pendingCalls,
  nextOperationId,
}) {
  const { spec } = plan
  const invoke = async (phase, tier, descriptor, fn, request) => {
    check()
    const stage = stages.find((s) => s.tier === tier)
    if (spec.searchStages && stage && stageAttempts[tier] >= stage.maxEvaluations)
      fail('DUO_STAGE_BUDGET_EXHAUSTED', 'The frozen ' + tier + ' evaluation limit is exhausted')
    const id = nextOperationId()
    const m = moneyFields(spec.budget)
    budget.reserve(id, {
      phase,
      tier,
      currency: m.currency,
      [m.cap]: descriptor[m.reservation],
      request: { provider: descriptor.id, version: descriptor.version, ...request },
    })
    if (stage) stageAttempts[tier]++
    let settled = false
    const releaseCall = j.lease()
    const work = Promise.resolve()
      .then(fn)
      .then(
        (value) => {
          let currencyMatches = false
          try {
            assertMoneyEvidence(value, m.currency)
            currencyMatches = moneyFields(value).currency === m.currency
          } catch {}
          const amount = value?.[m.cost],
            cost =
              currencyMatches &&
              typeof amount === 'number' &&
              Number.isFinite(amount) &&
              amount >= 0
                ? amount
                : null
          budget.settle(id, cost, id + ':completed', {
            currency: m.currency,
            provider: descriptor.id,
            costEvidence: currencyMatches ? (value?.costEvidence ?? null) : null,
            ...(currencyMatches ? {} : { refusedCurrencyEvidence: value ?? null }),
          })
          settled = true
          if (!currencyMatches)
            fail(
              'DUO_CURRENCY_MISMATCH',
              'Provider returned a different currency; reservation remains unknown',
            )
          if (cost === null)
            fail('DUO_COST_UNKNOWN', 'Provider did not return complete cost evidence')
          if (value?.error)
            throw Object.assign(
              new Error(value.error.message ?? 'Provider refused after settling its usage'),
              value.error,
            )
          return value
        },
        (error) => {
          budget.settle(id, null, id + ':failed', { provider: descriptor.id })
          settled = true
          throw error
        },
      )
    const tracked = work
      .then(
        () => {},
        () => {},
      )
      .finally(() => {
        releaseCall()
        pendingCalls.delete(tracked)
      })
    pendingCalls.add(tracked)
    let onAbort
    const cancelled = new Promise((_, reject) => {
      onAbort = () => {
        try {
          fail('ABORTED', 'Native provider call interrupted')
        } catch (e) {
          reject(e)
        }
      }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      return await Promise.race([work, cancelled])
    } catch (error) {
      if (!settled && signal.aborted)
        budget.settle(id, null, id + ':interrupted', { provider: descriptor.id })
      throw error
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  return invoke
}
