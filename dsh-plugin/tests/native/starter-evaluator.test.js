import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Evaluator from '../../examples/model/evaluator.js'
import { modelSettings } from '../../native/model-call.js'

const data = JSON.parse(readFileSync(new URL('../../examples/model/tasks.json', import.meta.url)))
const tasks = data.tasks.map((t) => ({
  ...t,
  input: t.question,
  expected: { answer: t.answer, citations: t.answer === 'NOT_IN_RUNBOOK' ? [] : ['runbook.md'] },
}))
const good = Object.fromEntries(tasks.map((t) => [t.id, t.expected]))

test('runbook evaluator distinguishes correct facts, wrong facts and wrong citations', () => {
  assert.equal(Evaluator.evaluateAnswers(tasks, good).correct, 4)
  const wrong = Object.fromEntries(
    tasks.map((t) => [t.id, { answer: 'invented', citations: t.expected.citations }]),
  )
  assert.equal(Evaluator.evaluateAnswers(tasks, wrong).correct, 0)
  assert.equal(
    Evaluator.evaluateAnswers(tasks, {
      ...good,
      readiness: { answer: '/healthz', citations: ['runbook.md'] },
    }).correct,
    3,
  )
  assert.equal(
    Evaluator.evaluateAnswers(tasks, {
      ...good,
      deploy: { answer: good.deploy.answer, citations: ['unseen.md'] },
    }).correct,
    3,
  )
})

test('invalid answer objects are invalid evidence, not zero-scoring valid executions', () => {
  assert.equal(
    Evaluator.evaluateAnswers(tasks, { ...good, deploy: { answer: 42, citations: [] } }).valid,
    false,
  )
  assert.equal(Evaluator.evaluateAnswers(tasks, { ...good, extra: {} }).valid, false)
  assert.equal(Evaluator.evaluateAnswers(tasks, {}).valid, false)
})

test('function adapter checks native dataset/candidate identity and advertises actual measurement', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'duo-runbook-'))
  const path = join(root, 'dataset.json')
  writeFileSync(path, JSON.stringify({ version: 1, fast: { id: data.id, tasks } }))
  const config = {
    provider: 'test',
    model: 'no-calls',
    datasetPath: path,
    artifactRoot: root,
    maxInputBytes: 32768,
    maxTokens: 2048,
    timeoutMs: 1000,
    currency: 'CNY',
    reservationCny: 0.1,
    evidenceKind: 'model',
    pricing: {
      id: 'test',
      currency: 'CNY',
      inputCnyPerMillion: 2,
      cacheReadCnyPerMillion: 0.04,
      outputCnyPerMillion: 8,
    },
  }
  const { datasetDigest } = modelSettings(config)
  const ctx = new Context(),
    fiber = await ctx.plugin(Evaluator, config)
  t.after(() => fiber.dispose())
  const descriptor = ctx.duoEvaluators.describe()[0]
  assert.deepEqual(descriptor.evidenceSource?.targetKinds, ['dsh-persona'])
  const request = {
    candidate: { id: 'c1', version: 'v1' },
    tier: 'fast',
    artifact: {
      status: 'completed',
      candidateId: 'c1',
      candidateVersion: 'v1',
      tier: 'fast',
      dataId: data.id,
      datasetDigest,
      text: JSON.stringify(good),
    },
  }
  const result = await ctx.duoEvaluators.evaluate(request)
  assert.equal(result.ok, true)
  assert.equal(result.metrics.task_accuracy, 1)
  assert.equal(result.costCny, 0)
  assert.equal(
    (
      await ctx.duoEvaluators.evaluate({
        ...request,
        artifact: { ...request.artifact, candidateVersion: 'other' },
      })
    ).ok,
    false,
  )
})
