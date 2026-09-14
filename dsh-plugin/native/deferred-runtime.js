// Optional composition for a host where the Caller will attach its own
// Evaluator after startup. Existing services/algorithms remain authoritative.
import Schema from '@deepseek-ai/schemastery'
import Controller from './controller.js'
import EvaluationController from './evaluation-controller.js'
import Observer from './observer.js'
import * as Tools from './tools.js'
import * as Reports from './observer-tools.js'
export const name = 'dual-loop-deferred-runtime'
export const Config = Schema.object({ evaluationOnly: Schema.boolean().default(false) })
export function apply(ctx, config = {}) {
  const Runtime = config.evaluationOnly ? EvaluationController : Controller
  ctx.inject(Runtime.inject, async (child) => {
    await child.plugin(Runtime)
    await child.plugin(Observer)
    await child.plugin(Tools)
    await child.plugin(Reports)
  })
}
