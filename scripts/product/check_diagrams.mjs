import { readdirSync, readFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

// Mermaid sanitizes labels while parsing; supply a DOM without loading scripts
// or external resources. No browser or model is started.
const dom = new JSDOM('')
globalThis.window = dom.window
globalThis.document = dom.window.document
const { default: mermaid } = await import('mermaid')

const root = resolve(import.meta.dirname, '../..')
const excluded = new Set([
  'node_modules',
  '.git',
  '__pycache__',
  '.pytest_cache',
  '.venv',
  'npm-cache',
])
function* markdown(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory() && !excluded.has(entry.name)) yield* markdown(path)
    else if (entry.isFile() && entry.name.endsWith('.md')) yield path
  }
}
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
// A negative control ensures this invokes the parser rather than counting fences.
await assert.rejects(() => mermaid.parse('flowchart LR\n A[unfinished'))
let diagrams = 0
for (const file of markdown(root)) {
  for (const match of readFileSync(file, 'utf8').matchAll(/^```mermaid\s*\n([\s\S]*?)^```/gm)) {
    try {
      await mermaid.parse(match[1])
      diagrams++
    } catch (error) {
      throw new Error(`${relative(root, file)}: invalid Mermaid: ${error.message}`)
    }
  }
}
assert.ok(diagrams > 0, 'Expected repository diagrams')
console.log(
  JSON.stringify({
    status: 'PASS',
    diagrams,
    negativeControl: 'PASS',
    scope: 'Syntax parsing; visual readability is reviewed separately',
  }),
)
