// Prepare a disposable DSH profile from the actual installed package. No work
// is dispatched here; public DSH commands run each caller-selected tool.
import { mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
const { values } = parseArgs({ options: { root: { type: 'string' } } })
if (!values.root) throw new Error('Use --root /absolute/new/decision-work-directory')
const root = resolve(values.root),
  source = fileURLToPath(new URL('../../', import.meta.url))
mkdirSync(root) // refuse an existing workspace; never overwrite its allowance
const profile = join(root, 'dsh-home/profiles/decisions')
mkdirSync(profile, { recursive: true })
// As in the existing product preparer, stage the shipped files inside this
// profile so DSH can resolve its host peers. No dependency installation occurs.
const pkg = join(profile, 'node_modules/@dual-loop/dsh-plugin')
const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
for (const file of ['package.json', ...manifest.files]) {
  mkdirSync(dirname(join(pkg, file)), { recursive: true })
  copyFileSync(join(source, file), join(pkg, file))
}
const write = (path, value) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
write(join(profile, 'package.json'), {
  name: 'duo-decisions-example',
  version: '1.0.0',
  private: true,
  type: 'module',
  dsh: { profile: { bundles: [], patchReload: 'startup' } },
})
write(join(profile, 'cordis.patch.yml'), [
  {
    insert: [
      { id: 'decision-system', name: '@deepseek-ai/dsh-system-prompt' },
      { id: 'decision-tools-runtime', name: '@deepseek-ai/dsh-tools' },
      {
        id: 'decision-journal',
        name: join(pkg, 'native/journal.js'),
        config: { root: join(root, 'journal') },
      },
      { id: 'decision-budget', name: join(pkg, 'native/budget.js') },
      { id: 'decision-provider', name: join(pkg, 'examples/decisions/local-provider.js') },
      { id: 'decision-public-tools', name: join(pkg, 'native/decision-tools.js') },
      {
        id: 'decision-tool-app',
        name: join(pkg, 'examples/product/tool-app.js'),
        config: {
          requestPath: join(root, 'describe-request.json'),
          responsePath: join(root, 'describe-response.json'),
        },
      },
    ],
  },
])
const requests = {
  describe: { tool: 'dualloop_decision_describe', args: {} },
  decide: {
    tool: 'dualloop_decide',
    args: {
      requestId: 'ticket-001',
      state: { message: 'An urgent duplicate charge; please connect me to a person today.' },
      questions: {
        route: {
          type: 'choice',
          instructions: 'Which support queue owns this ticket?',
          criteria: { billing: 'Charges and invoices', general: 'Other issues' },
        },
        urgency: {
          type: 'score',
          instructions: 'How urgent is this request?',
          criteria: ['Routine inquiry', 'Needs attention today'],
        },
        needs_human: {
          type: 'boolean',
          instructions: 'Does the message explicitly request a person?',
        },
      },
    },
  },
  status: { tool: 'dualloop_decision_status', args: { requestId: 'ticket-001' } },
}
for (const [name, request] of Object.entries(requests)) {
  write(join(root, name + '-request.json'), { id: 'example-' + name, ...request })
  write(join(root, name + '.patch.json'), [
    {
      id: 'decision-tool-app',
      config: {
        requestPath: join(root, name + '-request.json'),
        responsePath: join(root, name + '-response.json'),
      },
    },
  ])
}
console.log(
  JSON.stringify({
    status: 'PREPARED',
    root,
    profile: 'decisions',
    package: pkg,
    paid: false,
    modelRequests: 0,
  }),
)
