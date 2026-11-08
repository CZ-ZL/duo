// Read package metadata only. Never load host code, profiles or credentials.
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'

const manifest = JSON.parse(readFileSync(new URL('../host/package.json', import.meta.url), 'utf8'))

export function inspectHost(path) {
  const issues = [],
    packages = []
  const expected = { ...manifest.dependencies, ...manifest.overrides }
  if (process.platform !== 'linux' || Number(process.versions.node.split('.')[0]) < 24)
    issues.push({
      code: 'PLATFORM_UNSUPPORTED',
      expected: 'Linux / Node 24+',
      actual: `${process.platform} / Node ${process.versions.node}`,
    })
  const root = path ? resolve(path) : null
  if (!root || !existsSync(join(root, 'package.json')) || !existsSync(join(root, 'lib/bin.js'))) {
    issues.push({
      code: 'DSH_PACKAGE_UNAVAILABLE',
      expected: 'Installed DSH package containing package.json and lib/bin.js',
    })
  } else {
    const hostRequire = createRequire(join(root, 'package.json'))
    for (const [name, version] of Object.entries(expected)) {
      try {
        const file =
          name === '@deepseek-ai/dsh'
            ? join(root, 'package.json')
            : hostRequire.resolve(name + '/package.json')
        const found = JSON.parse(readFileSync(file, 'utf8'))
        const matches = found.name === name && found.version === version
        packages.push({ package: name, expected: version, actual: found.version ?? null, matches })
        if (!matches)
          issues.push({
            code: 'HOST_VERSION_UNVERIFIED',
            package: name,
            expected: version,
            actual: found.version ?? null,
          })
      } catch {
        packages.push({ package: name, expected: version, actual: null, matches: false })
        issues.push({
          code: 'HOST_DEPENDENCY_UNAVAILABLE',
          package: name,
          expected: version,
          actual: null,
        })
      }
    }
  }
  return {
    status: issues.length ? 'unsupported' : 'compatible',
    platform: process.platform,
    node: process.versions.node,
    packages,
    issues,
    nextAction: issues.length
      ? 'Use the isolated host composition in guides/INSTALL.md. Do not change your existing host or start model work to repair this check.'
      : 'Continue with Quickstart discovery and plan checks in a new workspace.',
    scope:
      'Package versions match the tested host composition; this is not execution, provider-quality or security qualification.',
    modelRequests: 0,
    costCny: 0,
  }
}
