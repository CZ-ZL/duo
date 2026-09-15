// Offline method-operation controls; never optimization-effect evidence.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import MethodFeedback, {
  singleLoopData,
  publicDevelopmentTasks,
} from '../../../examples/native/method-feedback.js'
import * as Methods from '../../../examples/native/method-feedback.js'
import { createHash } from 'node:crypto'
import { buildFactTask } from '../../../examples/native/fact-task.js'
import { digest } from '../../native/contract.js'
import { readDataset } from '../../native/model-call.js'
import { setup, FixtureGenerator, FixtureEvaluators } from './test-fixtures.js'
import BoundedTieGate from '../../native/bounded-tie-gate.js'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Sessions from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import ModelGenerator from '../../native/model-generator.js'
import * as FactEvaluator from '../../../examples/native/fact-evaluator.js'

async function projectedRequest(t, root, datasetPath, args, options = {}) {
  const ctx = new Context(),
    fibers = [],
    requests = []
  for (const P of [AgentRegistry, Sessions, Projections, LlmRuntime, Tools])
    fibers.push(await ctx.plugin(P))
  fibers.push(
    await ctx.plugin(SystemPrompt, {
      includeHarnessIdentity: false,
      includeRuntimeContext: false,
      persona: 'HOST',
    }),
  )
  class Adapter extends LlmAdapter {
    async *stream(options) {
      requests.push(options)
      yield {
        type: 'text-delta',
        index: 0,
        text: JSON.stringify({
          candidates: [
            {
              mode: 'exploit',
              family: 'control',
              hypothesis: 'Offline context projection only',
              persona: 'Distinct controlled proposal {{model}} {{cwd}}',
            },
          ],
        }),
      }
      yield {
        type: 'usage',
        usage: { inputTokens: 80, cacheReadTokens: 20, outputTokens: 10, totalTokens: 110 },
      }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  fibers.push(
    await ctx.plugin({
      name: 'method-context-control',
      inject: ['llm'],
      apply(c) {
        c.llm.registerAdapter(['test'], new Adapter())
      },
    }),
  )
  fibers.push(await ctx.plugin(AgentLoop, { agents: [] }))
  fibers.push(
    await ctx.plugin(ModelGenerator, {
      provider: 'test',
      model: 'offline',
      datasetPath,
      artifactRoot: join(root, 'model-projection'),
      maxInputBytes: options.maxInputBytes ?? 32768,
      maxTokens: 2048,
      timeoutMs: 3000,
      reservationUsd: 0.1,
      evidenceKind: 'fixture',
      pricing: {
        id: 'CONTROL_ONLY',
        inputUsdPerMillion: 1,
        cacheReadUsdPerMillion: 0.1,
        outputUsdPerMillion: 2,
      },
    }),
  )
  t.after(async () => {
    for (const f of fibers.reverse()) await f.dispose()
  })
  const result = await ctx.duoGenerator.propose({
    ...args,
    generation: 2,
    nextId: () => 'projection-only',
  })
  assert.equal(result.candidates.length, 1)
  assert.equal(result.costEvidence.attempts, 1)
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0].tools ?? [], [])
  assert.equal(ctx.agents.list().length, 0)
  const inputs = requests[0].messages
    .flatMap((m) => m.content)
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
  const prompt = inputs
    .map((text) => {
      try {
        return JSON.parse(text)
      } catch {
        return null
      }
    })
    .find((x) => x?.feedback)
  // Transport is JSON; null-prototype dictionaries have ordinary prototypes
  // after parsing. Compare every serialized field, not in-memory prototypes.
  assert.deepEqual(prompt.feedback, JSON.parse(JSON.stringify(args.feedback)))
  assert.doesNotMatch(JSON.stringify(requests[0]), /final-group-|answerKeyDigest/)
  if (options.evidenceDirectory) {
    mkdirSync(options.evidenceDirectory, { recursive: false })
    for (const [name, value] of [
      ['request.json', requests[0]],
      ['prompt.json', prompt],
      ['result.json', result],
    ])
      writeFileSync(join(options.evidenceDirectory, name), JSON.stringify(value, null, 2) + '\n', {
        flag: 'wx',
      })
    writeFileSync(
      join(options.evidenceDirectory, 'scope.json'),
      JSON.stringify({
        kind: 'OFFLINE_AGENT_LOOP_PROJECTION',
        paidCalls: 0,
        actualAdapterRequests: requests.length,
        independentCaller: false,
        optimizationProven: false,
      }) + '\n',
      { flag: 'wx' },
    )
  }
  return prompt
}

