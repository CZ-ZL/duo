import { evidenceOutcome } from './evidence-strategy.js'
import { ObserverService } from './definitions.js'
import { searchTiersOf } from './stages.js'
const clone = (value) => structuredClone(value)
const finite = (x) => typeof x === 'number' && Number.isFinite(x)
const label = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t)
// Tier vocabulary derives from the inspected contract's measurement schedule:
// search stages in declared order, then the separate final tier. Legacy flat
// contracts keep the historical fixed fast/review/slow/final report shape.
function diagnose(report, plan, result, events, tiers, rowTiers) {
  const facts = [],
    candidates = report.candidates.filter((c) => c.id !== (plan.baseline?.id ?? 'baseline')),
    byId = new Map(report.candidates.map((c) => [c.id, c]))
  const fact = (code, message, candidateIds = [], component = 'duoController') =>
    facts.push({
      code,
      message,
      candidateIds,
      component,
      source: {
        runId: report.runId,
        records: 'native Journal candidate/comparison/result and latest ledger',
      },
    })
  const first = tiers[0] ?? null,
    terminal = tiers[tiers.length - 1] ?? null,
    firstComparison = first ? first + 'Comparison' : null
  const custom = Array.isArray(plan.spec?.searchStages),
    firstCode = custom && first ? first.toUpperCase() : 'FAST',
    terminalCode = custom && terminal ? terminal.toUpperCase() : 'SLOW'
  const pairs = first
    ? candidates.filter(
        (c) =>
          c[first].state === 'EVALUATED' &&
          finite(c[firstComparison]?.score) &&
          finite(byId.get(c.parentId)?.[firstComparison]?.score),
      )
    : []
  const epsilon = plan.spec?.epsilon
  const tied =
    finite(epsilon) &&
    pairs.length > 0 &&
    pairs.every(
      (c) =>
        Math.abs(c[firstComparison].score - byId.get(c.parentId)[firstComparison].score) <= epsilon,
    )
  if (tied)
    fact(
      firstCode + '_SCORES_WITHIN_EPSILON',
      'All available candidate-parent first-stage score pairs in this report lie within the configured epsilon. This says nothing about unmeasured candidates or metric validity.',
      pairs.map((c) => c.id),
      'duoComparator',
    )
  for (const tier of rowTiers) {
    const objective = plan.spec?.[tier],
      definition = plan.providers?.evaluators?.find((d) => d.tier === tier)?.metricDefinitions?.[
        objective?.metric
      ]
    const bound =
      objective?.direction === 'maximize'
        ? definition?.upperBound
        : objective?.direction === 'minimize'
          ? definition?.lowerBound
          : null
    if (!finite(bound)) continue
    const atBound = report.candidates.filter(
      (c) => c[tier].state === 'EVALUATED' && c[tier].metrics?.[objective.metric] === bound,
    )
    if (atBound.length)
      fact(
        'METRIC_AT_DECLARED_BOUND',
        `${tier}.${objective.metric} equals the provider-declared favorable bound ${bound} for these measurements. The declaration is not independently qualified; this is not proof of general task quality, causal saturation or a broken evaluator.`,
        atBound.map((c) => c.id),
        'duoEvaluators',
      )
  }
  const notBetter = first
    ? candidates.filter((c) => c[firstComparison]?.verdict === 'not_better')
    : []
  if (notBetter.length)
    fact(
      firstCode + '_NOT_BETTER',
      'Recorded first-stage comparisons did not admit these candidates as improvements.',
      notBetter.map((c) => c.id),
      'duoComparator',
    )
  if (
    tiers.length > 1 &&
    terminal &&
    candidates.length &&
    !candidates.some((c) => c[terminal].state === 'EVALUATED')
  )
    fact(
      'NO_CANDIDATE_' + terminalCode + '_MEASUREMENT',
      'No successful candidate terminal-stage measurement is recorded; inspect individual stages for non-promotion, failure or unfinished work.',
      candidates.map((c) => c.id),
      'duoEvaluators',
    )
  const failed = report.candidates.filter((c) => rowTiers.some((t) => c[t].state === 'FAILED'))
  if (failed.length)
    fact(
      'EVALUATION_FAILED',
      'At least one evaluator returned ok=false; missing or failed measurements are not zero scores.',
      failed.map((c) => c.id),
      'duoEvaluators',
    )
  const violations = report.candidates.filter((c) =>
    [
      ...rowTiers.filter((t) => t !== 'final').map((t) => c[t + 'Comparison']?.verdict),
      result?.independentFinal?.comparison?.verdicts?.[c.id],
      ...Object.values(result?.measurementChecks ?? {}).map((x) => x.verdicts?.[c.id]),
    ].includes('constraint_violation'),
  )
  if (violations.length)
    fact(
      'CONSTRAINT_VIOLATION',
      'A recorded comparison or evaluation-only check failed a frozen hard constraint; retaining the original does not mean the constraint passed.',
      violations.map((c) => c.id),
      'duoComparator',
    )
  if (/DELTA|CANDIDATES|QUOTA|REPEAT/.test(result?.error?.code ?? report.stopReason ?? ''))
    fact(
      'CANDIDATE_INVALID',
      'The run rejected a candidate or generation contract. Correct its provider/input before considering new work.',
      [],
      result?.error?.component ?? 'duoTarget',
    )
  if (report.conclusion === 'retain_baseline')
    fact(
      'BASELINE_RETAINED',
      'The current result retains the original target; this does not certify universal superiority or evaluator correctness.',
    )
  if (report.conclusion === 'insufficient_evidence')
    fact(
      'INSUFFICIENT_EVIDENCE',
      'The recorded stages do not support a qualified recommendation under this contract.',
    )
  if (report.stopReason)
    fact('RUN_STOP_REASON', report.stopReason, [], result?.error?.component ?? 'duoController')
  const budget = report.budget,
    currency = budget?.currency ?? (budget && Object.hasOwn(budget, 'costUsd') ? 'USD' : null),
    suffix = currency === 'CNY' ? 'Cny' : 'Usd'
  const cost = currency && finite(budget?.['cost' + suffix]) ? budget['cost' + suffix] : null,
    known =
      currency && finite(budget?.['knownCost' + suffix]) ? budget['knownCost' + suffix] : cost,
    reserved =
      currency && finite(budget?.['reservedCost' + suffix]) ? budget['reservedCost' + suffix] : null
  const terminal_ = !!result,
    blocked = budget?.blockedReason ?? null,
    descriptors = [
      plan.providers?.generator,
      plan.providers?.executor,
      ...(plan.providers?.evaluators ?? []),
    ].filter(Boolean)
  let nextAction =
    !terminal_ && report.status !== 'NOT_STARTED'
      ? 'inspect_active_owner_and_retained_state'
      : cost === null
        ? 'inspect_and_reconcile_supported_receipts'
        : 'inspect_result_and_current_authorization'
  if (blocked === 'DUO_COST_UNKNOWN') nextAction = 'inspect_and_reconcile_supported_receipts'
  if (blocked === 'DUO_RESERVATION_OVERRUN') nextAction = 'inspect_overrun_no_new_work'
  const resumable = report.checkpoint?.resumable === true && cost !== null && !blocked
  if (resumable) nextAction = 'inspect_current_plan_then_resume_exact_checkpoint'
  return {
    version: '1',
    facts,
    causeEstablished: false,
    causeScope:
      'Why scores tied or optimization did not improve; explicit component refusal reasons remain recorded facts.',
    metricCeilingEstablished: false,
    unresolvedQuestions: tied
      ? [
          {
            question:
              'Do the frozen evaluators distinguish relevant correct and incorrect behavior?',
            state: 'NOT_TESTED',
            requiredEvidence:
              'Predeclared positive/negative controls and implementation review; controls do not establish optimization benefit.',
          },
          {
            question:
              'Are equal scores due to saturation, coarse measurement or behaviorally equivalent candidate outputs?',
            state: 'NOT_TESTED',
            requiredEvidence:
              'Compare retained applied overlays and actual task outputs against frozen metric semantics. New experiments need separate authorization.',
          },
        ]
      : [],
    cost: {
      currency,
      total: cost,
      known,
      reserved,
      operations: budget?.operations ?? null,
      blockedReason: blocked,
    },
    sideEffects: {
      journalWritten: events.length > 0,
      controllerTargetWrites: 0,
      externalEffects:
        descriptors.length && descriptors.every((d) => d.permissions?.externalSideEffects === false)
          ? 'NO_EFFECTS_DECLARED'
          : 'UNKNOWN_FROM_TRUSTED_PROVIDER',
      limit:
        'Controller records do not attest hidden effects of trusted custom providers; inspect their retained execution evidence.',
    },
    recovery: {
      readOnlyInspectionSafe: true,
      resumeSupported: resumable,
      checkpoint: clone(report.checkpoint ?? null),
      safeToRepeatWork: false,
      automaticNewRunAuthorized: false,
      costState: cost === null ? 'UNKNOWN' : 'KNOWN',
      nextAction,
      artifactReplay: terminal_
        ? 'Same unchanged plan may return its terminal artifacts; status/report can read the recorded run ID.'
        : resumable
          ? 'Inspect the current plan and pass this exact checkpoint digest to run; settled operations are not replayed.'
          : 'Use status/report; no supported clean checkpoint is currently available.',
      conditions: [
        'Reconcile only an already staged independently supported receipt; never rerun a provider to recover its fee.',
        'Terminal and interrupted run identities are not reset. A new contract or warm start requires current authorization and a newly inspected plan.',
      ],
    },
  }
}
export function buildReport(status) {
  const events = status.events ?? [],
    plan = events.find((e) => e.kind === 'plan')?.plan ?? {},
    spec = plan.spec ?? {},
    result = status.result ?? null
  const tiers = searchTiersOf(spec),
    first = tiers[0] ?? null,
    terminal = tiers.length > 1 ? tiers[tiers.length - 1] : null
  const rowTiers = spec.searchStages ? [...tiers, 'final'] : ['fast', 'review', 'slow', 'final'],
    compareTiers = rowTiers.filter((t) => t !== 'final')
  const custom = Array.isArray(spec.searchStages) && !!first && !!terminal
  const names = custom
    ? {
        decision: terminal + 'Decision',
        evaluated: terminal + 'EvaluatedCandidates',
        accepted: terminal + 'AcceptedCandidates',
        fraction: terminal + 'AcceptanceFraction',
        costPer: 'costPer' + label(terminal) + 'AcceptedCandidate',
        correlation: first + label(terminal) + 'Correlation',
        firstFamily: first + 'Family',
        terminalFamily: terminal + 'Family',
      }
    : {
        decision: 'slowDecision',
        evaluated: 'slowEvaluatedCandidates',
        accepted: 'slowAcceptedCandidates',
        fraction: 'slowAcceptanceFraction',
        costPer: 'costPerSlowAcceptedCandidate',
        correlation: 'fastSlowCorrelation',
        firstFamily: 'fastFamily',
        terminalFamily: 'slowFamily',
      }
  const latest = new Map(),
    comparisons = Object.fromEntries(compareTiers.map((t) => [t, new Map()])),
    selectedFor = Object.fromEntries(compareTiers.map((t) => [t, new Set()])),
    notPromoted = Object.fromEntries(compareTiers.map((t) => [t, new Set()]))
  if (plan.baseline)
    latest.set(plan.baseline.id, {
      candidateId: plan.baseline.id,
      candidate: clone(plan.baseline),
      status: 'planned',
    })
  for (const event of events) {
    if (event.kind === 'candidate')
      latest.set(event.candidateId, { ...latest.get(event.candidateId), ...clone(event) })
    if (event.kind === 'gate' && selectedFor[event.toTier]) {
      const ids = new Set((event.selected ?? []).map((row) => row.candidateId))
      for (const id of ids) selectedFor[event.toTier].add(id)
      for (const id of event.considered ?? []) if (!ids.has(id)) notPromoted[event.toTier].add(id)
    }
    if (event.kind === 'comparison' && comparisons[event.tier])
      for (const [id, verdict] of Object.entries(event.comparison.verdicts))
        comparisons[event.tier].set(id, {
          verdict,
          score: event.comparison.scores?.[id] ?? null,
          rank: event.comparison.ranking.indexOf(id),
        })
  }
  const final = new Map(
    (result?.final ?? events.findLast((e) => e.kind === 'final')?.results ?? []).map((e) => [
      e.candidateId,
      e,
    ]),
  )
  const selectedId = result?.championId ?? result?.proxyLeaderId ?? null
  const evaluation = (row, tier) => {
    const value = tier === 'final' ? final.get(row.candidateId) : row[tier]
    if (value)
      return {
        ...clone(value),
        state: value.ok === true ? 'EVALUATED' : value.ok === false ? 'FAILED' : 'INVALID',
      }
    let state = 'NOT_EVALUATED',
      reason = 'No evaluation receipt exists for this candidate and tier.'
    if (!spec[tier]) {
      state = 'NOT_CONFIGURED'
      reason = 'The inspected contract has no objective for this tier.'
    } else if (row.status === 'duplicate_skipped') {
      reason =
        'Exact content duplicate of ' +
        row.duplicateOf +
        '; execution and evaluation were skipped. No earlier score was copied.'
    } else if (selectedFor[tier]?.has(row.candidateId)) {
      reason =
        'Selected for deeper evaluation; no completed evaluator receipt is recorded. Inspect the run failure or active operation.'
    } else if (notPromoted[tier]?.has(row.candidateId)) {
      state = 'NOT_PROMOTED'
      reason = 'The preceding stage gate did not select this candidate for deeper evaluation.'
    } else if (
      tier === terminal &&
      first &&
      comparisons[first]?.get(row.candidateId)?.verdict === 'not_better'
    ) {
      state = 'NOT_PROMOTED'
      reason =
        'First-stage comparison did not admit an improvement and no deeper-testing selection is recorded.'
    } else if (
      tier === 'final' &&
      result &&
      row.candidateId !== selectedId &&
      row.candidateId !== 'baseline'
    ) {
      state = 'NOT_SELECTED_FOR_FINAL'
      reason = 'Final was reserved for the baseline and selected candidate.'
    }
    return { state, reason, metrics: null }
  }
  const candidates = [...latest.values()].map((row) => ({
    id: row.candidateId,
    parentId: row.candidate?.parentId ?? row.parentId ?? null,
    parentVersion: row.candidate?.parentVersion ?? row.parentVersion ?? null,
    version: row.candidate?.version ?? null,
    generation: row.generation ?? 0,
    mode: row.mode ?? null,
    family: row.family ?? null,
    status: row.status,
    hypothesis: row.hypothesis ?? row.candidate?.hypothesis ?? null,
    delta: clone(row.delta ?? row.candidate?.delta ?? null),
    duplicateOf: row.duplicateOf ?? null,
    contentDigest: row.contentDigest ?? null,
    repeat: clone(row.repeat ?? null),
    ...Object.fromEntries(rowTiers.map((t) => [t, evaluation(row, t)])),
    ...Object.fromEntries(
      compareTiers.map((t) => [
        t + 'Comparison',
        clone(comparisons[t].get(row.candidateId) ?? null),
      ]),
    ),
    [names.decision]: row.slowDecision ?? null,
    selected: row.candidateId === selectedId,
  }))
  const budget = clone(status.budget ?? result?.budget ?? null),
    currency = budget?.currency ?? (budget && Object.hasOwn(budget, 'costUsd') ? 'USD' : null)
  const cost = budget?.[currency === 'CNY' ? 'costCny' : 'costUsd'] ?? null
  const evaluatedSlow = terminal
      ? candidates.filter((c) => c.id !== 'baseline' && c[terminal].state === 'EVALUATED')
      : [],
    accepted = evaluatedSlow.filter((c) => c[names.decision] === 'accepted')
  const feedback = clone(events.findLast((e) => e.kind === 'feedback')?.feedback ?? null)
  const measurements = plan.providers?.evaluators ?? [],
    firstFamily = first
      ? (measurements.find((d) => d.tier === first)?.evidenceFamily ?? null)
      : null,
    terminalFamily = terminal
      ? (measurements.find((d) => d.tier === terminal)?.evidenceFamily ?? null)
      : null
  const fidelity = {
    status:
      !firstFamily || !terminalFamily
        ? 'EVIDENCE_FAMILY_UNSPECIFIED'
        : firstFamily === terminalFamily
          ? 'SAME_DECLARED_EVIDENCE_FAMILY'
          : 'DIFFERENT_DECLARED_FAMILIES_NOT_QUALIFIED',
    [names.firstFamily]: firstFamily,
    [names.terminalFamily]: terminalFamily,
    higherFidelityProven: false,
    rationale: terminal
      ? (measurements.find((d) => d.tier === terminal)?.fidelityRationale ?? null)
      : null,
    limit:
      'Provider declarations describe intended evidence; they do not establish empirical fidelity or evaluator correctness.',
  }
  const report = {
    apiVersion: 2,
    runtime: 'dsh-native',
    reportVersion: '7',
    runId: status.runId,
    status: result?.status ?? status.run?.status ?? 'NOT_STARTED',
    mode: result?.mode ?? spec.mode ?? null,
    conclusion: result?.conclusion ?? 'insufficient_evidence',
    stopReason: result?.stopReason ?? null,
    improvementProven: result?.improvementProven === true,
    selectedId,
    candidates,
    budget,
    checkpoint: clone(status.checkpoint ?? null),
    historyReuse: clone(result?.historyReuse ?? null),
    finalDataReview: clone(plan.warmStart?.finalDataReview ?? null),
    providers: clone(plan.providers ?? null),
    objectives: clone(Object.fromEntries(rowTiers.map((t) => [t, spec[t] ?? null]))),
    searchStages: clone(plan.searchStages ?? []),
    stageAttempts: clone(result?.stageAttempts ?? null),
    feedback,
    fidelity,
    health: {
      [names.evaluated]: evaluatedSlow.length,
      [names.accepted]: accepted.length,
      [names.fraction]: evaluatedSlow.length ? accepted.length / evaluatedSlow.length : null,
      [names.costPer]: accepted.length && cost !== null ? cost / accepted.length : null,
      [names.correlation]: feedback?.fastSlowCorrelation ?? null,
    },
    lineage: candidates.map(
      ({ id, parentId, parentVersion, version, generation, hypothesis, delta }) => ({
        id,
        parentId,
        parentVersion,
        version,
        generation,
        hypothesis,
        delta,
      }),
    ),
    limitations: [
      'Report derives existing observations; it does not evaluate, rerun, qualify an evaluator or prove causal effects.',
      'NOT_EVALUATED, NOT_PROMOTED and NOT_SELECTED_FOR_FINAL are not failed scores.',
      'Cost is the latest cumulative ledger; per-evaluation cost alone excludes execution and generation.',
      'JSONL is a read-only export of the authoritative SQLite events, not a second journal.',
    ],
    replayedOperations: 0,
    journalJsonl: events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : ''),
  }
  if (plan.evidenceStrategy) {
    const semantics = evidenceOutcome(plan.evidenceStrategy, events)
    Object.assign(report, {
      ...semantics,
      limitations: [...report.limitations, ...semantics.limitations],
    })
  }
  report.delivery = {
    version: '1',
    execution: {
      state: report.status,
      resultRecorded: !!result,
      terminal: !!result && ['completed', 'failed', 'cancelled'].includes(result.status),
    },
    artifacts: {
      state: events.some((e) => e.kind === 'plan')
        ? result
          ? 'REPORT_RENDERED'
          : 'PARTIAL_REPORT_RENDERED'
        : 'NO_RUN_EVIDENCE',
      modelRequestsRequired: 0,
      persistence: 'NOT_OBSERVED_BY_REPORT',
      meaning:
        'This deterministic response is available now; a host must retain it to establish a saved report file.',
    },
    caller: {
      state: 'NOT_OBSERVED',
      meaning:
        'Rendering or saving a report does not establish that an independent Calling Agent received or explained it. Use the host session receipt for that claim.',
    },
    accounting: {
      scope: 'native_inner_operations',
      includes: ['generation', 'candidate_execution', 'evaluation', 'selection'],
      callerCostsIncluded: false,
      wholeChainBudgetEnforced: false,
      meaning:
        'Caller preparation and optional explanation need their own existing host allowance and receipts. This report does not reserve or transfer that allowance.',
    },
  }
  report.diagnostics = diagnose(report, plan, result, events, tiers, rowTiers)
  const cell = (c, t) =>
    c[t].state === 'EVALUATED'
      ? JSON.stringify(c[t].metrics?.[spec[t]?.metric] ?? c[t].metrics)
      : c[t].state
  report.text = [
    `DUO ${status.runId}`,
    `status: ${report.status}; conclusion: ${report.conclusion}`,
    ...(report.optimization_mode
      ? [
          `optimization_mode: ${report.optimization_mode}; slow_mode: ${report.slow_mode}; validation: ${report.dual_loop_validation}`,
        ]
      : []),
    `cost: ${currency ?? 'unknown currency'} ${cost === null ? 'unknown' : cost}`,
    `delivery: ${report.delivery.artifacts.state}; Caller: ${report.delivery.caller.state}; report model requests required: 0`,
    ...(report.historyReuse
      ? [
          `history: ${report.historyReuse.mode}; ${report.historyReuse.records} records; old costs imported: false; final independence: ${report.finalDataReview?.independence}`,
        ]
      : []),
    `observed: ${report.diagnostics.facts.map((f) => f.code + (f.candidateIds?.length ? ' [' + f.candidateIds.join(', ') + ']' : '')).join(', ') || 'No diagnostic facts recorded'}`,
    `next action: ${report.diagnostics.recovery.nextAction}; automatic repeat authorized: false`,
    ['candidate', 'parent', ...tiers.map(label), 'final', 'decision'].join(' | '),
    ...candidates.map((c) =>
      [
        c.id,
        c.parentId ?? '-',
        ...tiers.map((t) => cell(c, t)),
        cell(c, 'final'),
        c[names.decision] ??
          (first ? c[first + 'Comparison']?.verdict : null) ??
          (c.status === 'duplicate_skipped' ? 'duplicate_of ' + (c.duplicateOf ?? 'unknown') : '-'),
      ].join(' | '),
    ),
    'Evaluation stages and scores are observations; no efficacy claim is added by this report.',
  ].join('\n')
  return report
}
export default class NativeObserver extends ObserverService {
  static inject = ['duoController']
  describe() {
    return { id: 'native-observer', version: '5', deterministic: true }
  }
  report(runId) {
    return buildReport(this.ctx.duoController.status(runId))
  }
}
