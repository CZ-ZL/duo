import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Agents from '@deepseek-ai/dsh-agent'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JsonContract, { resolveNativeContract } from '../../native/contract.js'
import * as Controllers from '../../native/controller.js'
import Target from '../../native/target.js'
import { WeightedComparator, TopKGate, ConservativeFeedback } from '../../native/policies.js'
import { SqliteJournal, ReservedBudget } from '../../native/store.js'
import { EvaluatorsService } from '../../native/definitions.js'
import * as Fixtures from '../../../examples/native/fixture-provider.js'
import * as NativeTools from '../../native/tools.js'

const contract = () => ({
  ...JSON.parse(
    readFileSync(new URL('../../../examples/native/byo-experiment.json', import.meta.url), 'utf8'),
  ),
  operation: 'evaluate',
  generations: 0,
  quotas: { exploit: 0, explore: 0, innovate: 0 },
  fast: {
    evaluatorId: 'fixture-fast',
    version: '1',
    dataId: 'fast',
    metric: 'quality',
    direction: 'maximize',
    weights: { quality: 1 },
  },
  slow: null,
  final: null,
})
async function setup(t, { unknown = false, invalid = false } = {}) {
  assert.equal(
    typeof Controllers.EvaluationController,
    'function',
    'A native evaluation-only composition must be available without a generator',
  )
  const root = mkdtempSync(join(tmpdir(), 'duo-evaluate-only-')),
    path = join(root, 'experiment.json'),
    target = join(root, 'persona.txt'),
    c = contract()
  writeFileSync(path, JSON.stringify(c))
  writeFileSync(target, 'You are {{model}} in {{cwd}}.')
  let evaluations = 0
  class Measure extends EvaluatorsService {
    describe() {
      return [
        {
          id: 'fixture-fast',
          version: '1',
          dataId: 'fast',
          tier: 'fast',
          metrics: ['quality', 'safe', 'sample_size'],
          currency: 'CNY',
          reservationCny: 0,
          permissions: { paid: false, network: false, externalSideEffects: false },
          evidenceKind: 'fixture',
        },
      ]
    }
    async evaluate({ candidate, tier }) {
      evaluations++
      return {
        candidateId: candidate.id,
        evaluatorId: 'fixture-fast',
        version: '1',
        dataId: 'fast',
        tier,
        ok: !invalid,
        metrics: { quality: 0, safe: false, sample_size: 2 },
        currency: 'CNY',
        costCny: unknown ? null : 0,
      }
    }
  }
  const ctx = new Context(),
    fibers = []
  for (const [P, config] of [
    [Agents],
    [SystemPrompt],
    [Tools],
    [JsonContract, { experiment: path }],
    [Target],
    [WeightedComparator],
    [TopKGate],
    [ConservativeFeedback],
    [SqliteJournal, { root: join(root, 'runs') }],
    [ReservedBudget],
    [Fixtures, { currency: 'CNY', generator: false, evaluators: false }],
    [Measure],
    [Controllers.EvaluationController],
    [NativeTools],
  ])
    fibers.push(await ctx.plugin(P, config))
  t.after(async () => {
    for (const f of fibers.reverse()) await f.dispose()
  })
  const call = async (name, args = {}) => {
    const r = await ctx.tools.execute({
      name,
      arguments: args,
      callId: 'evaluate-only',
      signal: new AbortController().signal,
    })
    assert.equal(r.isError, false, JSON.stringify(r.error))
    return r.value
  }
  return { ctx, call, target, path, count: () => evaluations }
}
test('explicit evaluation intent forbids hidden search settings and missing measurements', () => {
  const c = contract()
  assert.equal(resolveNativeContract(c, '/tmp/experiment.json').spec.mode, 'evaluation_only')
  for (const change of [
    { generations: 1 },
    { quotas: { exploit: 1, explore: 0, innovate: 0 } },
    { fast: null, slow: null, final: null },
    { operation: 'evaluate_then_search' },
  ])
    assert.throws(() => resolveNativeContract({ ...c, ...change }, '/tmp/experiment.json'))
})
test('public run evaluates only baseline without a generator, retains constraint failure and reuses existing accounting', async (t) => {
  const { ctx, call, target, count } = await setup(t),
    before = readFileSync(target, 'utf8'),
    p = await call('dualloop_plan')
  assert.equal(p.providers.generator, null)
  assert.equal(p.spec.mode, 'evaluation_only')
  const r = await call('dualloop_run', { planDigest: p.planDigest }),
    s = await call('dualloop_status', { runId: p.runId })
  assert.equal(r.status, 'completed')
  assert.equal(r.stopReason, 'evaluation_complete')
  assert.equal(r.generationsRun, 0)
  assert.equal(r.evaluations[0].metrics.safe, false)
  assert.equal(r.measurementChecks.fast.verdicts.baseline, 'constraint_violation')
  assert.equal(r.improvementProven, false)
  assert.equal(r.selectedOverlay, null)
  assert.ok(!s.events.some((e) => ['feedback', 'comparison'].includes(e.kind)))
  assert.ok(
    s.events.filter((e) => e.kind === 'candidate').every((e) => e.candidateId === 'baseline'),
  )
  assert.equal(s.budget.operations, 2)
  assert.equal(s.budget.costCny, 0)
  assert.equal(count(), 1)
  const replay = await call('dualloop_run', { planDigest: p.planDigest })
  assert.equal(replay.reusedArtifacts, true)
  assert.equal(count(), 1)
  assert.equal(readFileSync(target, 'utf8'), before)
  assert.equal(ctx.get('duoGenerator'), undefined)
})
test('evaluation-only missing fee stops without replaying or invoking search', async (t) => {
  const { call, count } = await setup(t, { unknown: true }),
    p = await call('dualloop_plan'),
    r = await call('dualloop_run', { planDigest: p.planDigest })
  assert.equal(r.status, 'failed')
  assert.equal(r.stopReason, 'DUO_COST_UNKNOWN')
  assert.equal(r.budget.costCny, null)
  assert.equal(count(), 1)
})
test('evaluation receipt can fail while evaluation-only reports insufficient evidence and retains the failure', async (t) => {
  const { call } = await setup(t, { invalid: true }),
    p = await call('dualloop_plan'),
    r = await call('dualloop_run', { planDigest: p.planDigest })
  assert.equal(r.status, 'completed')
  assert.equal(r.conclusion, 'insufficient_evidence')
  assert.equal(r.evaluations[0].ok, false)
})
