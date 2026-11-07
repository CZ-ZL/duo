// Optional composition through FunctionEvaluators; no new service or scheduler.
import { fail } from './definitions.js'
import { freeze } from './contract.js'
import { digest, units } from './store.js'
import { assertMoneyEvidence } from './money.js'

export const supportVerdicts = Object.freeze(['supported', 'contradicted', 'insufficient_evidence'])
const text = (s) => typeof s === 'string' && Boolean(s.trim())
const either = (a, b) =>
  a === true || b === true ? true : a === false && b === false ? false : null
const both = (a, b) => (a === false || b === false ? false : a === true && b === true ? true : null)
const fee = (value) => {
  try {
    assertMoneyEvidence(value, 'CNY')
    return value?.currency === 'CNY' && Number.isFinite(value.costCny) && value.costCny >= 0
      ? units(value.costCny)
      : null
  } catch {
    return null
  }
}
const error = (code) => ({
  code,
  component: 'duoEvaluators',
  retryable: false,
  message: 'Shadow judgment accounting or execution cannot safely continue.',
  nextAction:
    'Inspect the primary and shadow receipts; reconcile unknown usage before any authorized retry.',
})
export const validSupportCases = (cases) =>
  Array.isArray(cases) &&
  cases.length > 0 &&
  cases.length <= 16 &&
  cases.every(
    (c) =>
      c &&
      Object.keys(c).sort().join(',') === 'claim,id,source' &&
      ['id', 'source', 'claim'].every((k) => text(c[k])),
  ) &&
  new Set(cases.map((c) => c.id)).size === cases.length &&
  Buffer.byteLength(JSON.stringify(cases)) <= 65536

export function validSupportJudgments(rows, cases) {
  return (
    Array.isArray(rows) &&
    rows.length === cases.length &&
    rows.every(
      (r) =>
        r &&
        Object.keys(r).sort().join(',') === 'id,verdict' &&
        cases.some((c) => c.id === r.id) &&
        supportVerdicts.includes(r.verdict),
    ) &&
    new Set(rows.map((r) => r.id)).size === cases.length
  )
}

/** Build the existing FunctionEvaluators config. Only Fast is wrapped; no
 * final/history access is given to the judge. Callbacks remain trusted code. */
