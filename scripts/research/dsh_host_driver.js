// Test application loaded by the actual DSH CLI. No mock Context/ToolRuntime.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export const name = 'dualloop-host-verification'
export const inject = ['tools', 'appReady', 'appExit']

export function apply(ctx, config) {
  const exit = ctx.appExit
  const records = []
  const checks = []
  const save = (file, value) => writeFileSync(join(config.outputDir, file), JSON.stringify(value, null, 2) + '\n')
  const check = (label, condition) => {
    assert.ok(condition, label)
    checks.push(label)
  }
  let counter = 0
  async function call(name, args = {}, signal = new AbortController().signal) {
    const callId = `host-check-${++counter}`
    const result = await ctx.tools.execute({ callId, name, arguments: args, signal })
    records.push({ callId, name, arguments: args, result })
    save(`${callId}.json`, records.at(-1))
    return result
  }
  function value(result) {
    assert.equal(result.isError, false, JSON.stringify(result.error))
    return typeof result.value === 'string' ? JSON.parse(result.value) : result.value
  }
  async function run() {
    const tools = ctx.tools.schemas().map(tool => tool.name)
    save('tool-schemas.json', ctx.tools.schemas())
    check('four DUO tools registered after actual DSH appReady',
      ['dualloop_discover', 'dualloop_plan', 'dualloop_run', 'dualloop_status'].every(tool => tools.includes(tool)))
    const discovery = value(await call('dualloop_discover'))
    check('discovery returns canonical object and input/output schemas',
      discovery.api_version === 1 && discovery.input_schema && discovery.output_schema)
    const plan = value(await call('dualloop_plan'))
    check('plan returns digest without creating experiment output',
      typeof plan.plan_digest === 'string' && !existsSync(config.runDir))

    if (config.scenario === 'cancellation') {
      const abort = new AbortController()
      const pending = call('dualloop_run', { plan_digest: plan.plan_digest }, abort.signal)
      const marker = join(config.runDir, 'cancel-entered.json')
      let entered = false
      try {
        for (let index = 0; index < 200; index++) {
          if (existsSync(marker)) { entered = true; break }
          await delay(25)
        }
      } finally {
        abort.abort()
      }
      const cancelled = await pending
      check('cancellation reached an executing Python child', entered)
      check('native DSH pipeline reports in-flight ABORTED',
        cancelled.isError === true && cancelled.error?.info?.code === 'ABORTED')
      const { pid } = JSON.parse(readFileSync(marker, 'utf8'))
      let childExited = false
      try { process.kill(pid, 0) } catch (error) { childExited = error.code === 'ESRCH' }
      check('cancelled child exited before tool returned', childExited)
      check('cancellation did not produce a success result', !existsSync(join(config.runDir, 'result.json')))
      const status = value(await call('dualloop_status'))
      check('status identifies the interrupted experiment', status.run_state === 'running_or_interrupted')
      const retry = value(await call('dualloop_run', { plan_digest: plan.plan_digest }))
      check('repeat refuses uncertain execution', retry.error?.code === 'RUN_UNCERTAIN')
    } else {
      const invalid = await call('dualloop_run', { generations: 'invalid' })
      check('DSH validates malformed tool arguments', invalid.isError === true && invalid.error?.info?.code === 'INVALID_ARGS')
      const missingPlan = value(await call('dualloop_run'))
      check('structured core error survives native DSH output validation', missingPlan.error?.code === 'PLAN_CHANGED')
      check('refused requests did not start an experiment', !existsSync(config.runDir))
      const result = value(await call('dualloop_run', { plan_digest: plan.plan_digest }))
      check('real plugin executes Python fixture to completion', result.status === 'completed' && result.conclusion === 'recommend_candidate')
      check('fixture remains zero-cost without efficacy claim', result.cost_usd === 0 && result.improvement_proven === false)
      const status = value(await call('dualloop_status'))
      check('status reads the exact configured run and result',
        status.journal_dir === config.runDir && status.result.plan_digest === result.plan_digest && status.result.run_id === result.run_id)
      const repeated = value(await call('dualloop_run', { plan_digest: plan.plan_digest }))
      check('repeat inspects existing result without reexecution', repeated.reused_artifacts === true)
    }
    save('receipt.json', {
      status: 'PASS', scenario: config.scenario, host: 'actual DSH CLI named profile',
      invocation: 'ctx.tools.execute through native DSH validation/policy/result pipeline',
      model_session: false, evidence_kind: 'fixture', paid_calls: 0, checks,
      tool_calls: records.length,
    })
    console.log(`[dualloop-host-verification] PASS ${checks.length} checks, ${records.length} native tool calls`)
  }
  ctx.effect(() => ctx.appReady.onReady(() => {
    void run().then(() => exit(0), error => {
      save('receipt.json', { status: 'FAIL', checks, error: { name: error.name, message: error.message }, tool_calls: records.length })
      console.error(`[dualloop-host-verification] FAIL ${error.message}`)
      exit(1)
    })
  }))
}
