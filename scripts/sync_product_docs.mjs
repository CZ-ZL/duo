// Generate current capabilities from the same catalog used by public discovery.
// --check never writes. Historical results are not inputs to current support.
import { readFileSync, writeFileSync } from 'node:fs'
import { productCapabilities } from '../dsh-plugin/native/capabilities.js'
const root = new URL('../', import.meta.url),
  read = (p) => readFileSync(new URL(p, root), 'utf8')
const manifest = JSON.parse(read('dsh-plugin/package.json')),
  cap = productCapabilities()
const text = `# DUO ${manifest.version} — current product support

DUO is a DSH-native component for bounded evaluation and optimization. The default bundle exposes preparation and waits for work providers; it does not wire a research fixture or authorize model spending.

This page is generated from native/capabilities.js and package.json. Run scripts/sync_product_docs.mjs after an intentional support change. Public discovery uses the same catalog. PRODUCT_ACCEPTANCE.json retains the sealed 0.5.0 receipt; current acceptance evidence is recorded in docs/slow-evidence-strategy/QUEUE.md; historical experiment reports do not define current support.

| Target | Support | Mutable space | Warm start | Execution |
|---|---|---|---|---|
${cap.targets.map((t) => `| ${t.kind} | ${t.support} | ${t.mutable} | ${t.lifecycle.warmStart ? 'Adapter validation and safe Delta projection' : 'Not supported'} | ${t.lifecycle.execution} |`).join('\n')}

${cap.targets.map((t) => `- **${t.kind}:** ${t.limits.join(' ')}`).join('\n')}

Custom targets use the existing TargetService and their own identity, validation and Delta projection. The active adapter advertises its targetKinds; adding a custom kind does not require a core edit. A legacy adapter without history hooks does not gain warm-start support.

Replaceable components: ${cap.components.map((c) => `${c.role} (${c.service})`).join('; ')}. Cordis owns registration, dependency injection and disposal. No new DUO registry/runtime is required.

Default public flow: describe → design (evaluate / optimize-basic / optimize-dual / optimize-auto preset) → save an inspected contract → plan → authorized run → status/report. Advanced use adds screened warm history or replaces a provider in the profile. See AGENT_GUIDE.md and examples/product/README.md in the package.

Slow modes: ${cap.evidenceModes.join(', ')}. Read EVIDENCE_STRATEGY.md for negotiated information increment and actual acquisition receipts. No price/model-based fidelity inference or silent downgrade.

Supported environment: ${cap.platform}. Public TypeScript declarations and supported strategy hooks are compiled in the product gate. Windows/macOS are not currently verified. The text-hygiene example measures actual local text, not the behavior of an LLM Agent. Config execution requires a compatible executor; the persona executor is not a config executor.

${cap.boundaries.map((b) => '- ' + b).join('\n')}

Research is paused for this product release: no new benchmark, single-loop comparison, Graph/Bayesian, weak-to-strong, Generator/Slow research or additional loops. Historical method evidence has not established a general DUO quality/cost advantage.
`
for (const p of ['CURRENT_STATUS.md', 'dsh-plugin/CURRENT_STATUS.md']) {
  if (process.argv.includes('--check')) {
    if (read(p) !== text) throw new Error(p + ' is stale; run node scripts/sync_product_docs.mjs')
  } else writeFileSync(new URL(p, root), text)
}
for (const name of ['AGENT_GUIDE.md', 'AGENT_REFERENCE.md']) {
  if (process.argv.includes('--check')) {
    if (read(name) !== read('dsh-plugin/' + name)) throw new Error(name + ' shipped copy drifted')
  } else writeFileSync(new URL('dsh-plugin/' + name, root), read(name))
}
