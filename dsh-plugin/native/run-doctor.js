// Run doctor: post-hoc and pre-live diagnosis of a duo experiment run directory.
// Reads only on-disk artifacts (evaluation JSON, score JSON, journal, protocol,
// ledger); never dispatches model work, never rewrites scores, never authorizes
// retry. Complements native/diagnostics.js (runtime failure vocabulary) with
// artifact-level signal: it answers "is the metric lying, and is there any
// effect here to optimize?" before more budget is spent.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

const SHAPE_REASONS =
  /^ROW_NOT_OBJECT$|^ROW_KEYS:|^ANSWER_NOT_STRING$|^ANSWER_PADDED$|^ANSWER_NOT_LETTER$/
const LETTERS = ['A', 'B', 'C', 'D']

// Lenient content extraction at the behavior layer: both the frozen nested
// shape {"id":{"answer":"C"}} and the drifting flat shape {"id":"C"} count.
export function extractLetters(text) {
  let parsed
  try {
    parsed = JSON.parse(String(text))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const out = {}
  for (const [id, value] of Object.entries(parsed)) {
    const letter =
      value && typeof value === 'object' && !Array.isArray(value)
        ? value.answer
        : typeof value === 'string'
          ? value
          : null
    if (typeof letter === 'string' && LETTERS.includes(letter.trim())) out[id] = letter.trim()
  }
  return out
}

// Strict shape compliance per the frozen judge contract (pre-repair text).
export function strictCompliant(text, expectedIds) {
  return strictRowFailures(text, expectedIds).shapeFails === 0
}

// Row-level shape failure count against the frozen contract, on any text
// (pre- or post-repair). Standalone re-implementation of the run judge's
// shape discipline so the doctor never depends on a package's judge file.
export function strictRowFailures(text, expectedIds) {
  let parsed
  try {
    parsed = JSON.parse(String(text))
  } catch {
    return { shapeFails: expectedIds.length, total: expectedIds.length }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return { shapeFails: expectedIds.length, total: expectedIds.length }
  const fails = expectedIds.filter((id) => {
    const row = parsed[id]
    if (row === null || typeof row !== 'object' || Array.isArray(row)) return true
    const keys = Object.keys(row).sort()
    if (keys.join(',') !== 'answer') return true
    return !(
      typeof row.answer === 'string' &&
      row.answer === row.answer.trim() &&
      LETTERS.includes(row.answer)
    )
  }).length
  return { shapeFails: fails, total: expectedIds.length }
}

function classifyScore(score) {
  const rows = score?.rows ?? []
  const tally = { ok: 0, wrong_letter: 0, shape: 0, total: rows.length }
  for (const row of rows) {
    if (row.reason === 'EXACT') tally.ok++
    else if (row.reason === 'WRONG_LETTER') tally.wrong_letter++
    else if (SHAPE_REASONS.test(row.reason ?? '')) tally.shape++
  }
  if (score && score.status && score.status !== 'SCORED') tally.parse = 1
  return tally
}

function tallyHistogram(h) {
  if (!h) return null
  if (Array.isArray(h.rows)) {
    if (h.status && h.status !== 'SCORED') return h.rows.length || 1
    return h.rows.filter((r) => SHAPE_REASONS.test(r.reason ?? '')).length
  }
  if (h.reasons && typeof h.reasons === 'object') {
    let shape = 0,
      total = 0
    for (const [reason, n] of Object.entries(h.reasons)) {
      total += n
      if (SHAPE_REASONS.test(reason)) shape += n
    }
    return h.status && h.status !== 'SCORED' ? total || 1 : shape
  }
  return null
}

function goldMap(tiers) {
  const out = {}
  for (const tasks of Object.values(tiers?.tiers ?? {})) {
    for (const t of tasks) out[t.id] = t.gold_letter
  }
  return out
}

function collectEvaluations(runDir, { includeOffline = false } = {}) {
  const evals = []
  for (const name of readdirSync(runDir)) {
    if (!/^(actual)-/.test(name) && !(includeOffline && /^offline-/.test(name))) continue
    const armDir = join(runDir, name)
    let files = []
    try {
      files = readdirSync(armDir)
    } catch {
      continue
    }
    for (const file of files) {
      if (!/^duo-.*\.json$/.test(file) || file.endsWith('-score.json')) continue
      const record = readJson(join(armDir, file))
      const artifact = record?.artifact
      if (!artifact?.text) continue
      const score = readJson(join(armDir, file.replace(/\.json$/, '-score.json')))
      const effective =
        artifact.repaired && artifact.repairText ? artifact.repairText : artifact.text
      evals.push({
        arm: name,
        file: join(armDir, file),
        tier: artifact.tier ?? null,
        candidateId: artifact.candidateId ?? null,
        dose: artifact.config?.maxBodyChars ?? null,
        text: artifact.text,
        effective,
        repaired: Boolean(artifact.repaired),
        firstHistogram: artifact.firstScoreHistogram ?? null,
        score,
        costCny: record.costCny ?? null,
      })
    }
  }
  return evals
}

const bucketOf = (dose) =>
  dose == null
    ? null
    : dose < 20000
      ? '[5000,20000)'
      : dose < 50000
        ? '[20000,50000)'
        : dose < 100000
          ? '[50000,100000)'
          : '[100000,200000]'

function spearman(xs, ys) {
  const n = xs.length
  if (n < 3) return null
  const rank = (values) => {
    const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])
    const r = new Array(n)
    for (let start = 0; start < n; ) {
      let end = start + 1
      while (end < n && order[end][0] === order[start][0]) end++
      const average = (start + end - 1) / 2
      for (let k = start; k < end; k++) r[order[k][1]] = average
      start = end
    }
    return r
  }
  const rx = rank(xs),
    ry = rank(ys)
  const mx = rx.reduce((a, b) => a + b, 0) / n,
    my = ry.reduce((a, b) => a + b, 0) / n
  let num = 0,
    dx = 0,
    dy = 0
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my)
    dx += (rx[i] - mx) ** 2
    dy += (ry[i] - my) ** 2
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : null
}

