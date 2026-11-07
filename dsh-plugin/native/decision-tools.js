import { defineTool } from '@deepseek-ai/dsh-tools'
import { describeFailure } from './diagnostics.js'

function decisionFailure(_exec, result) {
  if (!result.isError) return
  const code = result.error?.info?.code ?? 'DUO_TOOL_FAILED'
  const error = describeFailure(
    {
      code,
      message: result.error?.message,
      nextAction:
        'Read dualloop_decision_describe and dualloop_decision_status. Correct the input or obtain missing owner authorization; inspect retained receipts before any retry. No optimization plan is required.',
    },
    'duoDecisions',
  )
  if (
    [
      'INVALID_ARGS',
      'DUO_DECISION_INPUT_INVALID',
      'DUO_DECISION_AUTHORIZATION_REQUIRED',
      'DUO_DECISION_CONFIG_CHANGED',
      'DUO_DECISION_REQUEST_CHANGED',
      'DUO_DECISION_UNAVAILABLE',
    ].includes(code)
  ) {
    error.component = 'duoDecisions'
    error.costState = error.sideEffectState = 'NO_WORK_DISPATCHED_BY_THIS_CALL'
    error.recoverability = 'CORRECT_INPUT_OR_CONFIGURATION_WITHIN_OWNER_AUTHORITY'
    error.recoveryCondition =
      'Use valid questions, the bound request identity and an active provider covered by the original owner allowance'
  }
  return [{ type: 'text', text: JSON.stringify({ apiVersion: 2, error }) }]
}

export const name = 'duo-decision-tools'
export const inject = ['tools', 'duoDecisions']
export function apply(ctx) {
  const register = (name, description, parameters, execute, concurrent = true) =>
    ctx.tools.register(
      defineTool({
        name,
        description,
        parameters,
        execute,
        isConcurrencySafe: () => concurrent,
        finalizeContent: decisionFailure,
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (_args, value) => {
            const { rawOutput, ...short } = value
            return [{ type: 'text', text: JSON.stringify(short) }]
          },
        },
      }),
    )
  register(
    'dualloop_decision_describe',
    'Inspect the independent lightweight decision provider, question types, owner permissions and remaining allowance. No model work, Target or optimization experiment.',
    {},
    () => ctx.duoDecisions.describe(),
  )
  register(
    'dualloop_decide',
    'Judge one supplied state against 1–16 configurable choice, score or boolean questions in one bounded batch. Returns typed answers, unknowns and CNY cost. Does not execute an action. Reuse requestId only for identical input; no blind retries.',
    {
      requestId: { type: 'string', required: true },
      state: {
        type: 'json',
        required: true,
        description:
          'A nonempty text, JSON object or array containing only the context needed for these judgments.',
      },
      questions: {
        type: 'object',
        additionalProperties: true,
        required: true,
        description:
          'Map IDs to {type,instructions,criteria?}. choice: described option map; score: ordered level array (result is its zero-based index); boolean: no criteria. null answers mean unknown.',
      },
    },
    (args, exec) => ctx.duoDecisions.decide({ ...args, signal: exec.signal }),
    false,
  )
  register(
    'dualloop_decision_status',
    'Read the durable decision allowance and optional prior request result. No model call or new authorization. Raw output and receipts may contain private supplied inputs.',
    {
      requestId: { type: 'string' },
    },
    ({ requestId }) => ctx.duoDecisions.status(requestId),
  )
}