test('full-development single-loop data preserves every original development case and independent final', async (t) => {
  const original = buildFactTask(),
    before = structuredClone(original),
    derived = singleLoopData(original.dataset, original.answerKey)
  assert.deepEqual(original, before)
  assert.deepEqual(derived.dataset.fast.tasks, [
    ...original.dataset.fast.tasks,
    ...original.dataset.slow.tasks,
  ])
  assert.equal(derived.dataset.slow, undefined)
  assert.deepEqual(derived.dataset.final, original.dataset.final)
  assert.deepEqual(derived.answerKey.splits.fast, {
    ...original.answerKey.splits.fast,
    ...original.answerKey.splits.slow,
  })
  assert.deepEqual(derived.answerKey.splits.final, original.answerKey.splits.final)
  assert.equal(derived.answerKey.datasetDigest, digest(derived.dataset))
  assert.deepEqual(
    publicDevelopmentTasks(derived.dataset),
    publicDevelopmentTasks(original.dataset),
  )
  const h = await setup(t),
    file = join(h.root, 'single-data.json')
  writeFileSync(file, JSON.stringify(derived.dataset))
  assert.deepEqual(readDataset(file), derived.dataset)
  const overlap = structuredClone(derived.dataset)
  overlap.fast.tasks.push(overlap.final.tasks[0])
  writeFileSync(file, JSON.stringify(overlap))
  assert.throws(() => readDataset(file), { code: 'DUO_DATA_INVALID' })
  assert.throws(() =>
    singleLoopData(original.dataset, { ...original.answerKey, datasetDigest: 'foreign' }),
  )
})

test('code single-loop derivation binds exact dataset bytes and preserves all18 development tasks, tests and final', async (t) => {
  const pack = new URL('../fixtures/code-contract-audit/', import.meta.url)
  const bytes = readFileSync(new URL('dataset.json', pack)),
    dataset = JSON.parse(bytes)
  const key = JSON.parse(readFileSync(new URL('answer-key.json', pack), 'utf8')),
    before = structuredClone(key)
  const derived = Methods.singleLoopCodeData(bytes, key)
  assert.deepEqual(key, before)
  assert.equal(derived.dataset.fast.tasks.length, 18)
  assert.deepEqual(derived.dataset.fast.tasks, [...dataset.fast.tasks, ...dataset.slow.tasks])
  assert.equal(derived.dataset.slow, undefined)
  assert.deepEqual(derived.dataset.final, dataset.final)
  assert.deepEqual(derived.answerKey.tasks, key.tasks)
  assert.equal(derived.answerKey.evaluatorVersion, '4')
  assert.equal(
    derived.answerKey.datasetSha256,
    createHash('sha256').update(derived.datasetBytes).digest('hex'),
  )
  assert.equal(derived.derivation.sourceDatasetSha256, key.datasetSha256)
  assert.deepEqual(derived.derivation.sourceSplits, [dataset.fast.id, dataset.slow.id])
  const h = await setup(t),
    file = join(h.root, 'single-code.json')
  writeFileSync(file, derived.datasetBytes)
  assert.deepEqual(readDataset(file), derived.dataset)
  assert.deepEqual(publicDevelopmentTasks(derived.dataset), publicDevelopmentTasks(dataset))
  assert.throws(
    () => Methods.singleLoopCodeData(Buffer.concat([bytes, Buffer.from(' ')]), key),
    /identity/,
  )
  const duplicate = structuredClone(dataset)
  duplicate.fast.tasks.push(duplicate.final.tasks[0])
  const duplicateBytes = Buffer.from(JSON.stringify(duplicate)),
    duplicateKey = {
      ...key,
      datasetSha256: createHash('sha256').update(duplicateBytes).digest('hex'),
    }
  assert.throws(() => Methods.singleLoopCodeData(duplicateBytes, duplicateKey), /disjoint/)
})

