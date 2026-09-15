// Fixed outputs check the shipped measurement, not the Target or search quality.
import FunctionEvaluators, {
  createControlEvaluation,
} from '@dual-loop/dsh-plugin/function-evaluators'
import * as Local from './local-providers.js'
export const name = 'duo-local-evaluator-controls'
export const checked = createControlEvaluation({
  evaluate: Local.evaluateText,
  controls: [
    {
      id: 'clean',
      purpose: 'control',
      artifact: { text: 'A\nB' },
      expectedMetrics: { quality: 1, safe: true },
    },
    {
      id: 'one-trailing',
      purpose: 'control',
      artifact: { text: 'A  \nB' },
      expectedMetrics: { quality: 0.5, safe: true },
    },
    {
      id: 'both-trailing',
      purpose: 'control',
      artifact: { text: 'A  \nB  ' },
      expectedMetrics: { quality: 0, safe: true },
    },
    {
      id: 'empty',
      purpose: 'control',
      artifact: { text: '' },
      expectedMetrics: { quality: 1, safe: false },
    },
  ],
  discriminationMetric: 'quality',
  reservationCnyPerCase: 0,
})
export async function apply(ctx) {
  await ctx.plugin(Local, { generator: false, evaluators: false })
  await ctx.plugin(FunctionEvaluators, {
    evaluate: checked.evaluate,
    implementationDigest: 'local-text-controls-v1',
    dataDigest: checked.controlsDigest,
    descriptors: [
      {
        ...Local.descriptor('local-text-controls'),
        tier: 'fast',
        dataId: 'text-controls-v1',
        metrics: ['control_match_rate', 'controls_distinguish', 'sample_size'],
        evidenceKind: 'local_function_control',
        evidenceFamily: 'text_measurement_controls',
        fidelityRationale:
          'Fixed known outputs qualify only this local measurement plumbing, not Target quality or Slow fidelity.',
        evidenceSource: {
          measurement: 'Four frozen outputs checked by the existing local text measurement',
          targetKinds: ['dsh-persona'],
          family: 'text_measurement_controls',
          coverage: ['clean', 'one-trailing', 'both-trailing', 'empty'],
          dataScope: {
            id: 'text-controls-v1',
            purpose: 'control',
            description: 'Fixed controls; the Executor output is not measured',
          },
          independentOfSearch: false,
          realTools: false,
          deterministic: true,
          requiresModel: false,
          approximateCost: { currency: 'CNY', amount: 0 },
          latencyMs: null,
          sideEffects: 'none',
        },
      },
    ],
  })
}
