// Compile consumer code against the shipped declaration exports and actual host.
// No generated files, dependency installation or model work occurs here.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../', import.meta.url))
if (!process.env.DUO_DSH_PACKAGE) throw new Error('Set DUO_DSH_PACKAGE to the installed DSH package')
const host = createRequire(resolve(process.env.DUO_DSH_PACKAGE, 'package.json'))
const cordisRoot = dirname(host.resolve('@deepseek-ai/cordis/package.json'))
const manifest = JSON.parse(readFileSync(resolve(root, 'dsh-plugin/package.json'), 'utf8'))
const cordis = JSON.parse(readFileSync(resolve(cordisRoot, 'package.json'), 'utf8'))
const paths = {
  '@deepseek-ai/cordis': [resolve(cordisRoot, cordis.types)],
  ...Object.fromEntries(Object.entries(manifest.exports)
    .filter(([, target]) => typeof target === 'object' && target.types)
    .map(([key, target]) => [manifest.name + key.slice(1), [resolve(root, 'dsh-plugin', target.types)]])),
}
const program = ts.createProgram([resolve(root, 'tests/types/plugin-contracts.mts')], {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  noEmit: true,
  skipLibCheck: false,
  types: ['node'],
  typeRoots: [resolve(root, 'node_modules/@types')],
  paths,
})
const diagnostics = ts.getPreEmitDiagnostics(program)
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: x => x,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  }))
  process.exitCode = 1
} else console.log('PASS: public declaration exports, typed plugin hooks and invalid-input controls')
