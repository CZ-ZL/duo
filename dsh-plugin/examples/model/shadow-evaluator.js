// Opt-in composition: existing task scores plus an unqualified shadow observation.
import FunctionEvaluators from '@dual-loop/dsh-plugin/function-evaluators'
import { createSupportShadow } from '@dual-loop/dsh-plugin/quick-judgment'
import { createModelSupportJudge } from '@dual-loop/dsh-plugin/support-judge'
import { modelSettings } from '@dual-loop/dsh-plugin/model-accounting'
import { createStarterEvaluatorConfig } from './evaluator.js'

export const name = 'duo-grounded-qa-support-shadow'
export const inject = ['agents', 'llm', 'systemPrompt', 'tools']

export async function apply(ctx, config) {
  const { dataset } = modelSettings(config)
  await ctx.plugin(
    FunctionEvaluators,
    createSupportShadow({
      primary: createStarterEvaluatorConfig(config),
      judge: createModelSupportJudge(ctx, config),
      projectionId: 'runbook-answer-support-v1',
      project: ({ artifact }) => {
        const answers = JSON.parse(artifact.text)
        return dataset.fast.tasks.map((task) => ({
          id: task.id,
          source: task.input,
          claim: answers[task.id].answer,
        }))
      },
    }),
  )
}
