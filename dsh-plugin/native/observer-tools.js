import { defineTool } from '@deepseek-ai/dsh-tools'
import { finalizeDuoError } from './tools.js'
export const name = 'dual-loop-observer-tools'
export const inject = ['tools', 'duoObserver']
export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'dualloop_report',
      description:
        'Read an existing native run as candidate states, lineage, stage evidence, decisions, latest costs and a human-readable table. No execution or promotion.',
      parameters: {
        runId: { type: 'string', required: true },
        includeEvents: {
          type: 'boolean',
          description: 'Include the derived JSONL event export; default false.',
        },
        view: {
          type: 'string',
          enum: ['full', 'summary'],
          description:
            'Summary renders deterministic text, latest budget and limits to the Agent; full structured facts remain in the tool result. Default full.',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (args, value) => [
          {
            type: 'text',
            text: JSON.stringify(
              args.view === 'summary'
                ? {
                    apiVersion: value.apiVersion,
                    runtime: value.runtime,
                    reportVersion: value.reportVersion,
                    view: 'summary',
                    runId: value.runId,
                    status: value.status,
                    mode: value.mode,
                    conclusion: value.conclusion,
                    stopReason: value.stopReason,
                    improvementProven: value.improvementProven,
                    optimization_mode: value.optimization_mode,
                    slow_mode: value.slow_mode,
                    evidence_gaps: value.evidence_gaps,
                    additional_evidence_acquired: value.additional_evidence_acquired,
                    downgrade: value.downgrade,
                    dual_loop_validation: value.dual_loop_validation,
                    budget: value.budget,
                    text: value.text,
                    limitations: value.limitations,
                    fullReport:
                      'dualloop_report({runId,view:"full"}) returns full candidate, provider, metric, diagnosis and recovery details. This summary is not an independent evaluation.',
                  }
                : value,
            ),
          },
        ],
      },
      finalizeContent: finalizeDuoError,
      isConcurrencySafe: () => true,
      execute: ({ runId, includeEvents = false }) => {
        const r = ctx.duoObserver.report(runId)
        if (!includeEvents) delete r.journalJsonl
        return r
      },
    }),
  )
}
