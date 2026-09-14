import { EvaluatorsService, fail } from './definitions.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { readDataset } from './model-call.js'
import { digest } from './store.js'
import { moneyFields } from './money.js'
const normalized = (path) =>
  path
    .trim()
    .replaceAll('\\', '/')
    .replace(/^.*\/docs\//, '')
    .replace(/^(?:(?:\.\/)|(?:docs\/)|\/)+/g, '')
    .toLowerCase()

// The existing docs_qa SPEC v2 content/citation rule, on supplied document context.
export function judgeDocsAnswer(expected, response) {
  if (
    !response ||
    typeof response.answer !== 'string' ||
    !Array.isArray(response.citations) ||
    response.citations.some((c) => typeof c !== 'string')
  )
    return { passed: false, grounded: false, reason: 'invalid_answer_shape' }
  const text = response.answer,
    low = text.replaceAll(expected.question, '').toLowerCase(),
    files = new Set(response.citations.map(normalized))
  const missingFiles = expected.goldFiles.filter((f) => !files.has(normalized(f)))
  const grounded = [...files].every((f) => expected.allowedFiles.map(normalized).includes(f))
  let content,
    forbidden = []
  if (expected.type === 'abstention') {
    const withoutQuestion = text.replaceAll(expected.question, '')
    content = expected.acceptanceCues.some((c) => new RegExp(c, 'i').test(withoutQuestion))
    let stripped = withoutQuestion
    for (const term of expected.forbiddenKeys ?? []) {
      const bare = term.replace(/^["']|["']$/g, '')
      for (const q of ['`', "'"])
        stripped = stripped.replaceAll(q + bare + q, '').replaceAll(q + term + q, '')
    }
    forbidden = (expected.forbiddenKeys ?? []).filter((k) =>
      stripped.toLowerCase().includes(k.toLowerCase()),
    )
  } else content = expected.answerKeys.every((k) => low.includes(k.toLowerCase()))
  return {
    passed: content && missingFiles.length === 0 && forbidden.length === 0,
    grounded,
    missingFiles,
    forbidden,
  }
}

export default class DocsEvaluators extends EvaluatorsService {
  constructor(ctx, config) {
    super(ctx)
    this.money = moneyFields(config)
    this.dataset = readDataset(config.datasetPath)
    this.datasetDigest = digest(this.dataset)
    this.root = resolve(config.artifactRoot)
    this.kind = config.evidenceKind
    if (!['fixture', 'model'].includes(this.kind))
      fail('DUO_DATA_INVALID', 'Evaluator must label fixture or model evidence')
    if (!['fast', 'slow', 'final'].every((t) => Array.isArray(this.dataset[t]?.tasks)))
      fail('DUO_DATA_INVALID', 'The docs-QA provider requires fast, slow and final splits')
    for (const tier of ['fast', 'slow', 'final'])
      for (const task of this.dataset[tier].tasks) {
        const e = task.expected
        const strings = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim())
        const answers = e?.type === 'abstention' ? e?.acceptanceCues : e?.answerKeys
        if (
          !e ||
          typeof e.question !== 'string' ||
          !e.question.trim() ||
          !['single_fact', 'synthesis', 'citation_strict', 'abstention'].includes(e.type) ||
          !['goldFiles', 'allowedFiles'].every((k) => strings(e[k])) ||
          !strings(answers) ||
          !answers.length ||
          !strings(e.forbiddenKeys ?? []) ||
          !e.goldFiles.every((f) => e.allowedFiles.map(normalized).includes(normalized(f)))
        )
          fail(
            'DUO_DATA_INVALID',
            'Every docs-QA task needs a complete frozen content/citation judge',
          )
        if (e.type === 'abstention')
          for (const regex of e.acceptanceCues)
            try {
              new RegExp(regex, 'i')
            } catch {
              fail('DUO_DATA_INVALID', 'Invalid frozen abstention acceptance expression')
            }
      }
  }
  describe() {
    return ['fast', 'slow', 'final'].map((tier) => ({
      id: 'native-docs-qa-' + tier,
      version: '1',
      tier,
      dataId: this.dataset[tier].id,
      datasetDigest: this.datasetDigest,
      metrics: ['quality', 'grounded', 'sample_size'],
      currency: this.money.currency,
      [this.money.reservation]: 0,
      permissions: { paid: false, network: false, externalSideEffects: false },
      evidenceKind: this.kind,
      artifactRoot: this.root,
    }))
  }
  async evaluate({ candidate, artifact, tier }) {
    const d = this.describe().find((d) => d.tier === tier)
    if (!d) fail('DUO_DATA_INVALID', 'Unknown evaluator tier')
    let ok = false,
      rows = [],
      error = null
    try {
      if (
        artifact?.status !== 'completed' ||
        artifact.candidateId !== candidate.id ||
        artifact.candidateVersion !== candidate.version ||
        artifact.tier !== tier ||
        artifact.dataId !== d.dataId ||
        artifact.datasetDigest !== this.datasetDigest
      )
        throw new Error('identity')
      const answers = JSON.parse(artifact.text),
        tasks = this.dataset[tier].tasks
      if (
        !answers ||
        Array.isArray(answers) ||
        typeof answers !== 'object' ||
        Object.keys(answers).sort().join(',') !==
          tasks
            .map((t) => t.id)
            .sort()
            .join(',')
      )
        throw new Error('shape')
      rows = tasks.map((t) => ({ taskId: t.id, ...judgeDocsAnswer(t.expected, answers[t.id]) }))
      ok = true
    } catch {
      error = {
        code: 'DUO_EVIDENCE_INVALID',
        component: 'duoEvaluators',
        retryable: false,
        nextAction:
          'Inspect candidate session output, frozen split identities and remaining budget; do not replay blindly',
      }
    }
    const path = join(this.root, 'judgment-' + randomUUID() + '.json'),
      metrics = {
        quality: ok ? rows.filter((r) => r.passed).length / rows.length : 0,
        grounded: ok && rows.every((r) => r.grounded),
        sample_size: ok ? rows.length : 0,
      }
    const evidence = {
      kind: this.kind === 'model' ? 'model_output_programmatic_judgment' : 'fixture',
      sessionReceipt: artifact?.receiptPath ?? null,
      judgmentPath: path,
      datasetDigest: this.datasetDigest,
    }
    const result = {
      candidateId: candidate.id,
      evaluatorId: d.id,
      version: d.version,
      dataId: d.dataId,
      tier,
      ok,
      metrics,
      currency: this.money.currency,
      [this.money.cost]: 0,
      error,
      evidence: [evidence],
    }
    try {
      mkdirSync(this.root, { recursive: true })
      writeFileSync(path, JSON.stringify({ ...result, rows }, null, 2) + '\n', { flag: 'wx' })
    } catch {
      evidence.judgmentPath = null
      result.ok = false
      result.metrics = { quality: 0, grounded: false, sample_size: 0 }
      result.error = {
        code: 'DUO_RECEIPT_WRITE_FAILED',
        component: 'duoEvaluators',
        retryable: false,
        nextAction:
          'Check artifactRoot permissions and free space before evaluating again; the measurement was not persisted',
      }
    }
    return result
  }
}