// Minimal detectable effect (two-sided alpha=.05, power=.80, normal approx).
export function mde(pp, nPerArm) {
  if (!nPerArm || nPerArm <= 0) return null
  const p = Math.min(Math.max(pp ?? 0.8, 0.05), 0.95)
  return 2.8 * Math.sqrt((2 * p * (1 - p)) / nPerArm)
}

export async function analyzeRun(runDir, options = {}) {
  const protocol = readJson(join(runDir, 'PROTOCOL.json'))
  const tiers = readJson(join(runDir, 'data', 'tiers.json'))
  const gold = goldMap(tiers)
  const evals = collectEvaluations(runDir, { includeOffline: options.includeOffline === true })
  const baselineDose = protocol?.configRange?.baseline ?? options.baselineDose ?? null
  const checks = []
  const add = (id, severity, verdict, evidence, action) =>
    checks.push({ id, severity, verdict, evidence, action })

  // Per-evaluation behavior-layer rows.
  const rows = evals.map((e) => {
    const letters = extractLetters(e.effective)
    const ids = Object.keys(letters ?? {})
    let correct = 0
    for (const id of ids) if (letters[id] === gold[id]) correct++
    const expectedIds = e.score?.rows?.map((r) => r.id) ?? ids
    const tally = classifyScore(e.score)
    // Original-text shape failures: repaired runs overwrite artifact.text with
    // the repaired output, so prefer the recorded first-attempt histogram.
    const histFails = tallyHistogram(e.firstHistogram)
    const textFails = strictRowFailures(e.text, expectedIds).shapeFails
    const strictFails = histFails ?? textFails
    return {
      arm: e.arm,
      tier: e.tier,
      candidateId: e.candidateId,
      dose: e.dose,
      bucket: bucketOf(e.dose),
      contentAccuracy: ids.length ? correct / ids.length : null,
      contentCorrect: correct,
      n: ids.length,
      strictCompliant: strictFails === 0,
      strictFails,
      repaired: e.repaired,
      scoreTally: tally,
      costCny: e.costCny,
    }
  })

  const shapeRows = rows.reduce((n, r) => n + r.strictFails, 0)
  const totalRows = rows.reduce((n, r) => n + r.n, 0)
  const shapeRate = totalRows ? shapeRows / totalRows : null

  // C1: baseline (or any reference-config) evaluation zeroed by format failures.
  const referenceEvals = rows.filter(
    (r) => baselineDose != null && r.dose === baselineDose && r.scoreTally?.total,
  )
  const brokenReference = referenceEvals.filter(
    (r) =>
      r.scoreTally.shape + (r.scoreTally.parse ?? 0) > 0 &&
      r.scoreTally.ok + r.scoreTally.wrong_letter === 0,
  )
  if (referenceEvals.length && brokenReference.length) {
    add(
      'C1_INSTRUMENT_SUSPECT',
      'stop',
      `${brokenReference.length}/${referenceEvals.length} reference-config (baseline dose=${baselineDose}) evaluations scored zero with all rows failing shape/parse — the metric is under-reporting, not the candidates.`,
      { referenceEvals: referenceEvals.length, brokenEvals: brokenReference.length },
      'Halt search. Inspect raw outputs, separate compliance from content (lenient extraction or one bounded repair), recalibrate before more spend.',
    )
  }

  // C2: global format-drift rate on ORIGINAL outputs. Severity accounts for
  // containment: when a bounded repair recovered every drifted run (final
  // scores clean), drift is a warned cost factor, not a stop signal.
  if (shapeRate != null) {
    const unrecovered = rows.filter(
      (r) =>
        r.strictFails > 0 && r.scoreTally && r.scoreTally.shape + (r.scoreTally.parse ?? 0) > 0,
    ).length
    const drifted = rows.filter((r) => r.strictFails > 0).length
    const containment = drifted ? 1 - unrecovered / drifted : 1
    const severity =
      shapeRate > 0.5 && containment < 0.9 ? 'stop' : shapeRate >= 0.2 ? 'warn' : 'ok'
    if (severity !== 'ok') {
      add(
        'C2_FORMAT_DRIFT',
        severity,
        `${(shapeRate * 100).toFixed(0)}% of rows fail the strict output shape on original outputs (${shapeRows}/${totalRows}); repair containment ${(containment * 100).toFixed(0)}% (${drifted - unrecovered}/${drifted} drifted runs recovered).`,
        { shapeRows, totalRows, containment: +containment.toFixed(3) },
        containment >= 0.9
          ? 'Drift is real but contained by repair: content metrics are trustworthy; track repair spend as a compliance cost.'
          : 'Strict-judge scores systematically understate content ability; gate future runs on compliance or add a bounded repair round.',
      )
    }
  }

  // C3: dose-response on candidate evaluations (A/fast tier preferred).
  const candidates = rows.filter(
    (r) =>
      r.dose != null && r.contentAccuracy != null && (r.tier === 'fast' || r.tier === 'A_fast'),
  )
  if (candidates.length >= 5) {
    const rho = spearman(
      candidates.map((r) => r.dose),
      candidates.map((r) => r.contentAccuracy),
    )
    const buckets = {}
    for (const r of candidates) {
      const b = (buckets[r.bucket] ??= { acc: 0, n: 0, evals: 0 })
      b.acc += r.contentAccuracy
      b.n += r.n
      b.evals += 1
    }
    const means = Object.values(buckets).map((b) => b.acc / b.evals)
    const range = means.length ? Math.max(...means) - Math.min(...means) : null
    const varyingDose = new Set(candidates.map((r) => r.dose)).size > 1
    const constantResponse = new Set(candidates.map((r) => r.contentAccuracy)).size === 1
    if (
      varyingDose &&
      (constantResponse || (rho != null && Math.abs(rho) < 0.3)) &&
      (range ?? 1) < 0.15
    ) {
      add(
        'C3_LANDSCAPE_FLAT_SUSPECTED',
        'info',
        `Dose-response on ${candidates.length} fast-tier evaluations is flat (spearman rho=${rho == null ? 'undefined (constant response)' : rho.toFixed(2)}, bucket-mean range=${(range * 100).toFixed(1)}pp). Further search is unlikely to find capturable quality alpha on this variable.`,
        {
          rho,
          bucketMeans: Object.fromEntries(
            Object.entries(buckets).map(([k, b]) => [k, +(b.acc / b.evals).toFixed(3)]),
          ),
        },
        'Before funding more search on this variable, enlarge the dose gradient evidence or switch to a variable with demonstrated leverage.',
      )
    }
  }

  // C4: compliance vs dose independence (descriptive).
  if (rows.some((r) => r.dose != null)) {
    const byBucket = {}
    for (const r of rows) {
      if (r.dose == null) continue
      const b = (byBucket[r.bucket] ??= { compliant: 0, total: 0 })
      b.total += 1
      if (r.strictCompliant) b.compliant += 1
    }
    add(
      'C4_COMPLIANCE_BY_DOSE',
      'info',
      'Shape compliance by dose bucket (descriptive): ' +
        Object.entries(byBucket)
          .map(([k, b]) => `${k}=${b.compliant}/${b.total}`)
          .join(' '),
      byBucket,
      null,
    )
  }

  // C5: pre-registered decision-rule power check (the missing freeze-time gate).
  const finalTasks =
    protocol?.datasets?.views?.final?.tasks ?? protocol?.datasets?.views?.C2_final?.tasks ?? null
  const beatText = protocol?.decisionRule?.beat ?? ''
  const marginMatch = beatText.match(/\+\s*(\d+)/)
  if (finalTasks && marginMatch) {
    const finalRows = rows.filter((r) => r.tier === 'final' && r.contentAccuracy != null)
    const pHat = finalRows.length
      ? finalRows.reduce((a, r) => a + r.contentAccuracy, 0) / finalRows.length
      : 0.8
    const minimal = mde(pHat, finalTasks)
    const minimalPp = minimal == null ? null : minimal * 100
    const marginPp = (Number(marginMatch[1]) / finalTasks) * 100
    if (minimalPp != null && marginPp < minimalPp) {
      add(
        'C5_DECISION_RULE_UNDERPOWERED',
        'warn',
        `Pre-registered beat margin is ${marginPp.toFixed(0)}pp but at n=${finalTasks}/arm the minimal detectable effect (alpha=.05, power=.80) is ~${minimalPp.toFixed(0)}pp. This package can only confirm effects far larger than its own success threshold; realistic effects will read as NOT_ESTABLISHED regardless of truth.`,
        {
          finalTasksPerArm: finalTasks,
          beatMarginPp: +marginPp.toFixed(1),
          mdePp: +minimalPp.toFixed(1),
          pHat: +pHat.toFixed(3),
        },
        `Raise the final tier to n>=${Math.ceil((7.84 * 2 * pHat * (1 - pHat)) / (marginPp / 100) ** 2)} per arm, or pre-register a margin above ${minimalPp.toFixed(0)}pp, before live execution.`,
      )
    }
  }

  // C6: per-evaluation cost outliers (same tier, median-based).
  const byTier = {}
  for (const r of rows) {
    if (r.costCny == null) continue
    ;(byTier[r.tier] ??= []).push(r)
  }
  const outliers = []
  for (const [tier, list] of Object.entries(byTier)) {
    if (list.length < 3) continue
    const costs = list.map((r) => r.costCny).sort((a, b) => a - b)
    const median = costs[Math.floor(costs.length / 2)]
    for (const r of list)
      if (median > 0 && r.costCny > 5 * median)
        outliers.push({ arm: r.arm, tier, costCny: r.costCny, median })
  }
  if (outliers.length) {
    add(
      'C6_COST_OUTLIER',
      'info',
      `${outliers.length} evaluation(s) cost >5x the same-tier median.`,
      outliers,
      'Inspect fetch config vs actual payload exposure for the flagged evaluations.',
    )
  }

  const severityRank = { stop: 3, warn: 2, info: 1, ok: 0 }
  const binding = checks.filter((c) => c.severity === 'stop' || c.severity === 'warn')
  const overall = binding.length
    ? binding.reduce((a, c) => (severityRank[c.severity] > severityRank[a.severity] ? c : a))
        .severity
    : 'ok'
  return {
    runDir,
    overall,
    evaluations: rows.length,
    contentAccuracyOverall: rows.length
      ? +(rows.reduce((a, r) => a + (r.contentAccuracy ?? 0), 0) / rows.length).toFixed(3)
      : null,
    shapeRate,
    checks,
    generatedBy: 'duo-run-doctor v1',
  }
}