const observation = (tier, value) => ({
  candidateId: 'c1',
  tier,
  evaluatorId: tier + '-metric',
  version: '1',
  dataId: tier + '-data',
  ok: true,
  metrics: { quality: value, sample_size: 15 },
  evidence: [
    {
      kind: 'deterministic_fact_support_measurement',
      rows: [
        {
          taskId: 'f1',
          correct: false,
          supported: false,
          formatValid: true,
          reasons: ['INCORRECT_FACT_OR_ABSTENTION'],
        },
      ],
    },
  ],
})
const entries = [
  {
    candidateId: 'c1',
    family: 'trial',
    mode: 'exploit',
    generation: 1,
    hypothesis: 'change evidence checking',
    delta: { persona: 'candidate' },
    fast: observation('fast', 0.5),
    slow: observation('slow', 0.77321),
    slowVerdict: 'not_better',
    slowDecision: 'rejected',
    status: 'rejected',
    final: { secret: 'FINAL_PRIVATE' },
  },
]
const quotas = { exploit: 1, explore: 0, innovate: 0 }

test('ablation removes every explicit Slow-derived summary and retains the same assigned quotas', async (t) => {
  const h = await setup(t),
    data = buildFactTask().dataset,
    file = join(h.root, 'data.json')
  writeFileSync(file, JSON.stringify(data))
  await h.fibers[4].dispose()
  const f = await h.ctx.plugin(MethodFeedback, { method: 'B3', datasetPath: file })
  t.after(() => f.dispose())
  const a = h.ctx.duoFeedback.summarize(entries, quotas),
    changed = structuredClone(entries)
  changed[0].slow.metrics.quality = 0.123456
  changed[0].slowDecision = 'accepted'
  changed[0].slowVerdict = 'better'
  changed[0].status = 'champion'
  changed[0].slow.evidence = [{ secret: 'SLOW_RAW_PRIVATE' }]
  const b = h.ctx.duoFeedback.summarize(changed, quotas)
  assert.deepEqual(a, b)
  assert.deepEqual(a.quotas, quotas)
  assert.deepEqual(a.families, { trial: { fastAvg: 0.5 } })
  assert.doesNotMatch(
    JSON.stringify(a),
    /slowFeedback|slowAvg|slowFailures|fastSlowCorrelation|failedRegions|championLineage|SLOW_RAW_PRIVATE|FINAL_PRIVATE|0\.77321|0\.123456/,
  )
  const plan = h.ctx.duoController.plan()
  assert.equal(plan.providers.policies.duoFeedback.method, 'B3')
})

test('single-loop feedback retains complete measured development rows and own candidate history', async (t) => {
  const h = await setup(t),
    file = join(h.root, 'data.json')
  writeFileSync(file, JSON.stringify(buildFactTask().dataset))
  await h.fibers[4].dispose()
  const f = await h.ctx.plugin(MethodFeedback, { method: 'B1', datasetPath: file })
  t.after(() => f.dispose())
  const result = h.ctx.duoFeedback.summarize(entries, quotas)
  assert.equal(result.historyCompleteness, 'all_latest_candidates')
  assert.deepEqual(result.history[0].delta, entries[0].delta)
  assert.deepEqual(result.developmentMeasurements[0].rows, entries[0].fast.evidence[0].rows)
  assert.equal(result.developmentTasks.length, 15)
  assert.doesNotMatch(JSON.stringify(result), /FINAL_PRIVATE|0\.77321|final-group-|answerKeyDigest/)
  const invalid = structuredClone(entries)
  invalid[0].fast.evidence = []
  assert.equal(
    h.ctx.duoFeedback.summarize(invalid, quotas).developmentMeasurements[0].rowAvailability,
    'NOT_PROVIDED',
  )
})

