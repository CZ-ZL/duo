// Public starter assembly only; existing DUO services own execution and money.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export function starterError(code, message, nextAction) {
  return Object.assign(new Error(message), {
    code,
    nextAction,
    recoverability: 'CORRECT_INPUT_THEN_REPLAN',
    costState: 'NO_WORK_DISPATCHED_BY_THIS_CALL',
    sideEffectState: 'NO_WORK_DISPATCHED_BY_THIS_CALL',
  })
}

export function starterSettings(values) {
  const refuse = (message) => {
    throw starterError(
      'DUO_STARTER_MODEL_UNSUPPORTED',
      message,
      'Use the shipped model.example.json for the supported DeepSeek route; keep credentials in DEEPSEEK_API_KEY, not JSON. See QUICKSTART.md.',
    )
  }
  if (!values['model-config']) refuse('A caller-owned --model-config JSON file is required')
  let model
  try {
    model = JSON.parse(readFileSync(resolve(values['model-config']), 'utf8'))
  } catch {
    refuse('Model configuration must be readable JSON')
  }
  if (
    !model ||
    Array.isArray(model) ||
    Object.keys(model).some((k) => !['provider', 'model', 'pricing'].includes(k)) ||
    model.provider !== 'deepseek-official' ||
    model.model !== 'deepseek-flash'
  )
    refuse(
      'This starter supports deepseek-official / deepseek-flash only; advanced routes use the Provider guide',
    )
  const pricing = model.pricing
  if (
    !pricing ||
    Object.keys(pricing).some(
      (k) =>
        ![
          'id',
          'currency',
          'inputCnyPerMillion',
          'cacheReadCnyPerMillion',
          'outputCnyPerMillion',
          'schedule',
          'source',
          'verifiedDate',
        ].includes(k),
    ) ||
    pricing.currency !== 'CNY' ||
    typeof pricing.id !== 'string' ||
    !pricing.id ||
    !['inputCnyPerMillion', 'cacheReadCnyPerMillion', 'outputCnyPerMillion'].every(
      (k) => Number.isFinite(pricing[k]) && pricing[k] >= 0,
    ) ||
    pricing.schedule !== 'deepseek-weekday-utc-v1' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(pricing.verifiedDate ?? '')
  )
    refuse('Supply a frozen CNY tariff, its verification date, and the supported schedule')
  const reservationCny =
    Math.ceil(
      (((32768 + 4096) * Math.max(pricing.inputCnyPerMillion, pricing.cacheReadCnyPerMillion) +
        2048 * pricing.outputCnyPerMillion) /
        1e6) *
        100,
    ) / 100
  if (!(reservationCny > 0))
    refuse('A nonzero model tariff is required; no synthetic free-model pricing')
  const maxCostCny = values['max-cost-cny'] === undefined ? 0 : Number(values['max-cost-cny'])
  if (
    !Number.isFinite(maxCostCny) ||
    maxCostCny < 0 ||
    (!values['allow-paid'] && maxCostCny !== 0) ||
    (values['allow-paid'] && maxCostCny < 3 * reservationCny)
  )
    throw starterError(
      'DUO_STARTER_AUTHORIZATION_REQUIRED',
      'Paid preparation needs --allow-paid and an authorized cap covering at most three bounded requests',
      `Obtain owner authorization before setting --allow-paid --max-cost-cny AMOUNT (minimum reservation envelope ${3 * reservationCny} CNY). Without authority omit both flags; preparation remains blocked for paid work.`,
    )
  return { ...model, reservationCny, maxCostCny, paid: Boolean(values['allow-paid']) }
}