const evidenceRows = (result) => {
  const rows = []
  for (const ev of result?.evidence ?? []) {
    if (
      ev?.affectsSelection === false ||
      ev?.purpose === 'diagnostic_only' ||
      ev?.kind === 'quick_support_shadow'
    )
      continue
    if (['PARSE_ERROR', 'PARSE_FAILED', 'INVALID_JSON'].includes(ev?.status)) {
      rows.push({ reason: 'PARSE' })
      continue
    }
    if (ev?.status && ev.status !== 'SCORED') continue
    // Unfamiliar evaluator schemas are not evidence of a broken instrument.
    if (Array.isArray(ev?.rows))
      for (const r of ev.rows)
        if (
          r &&
          (['EXACT', 'WRONG_LETTER', 'PARSE'].includes(r.reason) ||
            SHAPE_REASONS.test(r.reason ?? ''))
        )
          rows.push(r)
  }
  return rows
}

const rowTally = (rows) => {
  let content = 0,
    shape = 0,
    parse = 0
  for (const r of rows) {
    if (r.reason === 'EXACT' || r.reason === 'WRONG_LETTER') content++
    else if (r.reason === 'PARSE' || SHAPE_REASONS.test(r.reason ?? '')) shape++
  }
  return { content, shape, parse, total: rows.length }
}