test('code B1 preserves failed and passed development evidence in the actual generator request without private or final rows', async (t) => {
  const h = await setup(t),
    file = join(h.root, 'code-data.json')
  const data = {
    version: 1,
    responseMode: 'python-code-v1',
    fast: {
      id: 'code-fast',
      tasks: [{ id: 'c-fast', input: 'Implement a public Python function.' }],
    },
    slow: {
      id: 'code-slow',
      tasks: [{ id: 'c-slow', input: 'Implement another public function.' }],
    },
    final: { id: 'code-final', tasks: [{ id: 'c-final', input: 'FINAL_PRIVATE_INPUT' }] },
  }
  writeFileSync(file, JSON.stringify(data))
  await h.fibers[4].dispose()
  const fiber = await h.ctx.plugin(MethodFeedback, { method: 'B1', datasetPath: file })
  t.after(() => fiber.dispose())
  const codeEntries = structuredClone(entries)
  const rows = [
    {
      taskId: 'c-fast',
      status: 'completed',
      taskPassed: false,
      passed: 4,
      planned: 5,
      wallTimeMs: 17,
      tests: [{ name: 'test_move', status: 'failed', error: 'source still exists' }],
      receiptPath: '/PRIVATE_RECEIPT/input.json',
      canonical_solution: 'PRIVATE_CANONICAL',
    },
    {
      taskId: 'c-slow',
      status: 'completed',
      taskPassed: true,
      passed: 5,
      planned: 5,
      tests: [{ name: 'test_copy', status: 'passed' }],
    },
    {
      taskId: 'c-final',
      status: 'completed',
      taskPassed: false,
      passed: 0,
      planned: 5,
      tests: [{ error: 'FINAL_PRIVATE_MEASUREMENT' }],
    },
  ]
  codeEntries[0].fast.evidence = [
    { kind: 'executed_python_unittest', tier: 'fast', version: '4', rows },
  ]
  const result = h.ctx.duoFeedback.summarize(codeEntries, quotas),
    measurement = result.developmentMeasurements[0]
  assert.equal(measurement.rowAvailability, 'PROVIDED')
  assert.equal(measurement.rows.length, 2)
  assert.deepEqual(
    measurement.rows.map((r) => r.taskPassed),
    [false, true],
  )
  assert.equal(measurement.rows[0].tests[0].error, 'source still exists')
  assert.equal(measurement.rows[0].wallTimeMs, 17)
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|c-final|0\.77321/)
  assert.equal(h.ctx.duoFeedback.describe().id, 'code-method-feedback')
  assert.equal(h.ctx.duoFeedback.describe().version, '2')
  const projected = await projectedRequest(t, h.root, file, {
    champion: { id: 'baseline', version: 'v1', persona: 'Write correct Python.' },
    quotas,
    feedback: result,
  })
  assert.deepEqual(projected.feedback.developmentMeasurements[0].rows, measurement.rows)
  assert.doesNotMatch(JSON.stringify(projected), /PRIVATE_|c-final/)
  const foreign = structuredClone(codeEntries)
  foreign[0].fast.evidence[0].tier = 'final'
  assert.equal(
    h.ctx.duoFeedback.summarize(foreign, quotas).developmentMeasurements[0].rowAvailability,
    'NOT_PROVIDED',
  )
})

