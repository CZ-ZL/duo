// Deterministic installation example only. This is NOT a semantic model.
import FunctionDecisions from '@dual-loop/dsh-plugin/decisions'
export const name = 'duo-local-decision-example'
export const inject = ['duoJournal', 'duoBudget']
export async function apply(ctx) {
  await ctx.plugin(FunctionDecisions, {
    descriptor: {
      id: 'local-ticket-decisions',
      version: '1',
      configDigest: 'ticket-keywords-v1',
      evidenceKind: 'fixture',
      currency: 'CNY',
      reservationCny: 0,
      maxRequests: 0,
      permissions: { paid: false, network: false, externalSideEffects: false },
    },
    authorization: {
      id: 'local-example',
      currency: 'CNY',
      maxCostCny: 0,
      maxCalls: 2,
      paid: false,
      network: false,
    },
    judge: async ({ state, questions }) => {
      const message = typeof state === 'string' ? state : (state.message ?? '')
      const values = {
        route: /charge|invoice/i.test(message) ? 'billing' : 'general',
        urgency: /urgent|today/i.test(message) ? 1 : 0,
        needs_human: /person|human/i.test(message),
      }
      return {
        answers: Object.fromEntries(Object.keys(questions).map((id) => [id, values[id] ?? null])),
        currency: 'CNY',
        costCny: 0,
        costEvidence: { kind: 'fixture', method: 'local_keyword_checks', modelRequests: 0 },
      }
    },
  })
}