export function prepareStarter({ packageRoot, root, settings, spec, patches }) {
  const source = join(packageRoot, 'examples/model')
  for (const file of ['target.txt', 'runbook.md', 'tasks.json'])
    copyFileSync(join(source, file), join(root, file))
  const tasks = JSON.parse(readFileSync(join(root, 'tasks.json'), 'utf8'))
  const runbook = readFileSync(join(root, 'runbook.md'), 'utf8')
  const dataset = {
    version: 1,
    responseMode: 'docs-citations-v1',
    responseInstructions:
      'Answer each question with the exact command, endpoint, or value requested. Use only its supplied runbook. If the answer is not in the runbook, answer exactly NOT_IN_RUNBOOK and give no citations. Return JSON mapping each task id to {"answer":"...","citations":["runbook.md"]}.',
    fast: {
      id: tasks.id,
      purpose: tasks.purpose,
      tasks: tasks.tasks.map((t) => ({
        id: t.id,
        input: `Question: ${t.question}\nSOURCE: runbook.md (lines 1-${runbook.split('\n').length})\n${runbook}`,
        expected: {
          answer: t.answer,
          citations: t.answer === 'NOT_IN_RUNBOOK' ? [] : ['runbook.md'],
        },
      })),
    },
  }
  writeFileSync(join(root, 'dataset.json'), JSON.stringify(dataset, null, 2) + '\n', { flag: 'wx' })
  spec.id = 'grounded-qa-starter'
  spec.fast = {
    evaluatorId: 'starter-runbook-fast',
    version: '1',
    dataId: tasks.id,
    metric: 'task_accuracy',
    direction: 'maximize',
    weights: { task_accuracy: 1 },
  }
  spec.constraints = []
  spec.minSamples = tasks.tasks.length
  spec.generations = 1
  spec.permissions = { paid: settings.paid, network: settings.paid, externalSideEffects: false }
  spec.budget = {
    currency: 'CNY',
    maxCostCny: settings.maxCostCny,
    maxSessions: 5,
    maxFastEvals: 2,
    maxSlowEvals: 0,
    maxWallTimeMs: 600000,
  }
  const config = {
    provider: settings.provider,
    model: settings.model,
    datasetPath: join(root, 'dataset.json'),
    artifactRoot: join(root, 'sessions'),
    evidenceKind: 'model',
    maxTokens: 2048,
    maxInputBytes: 32768,
    timeoutMs: 90000,
    currency: 'CNY',
    reservationCny: settings.reservationCny,
    pricing: settings.pricing,
  }
  const entries = patches.find((r) => r.insert)?.insert
  const system = entries.find((r) => r.id === 'local-system-prompt')
  system.config = { includeHarnessIdentity: false, includeRuntimeContext: false }
  entries.push(
    ...['agent', 'session', 'session-projection', 'llm', 'agent-loop'].map((n) => ({
      id: 'starter-' + n,
      name: '@deepseek-ai/dsh-' + n,
      ...(n === 'agent-loop' ? { config: { agents: [] } } : {}),
    })),
    { id: 'starter-deepseek-extensions', name: '@deepseek-ai/dsh-deepseek-llm-api-extensions' },
    {
      id: 'starter-json',
      name: '@dual-loop/dsh-plugin/json-output',
      config: { artifactRoot: join(root, 'request-formats') },
    },
    {
      id: 'starter-deepseek',
      name: '@deepseek-ai/dsh-llm-deepseek',
      config: {
        apiKeyEnv: 'DEEPSEEK_API_KEY',
        thinking: 'disabled',
        maxTokens: config.maxTokens,
        retryPolicy: { mode: 'normal', maxRetries: 0 },
      },
    },
    { id: 'starter-generator', name: '@dual-loop/dsh-plugin/model-generator', config },
    { id: 'starter-executor', name: '@dual-loop/dsh-plugin/model-executor', config },
    {
      id: 'starter-evaluator',
      name: '@dual-loop/dsh-plugin/examples/grounded-qa-evaluator',
      config,
    },
  )
  return {
    kind: 'grounded-qa',
    credentialEnv: 'DEEPSEEK_API_KEY',
    maxModelRequests: 3,
    paidPreparation: settings.paid,
    limit:
      'One generation, one candidate, development evidence only; no final or automatic adoption. Caller host costs are separate.',
  }
}