test('all18 frozen code development tasks and actual local failure rows reach a subsequent Agent generator request', async (t) => {
  const stage = new URL('../fixtures/code-method-goal/', import.meta.url)
  const bytes = readFileSync(new URL('b1-development-pack/dataset.json', stage)),
    data = JSON.parse(bytes)
  const evaluation = JSON.parse(
    readFileSync(new URL('b1-code-evaluation/evaluation.json', stage), 'utf8'),
  )
  const h = await setup(t),
    file = join(h.root, 'all-code-data.json')
  writeFileSync(file, bytes)
  await h.fibers[4].dispose()
  const fiber = await h.ctx.plugin(MethodFeedback, { method: 'B1', datasetPath: file })
  t.after(() => fiber.dispose())
  const controlled = [
    {
      candidateId: 'code-control',
      generation: 1,
      family: 'offline-control',
      mode: 'exploit',
      delta: { persona: 'Controlled code persona; no model optimization.' },
      fast: {
        ...evaluation,
        candidateId: 'code-control',
        tier: 'fast',
        evaluatorId: 'code-unittest-fast',
        version: '4',
        dataId: data.fast.id,
      },
    },
  ]
  const feedback = h.ctx.duoFeedback.summarize(controlled, quotas)
  assert.equal(feedback.developmentTasks.length, 18)
  assert.equal(feedback.developmentMeasurements[0].rows.length, 18)
  assert.equal(feedback.developmentMeasurements[0].rows.filter((r) => !r.taskPassed).length, 1)
  const prompt = await projectedRequest(
    t,
    h.root,
    file,
    {
      champion: { id: 'baseline', version: 'original', persona: 'Write correct Python.' },
      quotas,
      feedback,
    },
    { maxInputBytes: 65536, evidenceDirectory: process.env.DUO_METHOD_REQUEST_EVIDENCE },
  )
  assert.deepEqual(prompt.feedback.developmentTasks, data.fast.tasks)
  assert.match(prompt.instruction, /Python/)
  assert.doesNotMatch(prompt.instruction, /grounded document answers|precise citations/)
  assert.equal(
    prompt.feedback.developmentMeasurements[0].rows.find((r) => r.taskId === 'BigCodeBench/412')
      .passed,
    6,
  )
  assert.doesNotMatch(
    JSON.stringify(prompt),
    /canonical_solution|receiptPath|codeSha256|testSha256/,
  )
  for (const task of data.final.tasks)
    assert.equal(
      prompt.feedback.developmentTasks.some((t) => t.id === task.id),
      false,
    )
})

test('the supplied real function evaluator measures all fifteen B1 development cases and publishes the actual coverage', async (t) => {
  const original = buildFactTask(),
    derived = singleLoopData(original.dataset, original.answerKey),
    h = await setup(t)
  const datasetPath = join(h.root, 'full.json'),
    answerKeyPath = join(h.root, 'key.json')
  writeFileSync(datasetPath, JSON.stringify(derived.dataset))
  writeFileSync(answerKeyPath, JSON.stringify(derived.answerKey))
  await h.fibers[9].dispose()
  const f = await h.ctx.plugin(FactEvaluator, { datasetPath, answerKeyPath })
  t.after(() => f.dispose())
  const tasks = derived.answerKey.splits.fast,
    answers = Object.fromEntries(
      Object.entries(tasks).map(([id, k]) => [
        id,
        {
          answer: String(k.answer),
          unit: k.unit,
          abstain: k.abstain,
          citations: k.support.map((s) => s.source),
          evidence: k.support,
        },
      ]),
    )
  const candidate = { id: 'baseline', version: 'original' },
    artifact = {
      status: 'completed',
      candidateId: 'baseline',
      candidateVersion: 'original',
      tier: 'fast',
      dataId: derived.dataset.fast.id,
      datasetDigest: digest(derived.dataset),
      text: JSON.stringify(answers),
    }
  const a = await h.ctx.duoEvaluators.evaluate({ candidate, artifact, tier: 'fast' })
  assert.equal(a.metrics.sample_size, 15)
  assert.equal(a.metrics.supported_accuracy, 1)
  const first = Object.keys(answers)[0]
  answers[first].answer = 'WRONG'
  artifact.text = JSON.stringify(answers)
  const b = await h.ctx.duoEvaluators.evaluate({ candidate, artifact, tier: 'fast' })
  assert.equal(b.metrics.supported_accuracy, 14 / 15)
  assert.equal(b.evidence[0].rows.length, 15)
  assert.deepEqual(b.evidence[0].rows.find((r) => r.taskId === first).reasons, [
    'INCORRECT_FACT_OR_ABSTENTION',
  ])
  assert.match(
    h.ctx.duoEvaluators.describe().find((x) => x.tier === 'fast').fidelityRationale,
    /15 development/,
  )
  assert.equal(
    h.ctx.duoEvaluators.describe().some((x) => x.tier === 'slow'),
    false,
  )
})

