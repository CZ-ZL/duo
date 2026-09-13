// Test-only resolution against an explicitly supplied, already cached DSH installation.
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
const root = process.env.DUO_DSH_PACKAGE
if (!root) throw new Error('DUO_DSH_PACKAGE must name the existing cached DSH package')
const require = createRequire(resolve(root, 'package.json'))
const pluginRequire = createRequire(new URL('../dsh-plugin/package.json', import.meta.url))
export async function resolveHook(specifier, context, nextResolve) {
  if (specifier.startsWith('@dual-loop/dsh-plugin/')) {
    return { url: pathToFileURL(pluginRequire.resolve(specifier)).href, shortCircuit: true }
  }
  if (specifier.startsWith('@deepseek-ai/')) {
    return { url: pathToFileURL(require.resolve(specifier)).href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
export { resolveHook as resolve }
