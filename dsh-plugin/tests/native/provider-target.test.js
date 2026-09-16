import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { setup, FixtureGenerator, FixtureExecutor } from './test-fixtures.js'
import { summarizePlan } from '../../native/tools.js'
import { describeFailure } from '../../native/diagnostics.js'

const files = (path) => (existsSync(path) ? readdirSync(path) : [])

for (const component of ['generator', 'executor']) {
  test(`plan rejects incompatible ${component} before any work or Journal mutation`, async (t) => {
    let calls = 0
    class Generator extends FixtureGenerator {
      describe() {
        return {
          ...super.describe(),
          targetKinds: [component === 'generator' ? 'other-target' : 'dsh-persona'],
        }
      }
      async propose(input) {
        calls++
        return super.propose(input)
      }
    }
    class Executor extends FixtureExecutor {
      describe() {
        return {
          ...super.describe(),
          targetKinds: [component === 'executor' ? 'other-target' : 'dsh-persona'],
        }
      }
      async execute(input) {
        calls++
        return super.execute(input)
      }
    }
    const { ctx, runs } = await setup(t, {}, { generator: Generator, executor: Executor })
    const before = files(runs)
    const code = `DUO_${component.toUpperCase()}_TARGET_INCOMPATIBLE`
    assert.throws(() => ctx.duoController.plan(), { code })
    assert.equal(calls, 0)
    assert.deepEqual(files(runs), before)
    const error = describeFailure({ code, message: 'Target mismatch' })
    assert.equal(error.costState, 'NO_WORK_DISPATCHED_BY_THIS_CALL')
    assert.equal(error.recoverability, 'CORRECT_INPUT_THEN_REPLAN')
  })
}

test('matching work providers run and advertise target support in the summary plan', async (t) => {
  class Generator extends FixtureGenerator {
    describe() {
      return { ...super.describe(), targetKinds: ['dsh-persona'] }
    }
  }
  class Executor extends FixtureExecutor {
    describe() {
      return { ...super.describe(), targetKinds: ['dsh-persona'] }
    }
  }
  const { ctx } = await setup(t, { generations: 1 }, { generator: Generator, executor: Executor })
  const plan = ctx.duoController.plan()
  const summary = summarizePlan(plan)
  assert.deepEqual(summary.providers.executor.targetKinds, ['dsh-persona'])
  assert.equal(summary.providers.targetCompatibility.status, 'DECLARED_MATCH')
  const result = await ctx.duoController.run({ planDigest: plan.planDigest })
  assert.equal(result.status, 'completed')
})

test('legacy work providers remain usable with target compatibility explicitly unknown', async (t) => {
  const { ctx } = await setup(t)
  const plan = ctx.duoController.plan()
  assert.equal(plan.providers.targetCompatibility.status, 'UNKNOWN')
  assert.equal(plan.providers.targetCompatibility.components.generator.status, 'UNKNOWN')
  assert.equal(plan.providers.targetCompatibility.components.executor.status, 'UNKNOWN')
})

test('evaluation only never inspects an unused generator target declaration', async (t) => {
  class Generator extends FixtureGenerator {
    describe() {
      assert.fail('evaluation only must not inspect a generator')
    }
  }
  class Executor extends FixtureExecutor {
    describe() {
      return { ...super.describe(), targetKinds: ['dsh-persona'] }
    }
  }
  const { ctx } = await setup(
    t,
    {
      operation: 'evaluate',
      generations: 0,
      quotas: { exploit: 0, explore: 0, innovate: 0 },
      slow: null,
      final: null,
    },
    { generator: Generator, executor: Executor },
  )
  const plan = ctx.duoController.plan()
  assert.equal(plan.providers.targetCompatibility.components.generator.status, 'NOT_REQUIRED')
  assert.equal(plan.providers.targetCompatibility.status, 'DECLARED_MATCH')
})

for (const declaration of [[], 'dsh-persona', ['*'], [null]]) {
  test(`invalid executor target declaration is rejected: ${JSON.stringify(declaration)}`, async (t) => {
    class Executor extends FixtureExecutor {
      describe() {
        return { ...super.describe(), targetKinds: declaration }
      }
    }
    const { ctx } = await setup(t, {}, { executor: Executor })
    assert.throws(() => ctx.duoController.plan(), { code: 'DUO_PROVIDER_TARGET_INVALID' })
  })
}