test('same native loop consumes candidate Slow evidence in generation two only for B2; B3 keeps the selection path', async (t) => {
  const outcomes = []
  for (const method of ['B2', 'B3']) {
    const seen = []
    class Generator extends FixtureGenerator {
      async propose(args) {
        seen.push(
          structuredClone({
            champion: args.champion,
            feedback: args.feedback,
            quotas: args.quotas,
          }),
        )
        const out = await super.propose(args)
        for (const c of out.candidates) c.delta.persona += ' distinct ' + args.generation
        return out
      }
    }
    class Evaluators extends FixtureEvaluators {
      async evaluate(args) {
        const r = await super.evaluate(args)
        r.metrics.quality = args.tier === 'slow' ? 0.77321 : 0.5
        return r
      }
    }
    const h = await setup(
        t,
        { quotas, final: null },
        { generator: Generator, evaluators: Evaluators },
      ),
      file = join(h.root, 'data.json')
    writeFileSync(file, JSON.stringify(buildFactTask().dataset))
    await h.fibers[4].dispose()
    const feedback = await h.ctx.plugin(MethodFeedback, { method, datasetPath: file })
    t.after(() => feedback.dispose())
    await h.fibers[3].dispose()
    const gate = await h.ctx.plugin(BoundedTieGate, { maxTies: 1 })
    t.after(() => gate.dispose())
    const p = h.ctx.duoController.plan(),
      original = readFileSync(h.target),
      result = await h.ctx.duoController.run({ planDigest: p.planDigest })
    assert.equal(result.status, 'completed')
    assert.equal(result.generationsRun, 2)
    assert.equal(seen.length, 2)
    assert.deepEqual(readFileSync(h.target), original)
    const events = h.ctx.duoController.status(p.runId).events
    assert.ok(
      events.some(
        (e) => e.kind === 'candidate' && e.candidateId === 'dl-0001' && e.slow?.tier === 'slow',
      ),
    )
    const second = seen[1].feedback,
      record = events.find((e) => e.kind === 'feedback' && e.generation === 2)
    assert.equal(record.feedbackDigest, digest(second))
    if (method === 'B2')
      assert.equal(
        second.slowFeedback.observations.find((x) => x.candidateId === 'dl-0001').slow.metrics
          .quality,
        0.77321,
      )
    else
      assert.doesNotMatch(
        JSON.stringify(second),
        /slowFeedback|slowDecision|slowAvg|slowFailures|fastSlowCorrelation|0\.77321/,
      )
    const projected = await projectedRequest(t, h.root, file, seen[1])
    if (method === 'B2')
      assert.equal(
        projected.feedback.slowFeedback.observations.find((x) => x.candidateId === 'dl-0001').slow
          .metrics.quality,
        0.77321,
      )
    else
      assert.doesNotMatch(
        JSON.stringify(projected),
        /slowFeedback|slowDecision|slowAvg|slowFailures|fastSlowCorrelation|0\.77321/,
      )
    outcomes.push({
      parent: seen.map((x) => x.champion.version),
      quotas: seen.map((x) => x.quotas),
      tasks: second.developmentTasks,
      selections: events.filter((e) => e.kind === 'gate').map((e) => e.selected),
      champion: result.championId,
    })
  }
  assert.deepEqual(outcomes[0], outcomes[1])
})