// Journal-driven diagnosis: works on the retained event stream of any duo run,
// so a headless optimizer gets the same guards without artifact files on disk.
// Covers the checks that only need candidate results + per-row evidence:
// J1 instrument suspect (baseline zeroed by format failures), J2 format drift,
// J3 flat dose-response, J4 compliance-by-dose (descriptive).
export function analyzeEvents(events, options = {}) {
  const driftStop = options.driftStop ?? 0.5,
    driftWarn = options.driftWarn ?? 0.2,
    flatMinEvals = options.flatMinEvals ?? 5
  const plan = events.find((e) => e.kind === 'plan')?.plan
  const baselineId = options.baselineId ?? plan?.baseline?.id ?? null
  const baselineDose = plan?.baseline?.config?.maxBodyChars ?? options.baselineDose ?? null
  // Candidate events are re-recorded on every update; diagnose the latest
  // state per candidate only, mirroring how selection reads the journal.
  const latestById = new Map()
  for (const e of events) if (e.kind === 'candidate') latestById.set(e.candidateId, e)
  const measured = [...latestById.values()].filter((e) => e.fast?.metrics || e.slow?.metrics)
  const checks = []
  const add = (id, severity, verdict, evidence, action) =>
    checks.push({ id, severity, verdict, evidence, action })

  const tallies = measured.map((e) => ({
    event: e,
    fast: rowTally(evidenceRows(e.fast)),
    slow: rowTally(evidenceRows(e.slow)),
  }))

  // J1: baseline measurement zeroed by format failures, with content answers present nowhere.
  if (baselineId) {
    const base = tallies.filter((t) => t.event.candidateId === baselineId)
    const broken = base.filter((t) => t.fast.total > 0 && t.fast.content === 0 && t.fast.shape > 0)
    if (base.length && broken.length) {
      add(
        'J1_INSTRUMENT_SUSPECT',
        'stop',
        `${broken.length}/${base.length} baseline measurement(s) scored zero with every row failing the output contract — the metric is under-reporting, not the candidates. Search cannot produce trustworthy signal on this instrument.`,
        { baselineId, measured: base.length, broken: broken.length },
        'Halt; separate compliance from content (lenient extraction or one bounded repair), recalibrate, then rerun.',
      )
    }
  }

  // J2: format-drift rate across all measured rows.
  const totals = tallies.reduce(
    (acc, t) => ({
      content: acc.content + t.fast.content + t.slow.content,
      shape: acc.shape + t.fast.shape + t.slow.shape,
      total: acc.total + t.fast.total + t.slow.total,
    }),
    { content: 0, shape: 0, total: 0 },
  )
  if (totals.total > 0) {
    const rate = totals.shape / totals.total
    if (rate >= driftWarn) {
      const severity = rate >= driftStop ? 'stop' : 'warn'
      add(
        'J2_FORMAT_DRIFT',
        severity,
        `${(rate * 100).toFixed(0)}% of measured rows fail the output contract (${totals.shape}/${totals.total}). ` +
          (severity === 'stop'
            ? 'Scores mostly measure format compliance, not task quality.'
            : 'A visible share of scores measures format, not quality.'),
        totals,
        'Gate evaluations on compliance or add a bounded repair round before trusting quality deltas.',
      )
    }
  }

  // J3: flat dose-response across measured candidates with a dose-bearing config.
  const points = tallies
    .map((t) => ({
      dose: t.event.candidate?.config?.maxBodyChars ?? null,
      quality: t.event.fast?.metrics?.quality ?? null,
    }))
    .filter((p) => p.dose != null && p.quality != null)
  if (points.length >= flatMinEvals) {
    const rho = spearman(
      points.map((p) => p.dose),
      points.map((p) => p.quality),
    )
    const buckets = {}
    for (const p of points) {
      const b = (buckets[bucketOf(p.dose)] ??= { sum: 0, n: 0 })
      b.sum += p.quality
      b.n += 1
    }
    const means = Object.values(buckets).map((b) => b.sum / b.n)
    const range = means.length ? Math.max(...means) - Math.min(...means) : null
    const varyingDose = new Set(points.map((p) => p.dose)).size > 1
    const constantResponse = new Set(points.map((p) => p.quality)).size === 1
    if (
      varyingDose &&
      (constantResponse || (rho != null && Math.abs(rho) < 0.3)) &&
      (range ?? 1) < 0.15
    ) {
      add(
        'J3_LANDSCAPE_FLAT_SUSPECTED',
        'info',
        `Dose-response across ${points.length} measured candidates is flat (spearman rho=${rho == null ? 'undefined (constant response)' : rho.toFixed(2)}, bucket-mean range=${((range ?? 0) * 100).toFixed(1)}pp). Further search on this variable is unlikely to find capturable quality alpha.`,
        {
          rho,
          bucketMeans: Object.fromEntries(
            Object.entries(buckets).map(([k, b]) => [k, +(b.sum / b.n).toFixed(3)]),
          ),
        },
        'Confirm leverage with a wider gradient or switch the optimization variable before funding more search.',
      )
    }
  }

  // J4: compliance by dose bucket (descriptive).
  const compliant = tallies.map((t) => {
    const rows = [...evidenceRows(t.event.fast), ...evidenceRows(t.event.slow)]
    return { dose: t.event.candidate?.config?.maxBodyChars ?? null, rows }
  })
  if (compliant.some((c) => c.dose != null && c.rows.length)) {
    const byBucket = {}
    for (const c of compliant) {
      if (c.dose == null || !c.rows.length) continue
      const b = (byBucket[bucketOf(c.dose)] ??= { compliant: 0, total: 0 })
      b.total += 1
      if (c.rows.every((r) => r.reason === 'EXACT' || r.reason === 'WRONG_LETTER')) b.compliant += 1
    }
    add(
      'J4_COMPLIANCE_BY_DOSE',
      'info',
      'Contract compliance by dose bucket (descriptive): ' +
        Object.entries(byBucket)
          .map(([k, b]) => `${k}=${b.compliant}/${b.total}`)
          .join(' '),
      byBucket,
      null,
    )
  }

  // J5: tied candidates — frozen tie-break selection among identical quality is
  // arbitrary, so an "improvement" pick from a tied pool carries no signal.
  const nonBaseline = measured.filter(
    (e) => e.candidateId !== baselineId && e.fast?.metrics?.quality != null,
  )
  if (baselineId && nonBaseline.length >= 3) {
    const qualities = nonBaseline.map((e) => e.fast.metrics.quality)
    if (qualities.every((q) => Math.abs(q - qualities[0]) <= 1e-9)) {
      add(
        'J5_TIED_CANDIDATES',
        'info',
        `${nonBaseline.length} measured candidates all tie at fast quality ${qualities[0].toFixed(3)} — champion selection among them is decided by the frozen tie-break, not by measured signal.`,
        { tied: nonBaseline.length, quality: qualities[0] },
        'If the tie sits at zero with format-failed rows, fix the instrument (J1/J2); otherwise stop search — no separable quality differences exist to optimize.',
      )
    }
  }

  const severityRank = { stop: 3, warn: 2, info: 1, ok: 0 }
  const binding = checks.filter((c) => c.severity === 'stop' || c.severity === 'warn')
  return {
    overall: binding.length
      ? binding.reduce((a, c) => (severityRank[c.severity] > severityRank[a.severity] ? c : a))
          .severity
      : 'ok',
    checks,
    baselineId,
    baselineDose,
    measuredEvaluations: measured.length,
  }
}

