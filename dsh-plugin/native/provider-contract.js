import { fail, assertProviderMethods } from './definitions.js'
import { freeze } from './contract.js'
import { targetKindSchema } from './capabilities.js'
import { moneyFields } from './money.js'
import { matchEvaluator } from './evaluator-discovery.js'
import { evaluationTiersOf } from './stages.js'
const methods = freeze({
  duoGenerator: ['describe', 'propose'],
  duoExecutor: ['describe', 'execute'],
  duoEvaluators: ['describe', 'evaluate'],
  duoComparator: ['describe', 'compare'],
  duoGate: ['describe', 'select'],
  duoFeedback: ['describe', 'summarize'],
  duoTarget: ['describe', 'snapshot', 'apply'],
  duoJournal: ['describe', 'open'],
  duoBudget: ['describe', 'open', 'inspect', 'reconcile'],
})
export const providerContractDependencies = (spec) =>
  Object.keys(methods).filter((key) => key !== 'duoGenerator' || spec?.mode !== 'evaluation_only')

// Legacy providers without a declaration remain usable, never certified as
// target-independent. This is a type declaration check, not task qualification.
export function workTargetCompatibility(spec, bindings) {
  const targetKind = spec?.target?.kind,
    components = Object.fromEntries(
      ['generator', 'executor'].map((key) => {
        const d = bindings[key],
          kinds = d?.targetKinds
        let status
        if (
          key === 'generator' &&
          (spec?.mode === 'evaluation_only' || spec?.operation === 'evaluate')
        )
          status = 'NOT_REQUIRED'
        else if (!d) status = 'MISSING'
        else if (kinds === undefined) status = 'UNKNOWN'
        else if (
          !Array.isArray(kinds) ||
          !kinds.length ||
          kinds.some(
            (kind) => typeof kind !== 'string' || !new RegExp(targetKindSchema.pattern).test(kind),
          )
        )
          status = 'INVALID_DECLARATION'
        else if (!targetKind) status = 'INPUTS_REQUIRED'
        else status = kinds.includes(targetKind) ? 'DECLARED_MATCH' : 'INCOMPATIBLE'
        return [
          key,
          {
            status,
            providerId: typeof d?.id === 'string' ? d.id : null,
            targetKinds:
              Array.isArray(kinds) && status !== 'INVALID_DECLARATION' ? [...kinds] : null,
          },
        ]
      }),
    ),
    states = Object.values(components).map((row) => row.status)
  const status = states.some((s) => ['INVALID_DECLARATION', 'INCOMPATIBLE'].includes(s))
    ? 'INCOMPATIBLE'
    : (['MISSING', 'INPUTS_REQUIRED', 'UNKNOWN'].find((s) => states.includes(s)) ??
      'DECLARED_MATCH')
  return {
    targetKind: targetKind ?? null,
    status,
    components,
    limitation:
      'Declared Target-kind support only; not execution or measurement qualification. Undeclared legacy support is UNKNOWN.',
  }
}

