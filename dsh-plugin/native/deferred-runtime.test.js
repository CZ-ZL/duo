import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import Agents from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import * as Deferred from './deferred-runtime.js'
import * as Onboarding from './onboarding.js'
const tick = () => new Promise((resolve) => setImmediate(resolve))
for (const evaluationOnly of [false, true])
  test(`deferred runtime activates and retracts existing tools with late evaluator (evaluationOnly=${evaluationOnly})`, async (t) => {
    const ctx = new Context(),
      fibers = []
    t.after(async () => {
      for (const f of fibers.reverse()) await f.dispose()
    })
    for (const P of [Agents, SystemPrompt, Tools, Onboarding]) fibers.push(await ctx.plugin(P))
    const describe = async () => {
      const r = await ctx.tools.execute({
        name: 'dualloop_describe',
        arguments: {},
        callId: 'readiness',
        signal: new AbortController().signal,
      })
      assert.equal(r.isError, false)
      return r.value.runtimeAvailability
    }
    // These are registration-only seam sentinels; no protocol work is invoked.
    fibers.push(
      await ctx.plugin({
        name: 'inert-provider-dependencies',
        apply(c) {
          for (const key of [
            'duoContract',
            'duoTarget',
            'duoComparator',
            'duoGate',
            'duoFeedback',
            'duoJournal',
            'duoBudget',
            'duoExecutor',
            ...(evaluationOnly ? [] : ['duoGenerator']),
          ])
            c.provide(key, {})
        },
      }),
    )
    fibers.push(await ctx.plugin(Deferred, { evaluationOnly }))
    await tick()
    assert.equal(ctx.get('duoController'), undefined)
    assert.ok(!ctx.tools.schemas().some((s) => s.name === 'dualloop_run'))
    const pending = await describe()
    assert.equal(pending.services.duoExecutor, 'PRESENT')
    assert.equal(pending.services.duoEvaluators, 'ABSENT')
    assert.equal(pending.services.duoController, 'ABSENT')
    const provider = await ctx.plugin({
      name: 'late-evaluator-sentinel',
      apply(c) {
        c.provide('duoEvaluators', {})
      },
    })
    fibers.push(provider)
    for (let n = 0; n < 10 && !ctx.tools.schemas().some((s) => s.name === 'dualloop_report'); n++)
      await tick()
    assert.ok(ctx.tools.schemas().some((s) => s.name === 'dualloop_run'))
    assert.ok(ctx.tools.schemas().some((s) => s.name === 'dualloop_report'))
    assert.equal((await describe()).services.duoController, 'PRESENT')
    if (evaluationOnly) assert.equal(ctx.get('duoGenerator'), undefined)
    await provider.dispose()
    await tick()
    assert.equal(ctx.get('duoController'), undefined)
    assert.ok(!ctx.tools.schemas().some((s) => s.name === 'dualloop_run'))
    assert.equal((await describe()).services.duoController, 'ABSENT')
  })
