import { strategySummary } from './evidence-strategy.js'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { describeFailure } from './diagnostics.js'
export const name = 'dual-loop-native-tools'
export const inject = ['tools', 'duoController', 'duoBudget']
const pick = (value, keys) =>
  Object.fromEntries(
    keys.filter((key) => value?.[key] !== undefined).map((key) => [key, value[key]]),
  )
// An explicit model-facing view only; the ToolResult still contains the exact
// frozen plan. Unknown custom-provider detail is not inferred or qualified.
export function summarizePlan(plan) {
  const descriptor = (value) => {
    if (!value) return value
    const row = pick(value, [
      'id',
      'version',
      'configDigest',
      'dataId',
      'dataDigest',
      'datasetDigest',
      'implementationDigest',
      'tier',
      'currency',
      'reservationCny',
      'reservationUsd',
      'permissions',
      'provider',
      'model',
      'maxRequests',
      'maxTokens',
      'maxInputBytes',
      'evidenceKind',
      'qualification',
    ])
    if (value.pricing)
      row.pricing = pick(value.pricing, [
        'id',
        'currency',
        'inputCnyPerMillion',
        'cacheReadCnyPerMillion',
        'outputCnyPerMillion',
        'inputUsdPerMillion',
        'cacheReadUsdPerMillion',
        'outputUsdPerMillion',
        'verifiedDate',
        'schedule',
        'source',
        'requestedModel',
        'declaredServedModel',
      ])
    return row
  }
  const summary = {
    ...plan,
    view: 'summary',
    providers: {
      ...plan.providers,
      generator: descriptor(plan.providers.generator),
      executor: descriptor(plan.providers.executor),
      evaluators: plan.providers.evaluators?.map(descriptor),
    },
    fullPlan:
      'dualloop_plan({view:"full"}) includes complete provider semantics, source receipts and historical candidate context. This rendering omits those details; it grants no authority or measurement qualification.',
  }
  if (plan.evidenceStrategy)
    summary.evidenceStrategy = {
      ...strategySummary(plan.evidenceStrategy),
      recommended_mode: plan.evidenceStrategy.recommended_mode,
      available: plan.evidenceStrategy.available,
      dual_loop_missing: plan.evidenceStrategy.dual_loop_missing,
      suggested_next_steps: plan.evidenceStrategy.suggested_next_steps,
      sourceDetails: 'Full source metadata and acquisition options remain in the full plan.',
    }
  if (plan.warmStart) {
    const { context, ...metadata } = plan.warmStart
    summary.warmStart = metadata
  }
  return summary
}
// Definition-owned finalization also sees pre-dispatch denials and invalid
// arguments. Only content changes: DSH owns isError and error.info identity.
export function finalizeDuoError(exec, result) {
  if (!result.isError) return
  const error = describeFailure(
    {
      code: result.error?.info?.code ?? 'DUO_TOOL_FAILED',
      message: result.error?.message ?? 'DSH refused the DUO tool call',
    },
    'dsh.tools',
  )
  return [{ type: 'text', text: JSON.stringify({ apiVersion: 2, error }) }]
}
export function apply(ctx) {
  const register = (
    name,
    description,
    parameters,
    execute,
    concurrent = true,
    render = (_args, value) => value,
  ) =>
    ctx.tools.register(
      defineTool({
        name,
        description,
        parameters,
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (args, value) => [{ type: 'text', text: JSON.stringify(render(args, value)) }],
        },
        finalizeContent: finalizeDuoError,
        isConcurrencySafe: () => concurrent,
        execute,
      }),
    )
  register(
    'dualloop_discover',
    'Discover DSH-native DualLoop services and the configured provider capabilities. Does not execute an experiment.',
    {},
    async () => {
      const p = ctx.duoController.plan()
      return {
        apiVersion: 2,
        runtime: 'dsh-native',
        execution: 'in-process Cordis services',
        mode: p.spec.mode,
        providers: p.providers,
        services: [
          'duoContract',
          'duoTarget',
          'duoComparator',
          'duoGate',
          'duoFeedback',
          'duoJournal',
          'duoBudget',
          'duoController',
          ...(p.providers.generator ? ['duoGenerator'] : []),
          'duoExecutor',
          'duoEvaluators',
        ],
        commands: ctx.tools
          .schemas()
          .map((s) => s.name)
          .filter((n) => n.startsWith('dualloop_') && n !== 'dualloop_discover')
          .sort(),
        limitations: [
          'Trusted configured providers; no OS sandbox implied',
          'Provider evidence is not proof of optimization efficacy',
          'Existing Python ledgers require separate audited migration',
        ],
      }
    },
  )
  register(
    'dualloop_plan',
    'Inspect the frozen native contract, Target, provider identities and allowance; return planDigest and runId.',
    {
      view: {
        type: 'string',
        enum: ['full', 'summary'],
        description:
          'Summary reduces repeated provider descriptions and history context in Agent rendering; full structured plan is retained. Default full.',
      },
    },
    async () => ctx.duoController.plan(),
    true,
    (args, value) => (args.view === 'summary' ? summarizePlan(value) : value),
  )
  register(
    'dualloop_run',
    'Execute the inspected native plan. Optional pauseAfter stops at a fully settled baseline/generation boundary; resumeFrom continues that exact checkpoint within original limits. Evaluation-only performs no generation.',
    {
      planDigest: {
        type: 'string',
        required: true,
        description: 'Exact digest from dualloop_plan',
      },
      pauseAfter: {
        type: 'string',
        enum: ['baseline', 'generation'],
        description:
          'Optional deliberate pause at the next matching settled boundary; no final is run after a pause.',
      },
      resumeFrom: {
        type: 'string',
        description:
          'Exact checkpoint digest from dualloop_status; verify the current plan. No budget/deadline renewal or in-flight replay.',
      },
    },
    async (args, exec) =>
      ctx.duoController.run({
        planDigest: args.planDigest,
        signal: exec.signal,
        pauseAfter: args.pauseAfter,
        resumeFrom: args.resumeFrom,
      }),
    false,
  )
  register(
    'dualloop_status',
    'Inspect native run artifacts and latest budget without executing providers.',
    {
      runId: {
        type: 'string',
        description: 'Run identifier from plan; defaults to the current plan',
      },
    },
    async (args) => ctx.duoController.status(args.runId ?? ctx.duoController.plan().runId),
  )
  register(
    'dualloop_budget_status',
    'Read the native monetary reservation ledger, including every staged or applied receipt hash and dead-owner interruption guidance. Does not initialize missing runs.',
    { runId: { type: 'string', required: true, description: 'Native run identifier' } },
    async (args) => ({ runId: args.runId, budget: ctx.duoBudget.inspect(args.runId) }),
  )
  register(
    'dualloop_budget_reconcile',
    'Apply one already-staged native receipt by its hash from the dualloop_budget_status receipts view. Returns an explicit outcome (applied, already-settled, unknown-receipt, rejected with reason) and the resulting budget. Does not repeat a model call or infer zero cost.',
    {
      runId: { type: 'string', required: true, description: 'Native run identifier' },
      receiptHash: {
        type: 'string',
        required: true,
        description:
          'Hash of a staged receipt in this native run, from dualloop_budget_status receipts',
      },
    },
    async (args) => ({
      runId: args.runId,
      ...ctx.duoBudget.reconcile(args.runId, args.receiptHash),
    }),
    false,
  )
}
