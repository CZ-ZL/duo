// One diagnostic Agent operation using existing native accounting and lifecycle.
// This entry is not an optimizer, Calling Agent acceptance, or production evaluator.
import {readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {modelSettings, runModelAgent} from '@dual-loop/dsh-plugin/model-accounting'
import {LlmAdapter} from '@deepseek-ai/dsh-llm'
export const name = 'duo-semantic-diagnostic'
export const inject = ['agents', 'llm', 'duoBudget', 'duoJournal', 'appReady', 'appExit']
export function apply(ctx, config) {
  const save = (file, value) => writeFileSync(join(config.output, file), JSON.stringify(value, null, 2) + '\n')
  const running = config.offline || process.env.DUO_MODEL_RUN_ENABLED === '1'
  let requests = 0
  ctx.on('llm/stream', (options, next) => {
    if (!running || requests >= 1) throw new Error('Diagnostic admits one request, including retries and nested calls')
    requests++
    save('request-admission.json', {requests, status: 'ADMITTED_UNSETTLED', maxRequests: 1})
    return next()
  })
  if (config.offline) {
    class Fixture extends LlmAdapter {
      async *stream(options) {
        const prompt = JSON.parse(options.messages.filter(m => m.role === 'user').at(-1).content[0].text)
        yield {type: 'text-delta', index: 0, text: JSON.stringify(Object.fromEntries(prompt.items.map(i => [i.id, {passed: false, reason: 'Synthetic transport check only.'}])))}
        if (!config.missingUsage) yield {type: 'usage', usage: {inputTokens: 80, cacheReadTokens: 20, outputTokens: 10, totalTokens: 110}}
        yield {type: 'finish', reason: {kind: 'stop'}}
      }
    }
    ctx.llm.registerAdapter(['duo-offline'], new Fixture())
  }
  async function run() {
    const contract = JSON.parse(readFileSync(config.contractPath, 'utf8'))
    const {config: settings} = modelSettings(config.model)
    if (!running) {save('prepare-receipt.json', {status: 'PREPARED', paidCalls: 0, maxRequests: 1}); return}
    const runId = 'semantic-diagnostic-v1', journal = ctx.duoJournal.open(runId, {create: true})
    journal.claim(contract.id)
    const ledger = ctx.duoBudget.open(runId, {currency: 'CNY', maxCostCny: .15, maxSessions: 1, maxFastEvals: 0, maxSlowEvals: 0})
    const request = {purpose: 'semantic_calibration_only', contractId: contract.id}
    ledger.reserve('diagnostic-1', {phase: 'evaluation', currency: 'CNY', maxCostCny: .15, request})
    journal.append({kind: 'diagnostic_reserved', request})
    const result = await runModelAgent(ctx, settings, {persona: contract.persona, prompt: JSON.stringify(contract.prompt),
      identity: {operation: 'evaluate', evaluatorId: contract.id, purpose: 'diagnostic_only'}})
    ledger.settle('diagnostic-1', result.costCny, 'diagnostic-1:settled', {currency: 'CNY', costEvidence: result.costEvidence})
    save('cost-receipts.json', ledger.receipts()); save('budget.json', ledger.snapshot())
    save('model-result.json', result)
    let answers = null, shapeValid = false
    try {
      answers = JSON.parse(result.artifact.text)
      shapeValid = answers && !Array.isArray(answers) &&
        Object.keys(answers).sort().join() === contract.prompt.items.map(i => i.id).sort().join() &&
        Object.values(answers).every(v => typeof v?.passed === 'boolean' && typeof v?.reason === 'string' && v.reason.trim())
    } catch {}
    const complete = result.artifact.status === 'completed' && result.costCny !== null && shapeValid
    const summary = {status: complete ? 'completed' : 'incomplete', purpose: 'diagnostic_only',
      evidenceKind: config.offline ? 'fixture' : 'real_model_semantic_judgment',
      modelRequests: config.offline ? 0 : requests, syntheticRequests: config.offline ? requests : 0,
      costCny: config.offline ? 0 : result.costCny, syntheticCostCny: config.offline ? result.costCny : null,
      shapeValid, answers, optimizationProven: false, productionEvaluatorQualified: false}
    journal.append({kind: 'diagnostic_result', status: summary.status, receiptPath: result.artifact.receiptPath})
    journal.complete(summary); save('result.json', summary); save('journal.json', {events: journal.events(), result: summary})
    if (ctx.agents.list().length) throw new Error('Owned Agent remained active')
    if (!complete) throw new Error('Diagnostic incomplete; retain reservation/receipt; no automatic retry')
  }
  ctx.effect(() => ctx.appReady.onReady(() => {void run().then(() => ctx.appExit(0), error => {
    save('error.json', {message: error.message, requests, paidCalls: config.offline ? 0 : requests}); ctx.appExit(1)
  })}))
}