export function createSupportShadow({ primary, judge, project, projectionId }) {
  if (
    typeof primary?.evaluate !== 'function' ||
    typeof judge?.judge !== 'function' ||
    typeof project !== 'function' ||
    !text(projectionId) ||
    !text(primary.implementationDigest) ||
    !text(primary.dataDigest) ||
    primary.descriptors?.length !== 1 ||
    primary.descriptors[0].tier !== 'fast'
  )
    fail(
      'DUO_PROVIDER_INVALID',
      'Support shadow requires one primary Fast evaluator, a versioned projection and a judge',
    )
  const base = structuredClone(primary.descriptors[0]),
    jd = structuredClone(judge.descriptor)
  for (const d of [base, jd]) {
    if (
      !d ||
      !text(d.id) ||
      !text(d.version) ||
      d.currency !== 'CNY' ||
      !Number.isFinite(d.reservationCny) ||
      d.reservationCny < 0 ||
      !['paid', 'network', 'externalSideEffects'].every(
        (k) => typeof d.permissions?.[k] === 'boolean',
      )
    )
      fail(
        'DUO_PROVIDER_INVALID',
        'Both measurements require versioned CNY bounds and explicit permissions',
      )
    assertMoneyEvidence(d, 'CNY')
  }
  if (!text(jd.configDigest))
    fail('DUO_PROVIDER_INVALID', 'Judge configuration identity is required')
  if (!Array.isArray(base.metrics) || !base.metrics.length || !base.metrics.every(text))
    fail('DUO_PROVIDER_INVALID', 'The primary evaluator must declare its metrics')
  const baseCap = units(base.reservationCny, true),
    judgeCap = units(jd.reservationCny, true)
  if (!Number.isSafeInteger(baseCap + judgeCap))
    fail('DUO_PROVIDER_INVALID', 'Combined reservation exceeds supported accounting range')
  const shadow = freeze({
    mode: 'shadow_only',
    affectsSelection: false,
    qualification: 'NOT_QUALIFIED',
    projectionId,
    judge: jd,
    primary: { id: base.id, version: base.version },
  })
  const descriptor = {
    ...base,
    id: base.id + '-support-shadow',
    version: base.version + '+support-shadow.1',
    reservationCny: (baseCap + judgeCap) / 1e9,
    permissions: Object.fromEntries(
      ['paid', 'network', 'externalSideEffects'].map((k) => [
        k,
        base.permissions[k] || jd.permissions[k],
      ]),
    ),
    shadow,
    // Auxiliary judgments do not add selection coverage or qualify a Slow tier.
    ...(base.evidenceSource
      ? {
          evidenceSource: {
            ...base.evidenceSource,
            requiresModel: either(base.evidenceSource.requiresModel, jd.requiresModel),
            deterministic: both(base.evidenceSource.deterministic, jd.deterministic),
            realTools: either(base.evidenceSource.realTools, jd.realTools),
            approximateCost: { currency: 'CNY', amount: (baseCap + judgeCap) / 1e9 },
            latencyMs: null,
            sideEffects:
              'Primary measurement plus opt-in shadow provider; inspect shadow.judge permissions and receipt destination',
          },
        }
      : {}),
  }
  delete descriptor.maxRequests // no invented bound for a caller-owned primary
  const primaryEvaluate = primary.evaluate,
    judgeCall = judge.judge
  const metadata = freeze({
    descriptor,
    dataDigest: primary.dataDigest,
    implementationDigest: primary.implementationDigest,
  })
  return {
    descriptors: [metadata.descriptor],
    dataDigest: metadata.dataDigest,
    implementationDigest: digest({
      primary: metadata.implementationDigest,
      shadow,
      adapter: 'support-shadow-v1',
    }),
    async evaluate(args) {
      const result = await primaryEvaluate(args),
        primaryFee = fee(result)
      if (primaryFee === null)
        return {
          ...result,
          ok: false,
          currency: 'CNY',
          costCny: null,
          error: error('DUO_COST_UNKNOWN'),
        }
      if (primaryFee > baseCap) return { ...result, ok: false, error: error('DUO_BUDGET_OVERRUN') }
      if (result.ok !== true || result.error || args.signal?.aborted) return result
      // Never send invalid primary measurements to another paid provider.
      if (
        !base.metrics.every(
          (k) => typeof result.metrics?.[k] === 'boolean' || Number.isFinite(result.metrics?.[k]),
        )
      )
        return { ...result, ok: false, error: error('DUO_EVIDENCE_INVALID') }
      const sourceArtifactDigest = digest(args.artifact ?? null)
      const record = {
        kind: 'quick_support_shadow',
        purpose: 'diagnostic_only',
        qualification: 'NOT_QUALIFIED',
        affectsSelection: false,
        status: 'invalid_input',
        judgments: [],
        sourceArtifactDigest,
        projectionId,
        judgeId: jd.id,
        judgeVersion: jd.version,
        judgeConfigDigest: jd.configDigest,
        evidenceKind: jd.evidenceKind ?? 'unknown',
        latencyMs: null,
        receiptPath: null,
      }
      let cases
      try {
        cases = structuredClone(
          project(
            freeze(
              structuredClone({
                candidate: args.candidate,
                artifact: args.artifact,
                tier: args.tier,
              }),
            ),
          ),
        )
      } catch {}
      const append = (extra = {}) => ({
        ...result,
        evidence: [...(result.evidence ?? []), record],
        ...extra,
      })
      if (!validSupportCases(cases)) return append()
      record.inputDigest = digest(cases)
      if (args.signal?.aborted) return append({ ok: false, error: error('ABORTED') })
      const started = performance.now()
      let measured
      try {
        measured = await judgeCall({
          cases: freeze(cases),
          signal: args.signal,
          identity: { sourceArtifactDigest, projectionId, dataDigest: metadata.dataDigest },
        })
      } catch {
        measured = { status: 'failed', currency: 'CNY', costCny: null }
      }
      record.latencyMs = performance.now() - started
      record.receiptPath = typeof measured?.receiptPath === 'string' ? measured.receiptPath : null
      record.error = measured?.error ?? null
      const judgeFee = fee(measured)
      record.status =
        measured?.status === 'measured'
          ? validSupportJudgments(measured.judgments, cases)
            ? 'measured'
            : 'invalid_output'
          : measured?.status === 'invalid_output'
            ? 'invalid_output'
            : 'failed'
      if (record.status === 'measured') record.judgments = structuredClone(measured.judgments)
      const known = primaryFee + (judgeFee ?? 0)
      const costEvidence = {
        currency: 'CNY',
        knownCostCny: known / 1e9,
        unknownCost: judgeFee === null,
        shadow: record,
        nestedReceipts: [
          {
            operation: 'primary',
            currency: 'CNY',
            costCny: primaryFee / 1e9,
            costEvidence: result.costEvidence ?? null,
          },
          {
            operation: 'support_shadow',
            currency: 'CNY',
            costCny: judgeFee === null ? null : judgeFee / 1e9,
            costEvidence: measured?.costEvidence ?? null,
          },
        ],
      }
      // Known invalid/failed judgment is diagnostic, not a bad quality score.
      // Unknown costs, overruns and cancellation retain the normal safety stop.
      const stop =
        judgeFee === null
          ? 'DUO_COST_UNKNOWN'
          : judgeFee > judgeCap || !Number.isSafeInteger(known)
            ? 'DUO_BUDGET_OVERRUN'
            : args.signal?.aborted
              ? 'ABORTED'
              : null
      costEvidence.stopReason = stop
      return append({
        currency: 'CNY',
        costCny: judgeFee === null ? null : known / 1e9,
        costEvidence,
        ...(stop ? { ok: false, error: error(stop) } : {}),
      })
    },
  }
}
