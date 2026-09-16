#!/usr/bin/env node
// Public example setup and transport only. Every operation executes through
// the installed DSH CLI and DUO ToolRuntime. No research archive or implicit credential access.
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  realpathSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { starterSettings, prepareStarter, starterError } from '../examples/model/prepare.js'
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const write = (p, x) => writeFileSync(p, JSON.stringify(x, null, 2) + '\n', { flag: 'wx' })
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: 'string' },
    'dsh-package': { type: 'string' },
    example: { type: 'string', default: 'optimize' },
    'model-config': { type: 'string' },
    'max-cost-cny': { type: 'string' },
    'allow-paid': { type: 'boolean' },
    tool: { type: 'string' },
    args: { type: 'string', default: '{}' },
    'cancel-after-ms': { type: 'string' },
    help: { type: 'boolean' },
  },
})
const command = positionals[0]
if (values.help || !command) {
  console.log(
    'duo init --root NEW_DIRECTORY --dsh-package EXISTING_DSH_PACKAGE --example evaluate|optimize|dual|byo|replace|warm|setup|custom|grounded-qa\nGrounded QA: --model-config PATH [--allow-paid --max-cost-cny AMOUNT]\nduo call --root DIRECTORY --tool schemas|dualloop_TOOL --args JSON [--cancel-after-ms N] [--allow-paid]\nLocal examples use no model. Grounded QA uses an explicitly authorized model route; see packaged QUICKSTART.md. Preparation alone never spends money.',
  )
  process.exit(0)
}
try {
  if (!values.root) throw new Error('--root is required')
  const root = resolve(values.root)
  if (command === 'init') {
    if (!values['dsh-package'])
      throw new Error('--dsh-package must reference an existing installed DSH package')
    const dsh = realpathSync(values['dsh-package']),
      example = values.example
    if (!existsSync(join(dsh, 'lib/bin.js')))
      throw new Error('DSH lib/bin.js not found; this command never installs dependencies')
    if (
      ![
        'evaluate',
        'optimize',
        'dual',
        'byo',
        'replace',
        'warm',
        'setup',
        'custom',
        'grounded-qa',
      ].includes(example)
    )
      throw new Error('Unsupported example; read --help')
    const live = example === 'grounded-qa'
    const settings = live ? starterSettings(values) : null
    if (!live && (values['model-config'] || values['allow-paid'] || values['max-cost-cny']))
      throw new Error('Model and paid flags apply only to grounded-qa; local examples stay at CNY0')
    mkdirSync(root) // Refuse existing directories instead of overwriting user work.
    const profile = join(root, 'dsh-home/profiles/duo-product')
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
    const installed = join(profile, 'node_modules/@dual-loop/dsh-plugin')
    for (const file of ['package.json', ...manifest.files]) {
      const destination = join(installed, file)
      mkdirSync(dirname(destination), { recursive: true })
      copyFileSync(join(packageRoot, file), destination)
    }
    write(join(profile, 'package.json'), {
      name: 'duo-product-profile',
      version: manifest.version,
      private: true,
      type: 'module',
      dsh: { profile: { bundles: ['@dual-loop/dsh-plugin'], patchReload: 'startup' } },
    })
    writeFileSync(
      join(root, 'target.txt'),
      'You are {{model}} in {{cwd}}.  \nKeep the supplied task constraints.  \n',
      { flag: 'wx' },
    )
    const objective = (tier) => ({
      evaluatorId: 'local-' + tier,
      version: '1',
      dataId: 'local-text-' + tier,
      metric: 'quality',
      direction: 'maximize',
      weights: { quality: 1 },
    })
    const evaluation = example === 'evaluate'
    const spec = {
      version: 1,
      id: 'local-' + example,
      operation: evaluation ? 'evaluate' : 'optimize',
      preset: evaluation ? 'evaluate' : example === 'dual' ? 'optimize-dual' : 'optimize-basic',
      target: {
        kind: example === 'custom' ? 'local-text' : 'dsh-persona',
        path: join(root, 'target.txt'),
      },
      fast: objective('fast'),
      ...(example === 'dual' ? { slow: objective('slow') } : {}),
      constraints: [{ metric: 'safe', op: '==', value: true }],
      epsilon: 0.01,
      minSamples: 1,
      generations: evaluation ? 0 : 2,
      topK: 1,
      quotas: { exploit: evaluation ? 0 : 1, explore: 0, innovate: 0 },
      permissions: { paid: false, network: false, externalSideEffects: false },
      budget: {
        currency: 'CNY',
        maxCostCny: 0,
        maxSessions: 30,
        maxFastEvals: 10,
        maxSlowEvals: 10,
        maxWallTimeMs: 3600000,
      },
    }
    const patches = [
      { id: 'duo-contract', config: { experiment: join(root, 'experiment.json') } },
      { id: 'duo-journal', config: { root: join(root, 'journal') } },
      { id: 'duo-runtime', config: { evaluationOnly: evaluation } },
      ...(example === 'replace'
        ? [
            { id: 'duo-feedback', disabled: true },
            {
              insert: [
                {
                  id: 'local-history',
                  name: '@dual-loop/dsh-plugin/history-feedback',
                  config: { historyOrder: 'recent_failures_first' },
                },
              ],
            },
          ]
        : []),
      ...(example === 'custom' ? [{ id: 'duo-target', disabled: true }] : []),
      {
        insert: [
          { id: 'local-system-prompt', name: '@deepseek-ai/dsh-system-prompt' },
          { id: 'local-tools', name: '@deepseek-ai/dsh-tools' },
          ...(example === 'setup' || live
            ? []
            : [
                {
                  id: 'local-work',
                  name:
                    example === 'custom'
                      ? '@dual-loop/dsh-plugin/examples/custom-target'
                      : '@dual-loop/dsh-plugin/examples/local-providers',
                  config: {
                    generator: !evaluation,
                    evaluators: example !== 'byo',
                    expandedEvidence: example === 'dual',
                  },
                },
              ]),
          ...(example === 'byo'
            ? [{ id: 'local-byo-evaluator', name: '@dual-loop/dsh-plugin/examples/byo-evaluator' }]
            : []),
          {
            id: 'local-tool-app',
            name: '@dual-loop/dsh-plugin/examples/tool-app',
            config: {
              requestPath: join(root, 'request.json'),
              responsePath: join(root, 'response.json'),
            },
          },
        ],
      },
    ]
    const starter = live ? prepareStarter({ packageRoot, root, settings, spec, patches }) : null
    write(join(root, 'experiment.json'), spec)
    // JSON is valid YAML; the profile remains editable using ordinary host tools.
    write(join(profile, 'cordis.patch.yml'), patches)
    write(join(root, 'workspace.json'), {
      version: 1,
      dsh,
      profile: 'duo-product',
      example,
      packageVersion: manifest.version,
      ...(starter ? { starter } : {}),
      limit:
        starter?.limit ??
        'Local example only; DSH and the package were already installed. Private profiles and model credentials are not imported.',
    })
    console.log(
      JSON.stringify({
        state: 'PREPARED',
        root,
        example,
        next: 'duo call --root ' + root + ' --tool dualloop_describe',
        modelRequests: 0,
        costCny: 0,
      }),
    )
  } else if (command === 'call') {
    const state = JSON.parse(readFileSync(join(root, 'workspace.json'), 'utf8'))
    if (!values.tool) throw new Error('--tool is required')
    if (
      state.starter?.kind === 'grounded-qa' &&
      ['dualloop_plan', 'dualloop_run'].includes(values.tool)
    ) {
      const spec = JSON.parse(readFileSync(join(root, 'experiment.json'), 'utf8'))
      if (!spec.permissions?.paid || !spec.permissions?.network || !(spec.budget?.maxCostCny > 0))
        throw starterError(
          'DUO_STARTER_AUTHORIZATION_REQUIRED',
          'The starter contract does not authorize paid network work',
          'Keep using describe/design for preparation. After owner authorization, edit experiment.json permissions.paid/network and budget.maxCostCny to the approved limits, then inspect a new plan. Do not invent a positive allowance.',
        )
    }
    const modelRun = state.starter?.kind === 'grounded-qa' && values.tool === 'dualloop_run'
    if (modelRun && !values['allow-paid'])
      throw starterError(
        'DUO_STARTER_AUTHORIZATION_REQUIRED',
        'This call has no explicit paid-run consent',
        'Inspect the plan and obtain owner authorization, then add --allow-paid to this run call. A digest is not permission.',
      )
    if (modelRun && !process.env.DEEPSEEK_API_KEY)
      throw starterError(
        'DUO_STARTER_CREDENTIAL_REQUIRED',
        'The selected host credential is absent',
        'Supply your authorized DEEPSEEK_API_KEY through the calling environment. Never place the key in the model JSON, profile, command arguments or report.',
      )
    const id = randomUUID(),
      calls = join(root, 'calls')
    mkdirSync(calls, { recursive: true })
    const request = { id, tool: values.tool, args: JSON.parse(values.args) }
    if (values['cancel-after-ms'] !== undefined) {
      const n = Number(values['cancel-after-ms'])
      if (!Number.isSafeInteger(n) || n < 0)
        throw new Error('Cancellation delay must be a nonnegative integer')
      request.cancelAfterMs = n
    }
    const requestPath = join(calls, id + '-request.json'),
      responsePath = join(calls, id + '-response.json')
    write(requestPath, request)
    const patchPath = join(calls, id + '-app.patch.json')
    write(patchPath, [{ id: 'local-tool-app', config: { requestPath, responsePath } }])
    const env = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      DSH_HOME: join(root, 'dsh-home'),
      DSH_TELEMETRY_DISABLED: '1',
      ...(modelRun ? { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY } : {}),
    }
    const result = spawnSync(
      process.execPath,
      [join(state.dsh, 'lib/bin.js'), '--profile', state.profile, '--patch', patchPath],
      {
        cwd: root,
        env,
        encoding: 'utf8',
        timeout: state.starter ? 360000 : 65000,
        maxBuffer: 8 * 1024 * 1024,
      },
    )
    writeFileSync(join(calls, id + '-stdout.log'), result.stdout ?? '', { flag: 'wx' })
    writeFileSync(join(calls, id + '-stderr.log'), result.stderr ?? '', { flag: 'wx' })
    if (!existsSync(responsePath))
      throw new Error(
        'DSH produced no response. Inspect ' +
          join(calls, id + '-stderr.log') +
          '; no automatic retry. ' +
          (result.error?.message ?? ''),
      )
    console.log(readFileSync(responsePath, 'utf8'))
    process.exitCode = result.status ?? 1
  } else throw new Error('Unknown command; use --help')
} catch (error) {
  console.error(
    JSON.stringify({
      error: error.message,
      code: error.code ?? 'DUO_CLI_FAILED',
      cause: error.message,
      nextAction:
        error.nextAction ?? 'Inspect the retained workspace and public guide; no automatic replay.',
      recoverability: error.recoverability ?? 'INSPECT_RETAINED_EVIDENCE',
      costState: error.costState ?? 'UNKNOWN_UNTIL_LEDGER_INSPECTION',
      sideEffectState: error.sideEffectState ?? 'UNKNOWN_UNTIL_EXECUTION_INSPECTION',
      retryable: false,
      action: 'Inspect the retained workspace and public guide; no automatic replay.',
    }),
  )
  process.exitCode = 1
}
