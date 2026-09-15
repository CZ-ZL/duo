import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import FetchTarget, { fetchPlugin } from '../../native/config-target.js'
import {
  selectWarmStart,
  normalizeWarmStart,
  executionEnvironment,
} from '../../native/warm-start.js'
import { compileConfigProposal } from '../../native/config-generator.js'
import { digest } from '../../native/store.js'
import { setup, FixtureGenerator, FixtureExecutor } from './test-fixtures.js'
import { TargetService } from '../../native/definitions.js'

test('valid config history reaches the next config proposal; forged content is excluded and final never enters history', async (t) => {
  const { ctx, target, fibers, contract } = await setup(t)
  await fibers[1].dispose()
  const config = {
    maxBodyChars: 100000,
    maxResponseBytes: 5000000,
    timeoutMs: 30000,
    maxRedirects: 5,
    userAgent: 'deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)',
  }
  writeFileSync(target, JSON.stringify({ plugin: fetchPlugin, persona: 'Fixed persona', config }))
  const f = await ctx.plugin(FetchTarget)
  t.after(() => f.dispose())
  const adapter = ctx.duoTarget,
    baseline = adapter.snapshot(target)
  const candidate = adapter.apply(
    {
      id: 'c1',
      parentId: baseline.id,
      parentVersion: baseline.version,
      mode: 'explore',
      family: 'config',
      hypothesis: 'retain more input',
      delta: {
        kind: 'plugin-config-replace-v1',
        target: fetchPlugin,
        config: { ...config, maxBodyChars: 150000 },
      },
    },
    baseline,
  )
  const plan = {
    apiVersion: 2,
    runtime: 'dsh-native',
    spec: { ...contract, target: { kind: 'dsh-plugin-config', path: target } },
    baseline,
    environment: executionEnvironment(),
    providers: {
      generator: { id: 'g', version: '1', configDigest: 'g', evidenceKind: 'control' },
      executor: { id: 'x', version: '1', configDigest: 'x', evidenceKind: 'control' },
      evaluators: [],
      policies: {},
    },
  }
  const events = [
    { kind: 'plan', plan },
    { kind: 'candidate', candidateId: 'baseline', candidate: baseline },
    { kind: 'candidate', candidateId: 'c1', candidate, generation: 1 },
    {
      kind: 'candidate',
      candidateId: 'forged',
      candidate: { ...candidate, id: 'forged', config: { ...config, maxBodyChars: 160000 } },
    },
    { kind: 'final', secret: 'FINAL_SHOULD_NOT_APPEAR' },
  ]
  const journal = {
    open: () => ({ get: () => ({ status: 'completed' }), events: () => structuredClone(events) }),
  }
  const warm = selectWarmStart(
    journal,
    plan,
    normalizeWarmStart({ runIds: ['previous'], fixturePolicy: 'ideas_only' }),
    undefined,
    adapter,
  )
  assert.equal(warm.mode, 'warm_start')
  assert.deepEqual(
    warm.context.records.map((r) => r.source.candidateId),
    ['baseline', 'c1'],
  )
  assert.ok(
    warm.sources[0].omitted.some(
      (r) => r.candidateId === 'forged' && r.reason === 'invalid_lineage',
    ),
  )
  const feedback = {
    historyCompleteness: 'all_latest_candidates',
    history: [],
    warmStart: warm.context,
  }
  const proposal = compileConfigProposal({
    champion: baseline,
    feedback,
    quotas: { exploit: 1, explore: 0, innovate: 0 },
    generation: 1,
    dataset: { fast: { id: 'fast', tasks: [] } },
  })
  assert.equal(proposal.feedback.warmStart.records[1].delta.config.maxBodyChars, 150000)
  assert.ok(!JSON.stringify(proposal).includes('FINAL_SHOULD_NOT_APPEAR'))
})

test('a custom target without persona/config fields runs and deduplicates through the existing controller', async (t) => {
  class Generator extends FixtureGenerator {
    async propose(args) {
      const r = await super.propose(args)
      for (const c of r.candidates) c.delta = { kind: 'local-replace', value: 'changed' }
      return r
    }
  }
  class Executor extends FixtureExecutor {
    async execute({ applied }) {
      return { artifact: applied.value === 'changed' ? 'answer clearly' : 'base', costUsd: 0 }
    }
  }
  const { ctx, fibers, contract, experiment } = await setup(
    t,
    { generations: 1, quotas: { exploit: 1, explore: 1, innovate: 0 } },
    { generator: Generator, executor: Executor },
  )
  await fibers[1].dispose()
  class Custom extends TargetService {
    describe() {
      return {
        id: 'custom',
        version: '1',
        deterministic: true,
        targetKinds: ['local-text-transform'],
      }
    }
    snapshot(path) {
      return { id: 'baseline', value: 'base', version: digest('base'), path }
    }
    apply(c) {
      return { ...c, value: c.delta.value, version: digest(c.delta.value) }
    }
  }
  const f = await ctx.plugin(Custom)
  t.after(() => f.dispose())
  writeFileSync(
    experiment,
    JSON.stringify({ ...contract, target: { ...contract.target, kind: 'local-text-transform' } }),
  )
  const p = ctx.duoController.plan(),
    r = await ctx.duoController.run({ planDigest: p.planDigest })
  assert.equal(r.status, 'completed')
  assert.equal(r.conclusion, 'recommend_candidate')
  const events = ctx.duoController.status(p.runId).events
  assert.ok(events.some((e) => e.candidateId === 'dl-0002' && e.status === 'duplicate_skipped'))
})
