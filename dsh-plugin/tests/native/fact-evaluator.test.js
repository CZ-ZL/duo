import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Agents from '@deepseek-ai/dsh-agent'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import JsonContract from '../../native/contract.js'
import { EvaluationController } from '../../native/controller.js'
import Target from '../../native/target.js'
import { WeightedComparator, TopKGate, ConservativeFeedback } from '../../native/policies.js'
import { SqliteJournal, ReservedBudget, digest } from '../../native/store.js'
import { ExecutorService } from '../../native/definitions.js'
import Observer from '../../native/observer.js'
import * as ObserverTools from '../../native/observer-tools.js'
import * as NativeTools from '../../native/tools.js'
import * as Onboarding from '../../native/onboarding.js'
import * as FactEvaluator from '../../../examples/native/fact-evaluator.js'
import { buildFactTask, writeFactTask } from '../../../examples/native/fact-task.js'

for (const [scenario, score, valid] of [
  ['correct', 1, true],
  ['wrong_fact', 0.8, true],
  ['unsupported_citation', 0.8, true],
  ['malformed', 0, false],
  ['missing_task', 0.8, false],
]) {
  test('public evaluation-only fact control: ' + scenario, async (t) => {
    const parent = resolve(process.env.DUO_FACT_REPORT_DIR ?? tmpdir())
    mkdirSync(parent, { recursive: true })
    const root = mkdtempSync(join(parent, 'duo-facts-' + scenario + '-')),
      path = join(root, 'experiment.json'),
      target = join(root, 'persona.txt')
    writeFactTask(root)
    const { dataset, answerKey } = buildFactTask()
    const answers = Object.fromEntries(
      Object.entries(answerKey.splits.fast).map(([id, k]) => [
        id,
        {
          answer: String(k.answer),
          unit: k.unit,
          abstain: k.abstain,
          citations: [...new Set(k.support.map((e) => e.source))],
          evidence: k.support,
        },
      ]),
    )
    const first = dataset.fast.tasks[0].id
    if (scenario === 'wrong_fact') answers[first].answer = '999'
    if (scenario === 'unsupported_citation') {
      const source = answerKey.splits.fast[first].allowedSources[1]
      answers[first].citations = [source]
      answers[first].evidence = [{ source, line: 2 }]
    }
    if (scenario === 'missing_task') delete answers[first]
    const text = scenario === 'malformed' ? 'not JSON' : JSON.stringify(answers)
    writeFileSync(
      target,
      readFileSync(new URL('../../../examples/native/persona.txt', import.meta.url)),
    )
    const c = {
      version: 1,
      id: 'fact-control-' + scenario,
      operation: 'evaluate',
      target: { kind: 'dsh-persona', path: target },
      fast: {
        evaluatorId: 'fact-support-fast',
        version: '2',
        dataId: dataset.fast.id,
        metric: 'supported_accuracy',
        direction: 'maximize',
        weights: { supported_accuracy: 1 },
      },
      slow: null,
      final: null,
      constraints: [{ metric: 'format_valid', op: '==', value: true }],
      epsilon: 0.01,
      minSamples: 1,
      generations: 0,
      topK: 0,
      quotas: { exploit: 0, explore: 0, innovate: 0 },
      permissions: { paid: false, network: false, externalSideEffects: false },
      budget: {
        currency: 'CNY',
        maxCostCny: 0,
        maxSessions: 4,
        maxFastEvals: 1,
        maxSlowEvals: 0,
        maxWallTimeMs: 10000,
      },
    }
    writeFileSync(path, JSON.stringify(c, null, 2))
    let executions = 0
    class ControlExecutor extends ExecutorService {
      describe() {
        return {
          id: 'predeclared-control-outputs',
          version: '1',
          configDigest: digest({ scenario, text }),
          currency: 'CNY',
          reservationCny: 0,
          permissions: c.permissions,
          evidenceKind: 'fixture',
        }
      }
      async execute({ candidate, tier }) {
        executions++
        return {
          currency: 'CNY',
          costCny: 0,
          artifact: {
            candidateId: candidate.id,
            candidateVersion: candidate.version,
            tier,
            dataId: dataset[tier].id,
            datasetDigest: answerKey.datasetDigest,
            status: 'completed',
            text,
          },
        }
      }
    }
    const ctx = new Context(),
      fibers = []
    t.after(async () => {
      for (const f of fibers.reverse()) await f.dispose()
    })
    for (const [P, config] of [
      [Agents],
      [SystemPrompt],
      [Tools],
      [JsonContract, { experiment: path }],
      [Target],
      [WeightedComparator],
      [TopKGate],
      [ConservativeFeedback],
      [SqliteJournal, { root: join(root, 'journal') }],
      [ReservedBudget],
      [ControlExecutor],
      [
        FactEvaluator,
        { datasetPath: join(root, 'dataset.json'), answerKeyPath: join(root, 'answerKey.json') },
      ],
      [EvaluationController],
      [NativeTools],
      [Onboarding],
      [Observer],
      [ObserverTools],
    ])
      fibers.push(await ctx.plugin(P, config))
    const call = async (name, args = {}) => {
      const r = await ctx.tools.execute({
        name,
        arguments: args,
        callId: 'fact-control',
        signal: new AbortController().signal,
      })
      assert.equal(r.isError, false, JSON.stringify(r.error))
      return r.value
    }
    const preparation = await call('dualloop_design', {
      draft: c,
      experimentPath: path,
      context: { measurementGoal: 'task_result' },
    })
    assert.equal(preparation.preparation.recommendedOperation, 'evaluate')
    assert.equal(preparation.preparation.measurementReadiness.status, 'DECLARED_MATCH')
    const plan = await call('dualloop_plan'),
      result = await call('dualloop_run', { planDigest: plan.planDigest }),
      report = await call('dualloop_report', { runId: plan.runId })
    assert.equal(result.status, 'completed')
    assert.equal(result.generationsRun, 0)
    assert.equal(executions, 1)
    assert.equal(plan.providers.generator, null)
    assert.equal(result.evaluations[0].metrics.supported_accuracy, score)
    assert.equal(result.evaluations[0].metrics.format_valid, valid)
    assert.equal(result.evaluations[0].metrics.sample_size, 5)
    assert.equal(result.budget.costCny, 0)
    assert.equal(result.improvementProven, false)
    await call('dualloop_report', { runId: plan.runId })
    assert.equal(executions, 1)
    writeFileSync(
      join(root, 'control-report.json'),
      JSON.stringify(
        {
          scenario,
          evidenceKind: 'CONTROL_OUTPUT_FUNCTIONAL_TEST',
          notOptimizationBenefit: true,
          modelRequests: 0,
          costCny: 0,
          preparation,
          plan,
          result,
          report,
        },
        null,
        2,
      ) + '\n',
    )
  })
}
