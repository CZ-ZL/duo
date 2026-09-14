import { dirname, resolve } from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import { defineTool, TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { runCore as callCore } from './core-bridge.js'

export const name = 'dual-loop'

// `tools` comes from dsh-base; the plugin stays PENDING (never wrongly
// active) in a composition without it.
export const inject = ['tools']

export const Config = Schema.object({
  // Objective-contract / experiment YAML the `run` tool executes.
  experiment: Schema.string()
    .required()
    .description('Absolute path to the dualloop experiment YAML (objective contract).'),
  // Directory containing the `dualloop` Python package (repo root) when it is
  // not pip-installed; used as the child process cwd.
  coreDir: Schema.string().description(
    'Absolute path of the dualloop repo root (child-process cwd). Omit if dualloop is pip-installed.',
  ),
  python: Schema.string()
    .default('python3')
    .description('Python executable used to launch the protocol core.'),
  journalDir: Schema.string().description(
    'Journal root for `status`. Defaults to <experiment dir>/journal, matching the core CLI.',
  ),
  runTimeoutMs: Schema.number()
    .default(30 * 60 * 1000)
    .description('Wall-clock cap for one `dualloop_run` call.'),
})

export function apply(ctx, config) {
  const coreDir = config.coreDir ? resolve(config.coreDir) : undefined
  const experiment = resolve(config.experiment)
  const journalDir = config.journalDir
    ? resolve(config.journalDir)
    : resolve(dirname(experiment), 'journal')

  async function runCore(args, { signal, timeoutMs }) {
    try {
      return await callCore(config.python, coreDir, args, { signal, timeoutMs })
    } catch (error) {
      // Node's AbortError is not a HarnessError, so the host would retain only
      // its message. Preserve native cancellation identity after child cleanup.
      if (signal?.aborted && error.code === 'ABORT_ERR') {
        throw new HarnessError('DualLoop execution was cancelled', TOOL_ABORTED)
      }
      throw error
    }
  }

  for (const [tool, args, description] of [
    [
      'dualloop_discover',
      ['discover'],
      'Discover implemented DualLoop capabilities, contracts, permissions and limitations. No experiment execution.',
    ],
    [
      'dualloop_plan',
      ['plan', '--experiment', experiment, '--journal-dir', journalDir],
      'Inspect the configured Agent-native target snapshot, evaluator evidence, budget and plan_digest before execution. Does not load the caller adapter.',
    ],
  ]) {
    ctx.tools.register(
      defineTool({
        name: tool,
        description,
        parameters: {},
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        },
        isConcurrencySafe: () => true,
        async execute(_args, exec) {
          const { stdout } = await runCore(args, { signal: exec.signal, timeoutMs: 60_000 })
          return JSON.parse(stdout)
        },
      }),
    )
  }

  ctx.tools.register(
    defineTool({
      name: 'dualloop_status',
      description:
        'Read the DualLoop experiment journal and return a JSON status summary: ' +
        'candidate states, champion, promotion/slow decisions, and journal size. ' +
        'Read-only; never starts an experiment.',
      parameters: {},
      output: {
        schema: { type: 'string', description: 'JSON status summary of the journal' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        const { stdout } = await runCore(['status', '--journal-dir', journalDir], {
          signal: exec.signal,
          timeoutMs: 60_000,
        })
        // Validate the core actually answered with its JSON contract before
        // handing the text to the model (fail loud on e.g. a traceback).
        JSON.parse(stdout)
        return stdout
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'dualloop_run',
      description:
        'Run the DualLoop dual-loop experiment protocol against the configured ' +
        'objective contract, then return the run summary. This executes the full ' +
        'generate → fast-evaluate → promote → slow-evaluate → feedback loop and ' +
        'can consume real evaluation budget in legacy mode. Use existing host authorization. ' +
        'For Agent-native contracts first inspect dualloop_plan and supply its plan_digest.',
      parameters: {
        generations: {
          type: 'number',
          description:
            'Override the number of fast-loop generations (default: experiment file value).',
        },
        plan_digest: {
          type: 'string',
          description: 'Digest from dualloop_plan, required for Agent-native runs.',
        },
      },
      output: {
        schema: {
          type: 'string',
          description: 'Human-readable run summary from the protocol core',
        },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      timeoutMs: config.runTimeoutMs,
      async execute(args, exec) {
        const cliArgs = ['run', '--experiment', experiment, '--journal-dir', journalDir]
        if (args.generations !== undefined) cliArgs.push('--generations', String(args.generations))
        if (args.plan_digest !== undefined) cliArgs.push('--plan-digest', args.plan_digest)
        const { stdout } = await runCore(cliArgs, {
          signal: exec.signal,
          timeoutMs: config.runTimeoutMs,
        })
        return stdout
      },
    }),
  )

  console.log(`[dual-loop] plugin loaded (experiment: ${experiment}, journal: ${journalDir})`)
}
