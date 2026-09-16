// Exact content and citation checks for the public sample runbook task.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import FunctionEvaluators from '@dual-loop/dsh-plugin/function-evaluators'
import { modelSettings } from '@dual-loop/dsh-plugin/model-accounting'
export const name = 'duo-grounded-qa-starter-evaluator'

export function evaluateAnswers(tasks, answers) {
  const valid =
    answers &&
    typeof answers === 'object' &&
    !Array.isArray(answers) &&
    Object.keys(answers).sort().join(',') ===
      tasks
        .map((t) => t.id)
        .sort()
        .join(',')
  if (!valid) return { valid: false, rows: [], correct: 0 }
  const rows = tasks.map((t) => {
    const a = answers[t.id]
    const shape =
      a &&
      typeof a.answer === 'string' &&
      Array.isArray(a.citations) &&
      a.citations.every((c) => typeof c === 'string')
    return {
      taskId: t.id,
      valid: Boolean(shape),
      answerCorrect: Boolean(shape && a.answer.trim() === t.expected.answer),
      citationCorrect: Boolean(
        shape &&
          JSON.stringify([...new Set(a.citations)].sort()) ===
            JSON.stringify([...t.expected.citations].sort()),
      ),
    }
  })
  return {
    valid: rows.every((r) => r.valid),
    rows,
    correct: rows.filter((r) => r.answerCorrect && r.citationCorrect).length,
  }
}

export async function apply(ctx, config) {
  const { dataset, datasetDigest: dataDigest } = modelSettings(config)
  const implementationDigest = createHash('sha256')
    .update(readFileSync(new URL(import.meta.url)))
    .digest('hex')
  const tasks = dataset.fast.tasks
  await ctx.plugin(FunctionEvaluators, {
    implementationDigest,
    dataDigest,
    descriptors: [
      {
        id: 'starter-runbook-fast',
        version: '1',
        tier: 'fast',
        dataId: dataset.fast.id,
        metrics: ['task_accuracy', 'sample_size'],
        currency: 'CNY',
        reservationCny: 0,
        permissions: { paid: false, network: false, externalSideEffects: false },
        evidenceKind: 'model',
        evidenceFamily: 'runbook-exact-answer-and-citation',
        fidelityRationale:
          'Checks requested commands, endpoint, unsupported-answer abstention and source citation on four public development tasks; no independent final.',
        metricDefinitions: {
          task_accuracy:
            'Fraction of four tasks with the exact requested fact or abstention and the required source citation',
          sample_size: 'Number of supplied development questions',
        },
        evidenceSource: {
          measurement: 'Exact requested fact or abstention and source citation',
          targetKinds: ['dsh-persona'],
          family: 'runbook-exact-answer-and-citation',
          coverage: tasks.map((t) => t.id),
          dataScope: {
            id: dataset.fast.id,
            purpose: 'search',
            description: 'Public sample runbook development tasks',
          },
          independentOfSearch: false,
          realTools: false,
          deterministic: true,
          requiresModel: false,
          approximateCost: { currency: 'CNY', amount: 0 },
          latencyMs: null,
          sideEffects: 'None; local checks only',
        },
      },
    ],
    evaluate: async ({ candidate, artifact, tier }) => {
      if (
        artifact?.status !== 'completed' ||
        artifact.candidateId !== candidate.id ||
        artifact.candidateVersion !== candidate.version ||
        tier !== 'fast' ||
        artifact.tier !== tier ||
        artifact.dataId !== dataset.fast.id ||
        artifact.datasetDigest !== dataDigest
      )
        return {
          ok: false,
          metrics: {},
          currency: 'CNY',
          costCny: 0,
          error: {
            code: 'DUO_EVIDENCE_INVALID',
            message: 'Execution identity does not match this candidate and dataset',
          },
        }
      let result
      try {
        result = evaluateAnswers(tasks, JSON.parse(artifact.text))
      } catch {
        result = { valid: false, rows: [], correct: 0 }
      }
      return {
        ok: result.valid,
        currency: 'CNY',
        costCny: 0,
        metrics: { task_accuracy: result.correct / tasks.length, sample_size: tasks.length },
        evidence: [
          {
            kind: 'runbook-task-checks',
            dataDigest,
            correct: result.correct,
            total: tasks.length,
            rows: result.rows,
          },
        ],
        ...(!result.valid
          ? {
              error: {
                code: 'DUO_EVIDENCE_INVALID',
                message: 'Expected one answer object for every task ID',
              },
            }
          : {}),
      }
    },
  })
}
