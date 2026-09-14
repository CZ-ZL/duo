// An ordinary existing function attached through the public EvaluatorsService adapter.
import FunctionEvaluators from '@dual-loop/dsh-plugin/function-evaluators'
import { evaluateText, descriptors } from './local-providers.js'
export const name = 'duo-byo-function-example'
export async function apply(ctx) {
  await ctx.plugin(FunctionEvaluators, {
    evaluate: evaluateText,
    descriptors: descriptors(),
    implementationDigest: 'byo-text-check-v1',
    dataDigest: 'target-text-local-only-v1',
  })
}