export function renderMarkdown(report) {
  const lines = [
    `# Run doctor report — ${report.runDir}`,
    '',
    `Overall verdict: **${report.overall.toUpperCase()}** | evaluations: ${report.evaluations} | content accuracy (behavior layer): ${report.contentAccuracyOverall ?? 'n/a'} | strict-shape row failure rate: ${report.shapeRate == null ? 'n/a' : (report.shapeRate * 100).toFixed(0) + '%'}`,
    '',
  ]
  for (const c of report.checks) {
    lines.push(`## ${c.id} [${c.severity}]`, '', c.verdict, '')
    if (c.action) lines.push(`Action: ${c.action}`, '')
  }
  if (!report.checks.length) lines.push('No anomalies detected at the behavior layer.', '')
  return lines.join('\n')
}

const isMain = process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href
if (isMain) {
  const runDir = process.argv[2]
  if (!runDir) {
    console.error('usage: node native/run-doctor.js <runDir> [--json out.json] [--md out.md]')
    process.exit(2)
  }
  const report = await analyzeRun(runDir, {
    includeOffline: process.argv.includes('--include-offline'),
  })
  const jsonIdx = process.argv.indexOf('--json')
  if (jsonIdx > 0) writeFileSync(process.argv[jsonIdx + 1], JSON.stringify(report, null, 2) + '\n')
  const mdIdx = process.argv.indexOf('--md')
  if (mdIdx > 0) writeFileSync(process.argv[mdIdx + 1], renderMarkdown(report))
  console.log(
    `VERDICT: ${report.overall.toUpperCase()} (${report.checks.map((c) => c.id + '[' + c.severity + ']').join(', ') || 'no anomalies'})`,
  )
  process.exit(report.overall === 'stop' ? 1 : 0)
}
