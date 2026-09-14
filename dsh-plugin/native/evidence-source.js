// Pure source metadata and information-increment declarations. No policy or discovery dependency.
const text = (x) => typeof x === 'string' && !!x.trim()
const strings = (x) => (Array.isArray(x) && x.every(text) ? [...new Set(x)] : [])
const nullableBoolean = (x) => (typeof x === 'boolean' ? x : null)
const finite = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0
export const evidenceSourceFields = Object.freeze([
  'measurement',
  'targetKinds',
  'family',
  'coverage',
  'dataScope',
  'independentOfSearch',
  'realTools',
  'deterministic',
  'requiresModel',
  'approximateCost',
  'latencyMs',
  'sideEffects',
  'increment',
])
// Only explicit, bounded declarations. Price, model names and arbitrary confidence
// never enter classification. Unknown does not mean free, deterministic or safe.
export function evidenceSource(descriptor = {}) {
  const s = descriptor.evidenceSource ?? {},
    scope = s.dataScope
  const result = {
    id: descriptor.id ?? null,
    version: descriptor.version ?? null,
    dataId: descriptor.dataId ?? null,
    measurement: text(s.measurement) ? s.measurement : null,
    targetKinds: strings(s.targetKinds),
    family: text(s.family) ? s.family : (descriptor.evidenceFamily ?? null),
    coverage: strings(s.coverage),
    dataScope:
      scope && text(scope.id) && ['search', 'final', 'control'].includes(scope.purpose)
        ? {
            id: scope.id,
            purpose: scope.purpose,
            description: text(scope.description) ? scope.description : null,
          }
        : null,
    independentOfSearch: nullableBoolean(s.independentOfSearch),
    realTools: nullableBoolean(s.realTools),
    deterministic: nullableBoolean(s.deterministic),
    requiresModel: nullableBoolean(s.requiresModel),
    approximateCost:
      s.approximateCost &&
      ['CNY', 'USD'].includes(s.approximateCost.currency) &&
      finite(s.approximateCost.amount)
        ? { currency: s.approximateCost.currency, amount: s.approximateCost.amount }
        : null,
    latencyMs: finite(s.latencyMs) ? s.latencyMs : null,
    sideEffects: text(s.sideEffects) ? s.sideEffects : null,
    increment: s.increment ? structuredClone(s.increment) : null,
    metricSemantics: structuredClone(descriptor.metricDefinitions ?? {}),
    declarationStatus: 'PROVIDER_DECLARED_NOT_ATTESTED_BY_DUO',
  }
  result.unknownFields = evidenceSourceFields.filter(
    (k) => result[k] === null || (Array.isArray(result[k]) && !result[k].length),
  )
  return result
}
export function inspectIncrement(fast, additional, spec, objective) {
  const a = evidenceSource(fast),
    b = evidenceSource(additional),
    i = b.increment,
    reasons = []
  const added = b.coverage.filter((k) => !a.coverage.includes(k))
  if (!i || !['expanded_evidence', 'high_fidelity'].includes(i.kind))
    reasons.push('NO_INCREMENT_DECLARATION')
  if (!i?.relativeTo || !['id', 'version', 'dataId'].every((k) => i.relativeTo[k] === a[k]))
    reasons.push('INCREMENT_REFERENCE_MISMATCH')
  if (!a.measurement || !b.measurement || !a.family || !b.family)
    reasons.push('MEASUREMENT_UNKNOWN')
  if (!a.targetKinds.includes(spec.target?.kind) || !b.targetKinds.includes(spec.target?.kind))
    reasons.push('TARGET_SCOPE_UNKNOWN_OR_INCOMPATIBLE')
  if (a.dataScope?.purpose !== 'search' || b.dataScope?.purpose !== 'search')
    reasons.push('SEARCH_DATA_BOUNDARY_UNKNOWN')
  if (!added.length) reasons.push('NO_NEW_COVERAGE')
  if (i?.kind === 'expanded_evidence' && a.family !== b.family)
    reasons.push('EXPANDED_EVIDENCE_FAMILY_MISMATCH')
  if (!text(i?.reason)) reasons.push('INCREMENT_REASON_MISSING')
  if (
    i?.kind === 'high_fidelity' &&
    (b.independentOfSearch !== true ||
      i.qualification?.status !== 'passed' ||
      !text(i.qualification?.reference) ||
      !text(i.qualification?.version) ||
      i.qualification?.metric !== objective?.metric)
  )
    reasons.push('HIGH_FIDELITY_NOT_QUALIFIED_FOR_OBJECTIVE')
  // A new family with no qualification can still be measured explicitly, but it
  // is not silently relabeled as a qualified higher-fidelity oracle.
  return {
    available: !reasons.length,
    slow_mode: reasons.length ? 'unavailable' : i.kind,
    addedCoverage: added,
    reasons,
    reason: text(i?.reason) ? i.reason : null,
    source: b,
    qualification: i?.qualification ?? null,
  }
}