// Read-only declared binding checks shared by public provider tests and planning.
// Call with resolveNativeContract(...).spec; trusted describe methods must not do work.
export function inspectProviderContracts(ctx, spec) {
  for (const key of providerContractDependencies(spec))
    assertProviderMethods(ctx[key], key, methods[key])
  const cap = 'maxCumulativeCost' + moneyFields(spec.budget).cap.slice('maxCost'.length)
  if (spec.budget[cap] !== undefined)
    assertProviderMethods(ctx.duoBudget, 'duoBudget', ['checkAdmission', 'admitRun'])
  const target = ctx.duoTarget.describe()
  if (target?.targetKinds !== undefined) {
    if (
      !Array.isArray(target.targetKinds) ||
      !target.targetKinds.length ||
      target.targetKinds.some(
        (kind) => typeof kind !== 'string' || !new RegExp(targetKindSchema.pattern).test(kind),
      )
    )
      fail(
        'DUO_PROVIDER_INVALID',
        'Target targetKinds must be a nonempty list of valid kind identifiers',
      )
    if (!target.targetKinds.includes(spec.target.kind))
      fail(
        'DUO_TARGET_INCOMPATIBLE',
        'Configured Target adapter does not support the contract kind; select its advertised adapter before running',
      )
  }
  for (const [component, method] of [
    ['duoComparator', 'aggregate'],
    ['duoGate', 'decide'],
  ])
    if (method in ctx[component]) assertProviderMethods(ctx[component], component, [method])
  if ('orderHistory' in ctx.duoFeedback)
    assertProviderMethods(ctx.duoFeedback, 'duoFeedback', ['orderHistory'])
  const generator = spec.mode === 'evaluation_only' ? null : ctx.duoGenerator.describe(),
    executor = ctx.duoExecutor.describe(),
    evaluators = ctx.duoEvaluators.describe()
  const targetCompatibility = workTargetCompatibility(spec, { generator, executor })
  for (const [key, row] of Object.entries(targetCompatibility.components)) {
    if (row.status === 'INVALID_DECLARATION')
      fail(
        'DUO_PROVIDER_TARGET_INVALID',
        `${key} targetKinds must be a nonempty list of valid Target kinds`,
      )
    if (row.status === 'INCOMPATIBLE')
      fail(
        `DUO_${key.toUpperCase()}_TARGET_INCOMPATIBLE`,
        `${key} ${row.providerId} supports ${row.targetKinds.join(', ')}, not ${spec.target.kind}; bind a matching provider and inspect a new plan before work`,
      )
  }
  if (!Array.isArray(evaluators))
    fail('DUO_PROVIDER_INVALID', 'Evaluator provider must describe its measurements')
  const required = [...(generator ? [generator] : []), executor],
    selectedEvaluators = []
  for (const tier of evaluationTiersOf(spec))
    if (spec[tier]) {
      const match = matchEvaluator(evaluators, spec[tier], tier, spec)
      if (!match.selected || match.issues.includes('metric_coverage'))
        fail(
          'DUO_EVALUATOR_MISSING',
          'A unique compatible evaluator with declared metric coverage is required',
        )
      if (match.issues.includes('currency'))
        fail('DUO_CURRENCY_MISMATCH', 'Evaluator currency differs from the frozen budget')
      if (match.issues.some((i) => i.startsWith('metric_direction:')))
        fail('DUO_EVALUATOR_INCOMPATIBLE', 'Evaluator metric direction differs from the objective')
      if (match.issues.some((i) => i.startsWith('dependenc')))
        fail(
          'DUO_EVALUATOR_DEPENDENCY',
          'Declared evaluator dependencies are missing, unknown or invalid; inspect dualloop_design before execution',
        )
      if (match.issues.length)
        fail(
          'DUO_PROVIDER_INVALID',
          'Evaluator permissions or reservation are invalid or unauthorized',
        )
      required.push(match.selected)
      selectedEvaluators.push(match.selected)
    }
  for (const d of required) {
    const m = moneyFields(d)
    if (m.currency !== moneyFields(spec.budget).currency)
      fail('DUO_CURRENCY_MISMATCH', 'Provider reservation currency differs from the frozen budget')
    if (
      !d ||
      typeof d.id !== 'string' ||
      !d.id.trim() ||
      typeof d.version !== 'string' ||
      !d.version.trim() ||
      typeof d[m.reservation] !== 'number' ||
      !Number.isFinite(d[m.reservation]) ||
      d[m.reservation] < 0 ||
      !d.permissions ||
      !['paid', 'network', 'externalSideEffects'].every(
        (k) => typeof d.permissions[k] === 'boolean' && (!d.permissions[k] || spec.permissions[k]),
      )
    )
      fail(
        'DUO_PROVIDER_INVALID',
        'Provider identity, reservation and permissions must be explicit and authorized by the contract',
      )
    if (!d.permissions.paid && d[m.reservation] !== 0)
      fail('DUO_PROVIDER_INVALID', 'A free provider cannot declare a paid reservation')
  }
  const policies = Object.fromEntries(
    ['duoComparator', 'duoGate', 'duoFeedback', 'duoTarget', 'duoJournal', 'duoBudget'].map(
      (key) => {
        const d = ctx[key].describe()
        if (
          !d ||
          typeof d.id !== 'string' ||
          !d.id.trim() ||
          typeof d.version !== 'string' ||
          !d.version.trim() ||
          d.deterministic !== true
        )
          fail(
            'DUO_PROVIDER_INVALID',
            'Policy and storage providers must declare their deterministic versioned contract',
          )
        return [key, d]
      },
    ),
  )
  return freeze(
    structuredClone({
      generator,
      executor,
      evaluators: selectedEvaluators,
      policies,
      targetCompatibility,
    }),
  )
}
