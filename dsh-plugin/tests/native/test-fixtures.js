import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JsonContract from '../../native/contract.js'
import PersonaTarget from '../../native/target.js'
import NativeController from '../../native/controller.js'
import { WeightedComparator, TopKGate, ConservativeFeedback } from '../../native/policies.js'
import { SqliteJournal, ReservedBudget } from '../../native/store.js'
import { GeneratorService, ExecutorService, EvaluatorsService } from '../../native/definitions.js'

export const descriptor = (id, extra = {}) => ({
  id,
  version: '1',
  reservationUsd: 0,
  permissions: { paid: false, network: false, externalSideEffects: false },
  evidenceKind: 'fixture',
  ...extra,
})
export class FixtureGenerator extends GeneratorService {
  describe() {
    return descriptor('fixture-generator')
  }
  async propose({ champion, quotas, generation, nextId, feedback }) {
    const candidates = []
    for (const [mode, n] of Object.entries(quotas))
      for (let i = 0; i < n; i++)
        candidates.push({
          id: nextId(),
          parentId: champion.id,
          parentVersion: champion.version,
          family: mode,
          mode,
          hypothesis: 'Check whether an explicit instruction passes the fixture.',
          delta: {
            kind: 'cordis-overlay',
            target: 'system-prompt',
            persona: champion.persona + '\nanswer clearly',
          },
        })
    return { candidates, costUsd: 0 }
  }
}
export class FixtureExecutor extends ExecutorService {
  describe() {
    return descriptor('fixture-executor')
  }
  async execute({ applied }) {
    return { artifact: applied.persona, costUsd: 0 }
  }
}
export class FixtureEvaluators extends EvaluatorsService {
  describe() {
    return ['fast', 'slow', 'final'].map((tier) =>
      descriptor('fixture-' + tier, {
        tier,
        dataId: tier,
        metrics: ['quality', 'safe', 'sample_size'],
      }),
    )
  }
  async evaluate({ candidate, artifact, tier }) {
    return {
      candidateId: candidate.id,
      evaluatorId: 'fixture-' + tier,
      version: '1',
      dataId: tier,
      tier,
      ok: true,
      metrics: { quality: artifact.includes('answer clearly') ? 1 : 0, safe: true, sample_size: 2 },
      costUsd: 0,
      evidence: [],
    }
  }
}
export async function setup(t, overrides = {}, Providers = {}) {
  const root = mkdtempSync(join(tmpdir(), 'duo-native-controller-')),
    target = join(root, 'persona.txt'),
    experiment = join(root, 'experiment.json'),
    runs = join(root, 'runs')
  writeFileSync(target, 'You are {{model}} in {{cwd}}.')
  const objective = (tier) => ({
    evaluatorId: 'fixture-' + tier,
    version: '1',
    dataId: tier,
    weights: { quality: 1 },
    direction: 'maximize',
    metric: 'quality',
  })
  const contract = {
    version: 1,
    id: 'native-fixture',
    target: { kind: 'dsh-persona', path: target },
    fast: objective('fast'),
    slow: objective('slow'),
    final: objective('final'),
    constraints: [{ metric: 'safe', op: '==', value: true }],
    epsilon: 0.01,
    minSamples: 2,
    generations: 2,
    quotas: { exploit: 1, explore: 1, innovate: 1 },
    topK: 1,
    budget: {
      maxCostUsd: 0,
      maxSessions: 100,
      maxFastEvals: 20,
      maxSlowEvals: 10,
      maxWallTimeMs: 10000,
    },
    ...overrides,
  }
  writeFileSync(experiment, JSON.stringify(contract))
  const ctx = new Context(),
    fibers = []
  for (const [P, config] of [
    [JsonContract, { experiment }],
    [PersonaTarget],
    [WeightedComparator],
    [TopKGate],
    [ConservativeFeedback],
    [SqliteJournal, { root: runs }],
    [ReservedBudget],
    [Providers.generator ?? FixtureGenerator],
    [Providers.executor ?? FixtureExecutor],
    [Providers.evaluators ?? FixtureEvaluators],
    [NativeController],
  ])
    fibers.push(await ctx.plugin(P, config))
  t.after(async () => {
    for (const f of fibers.reverse()) await f.dispose()
  })
  return { ctx, root, target, experiment, runs, contract, fibers }
}
