import { createOperations } from './run-operations.js'
import { createEvaluation } from './run-evaluation.js'
import { selectGeneration } from './run-selection.js'
import { completeSearch } from './run-final.js'
import {
  negotiateEvidence,
  effectiveEvidenceSpec,
  evidenceOutcome,
  strategyFeedback,
  strategySummary,
} from './evidence-strategy.js'
import { resolve, relative, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { ControllerService, fail } from './definitions.js'
import { freeze } from './contract.js'
import { digest, runInterruption } from './store.js'
import { inspectProviderContracts, providerContractDependencies } from './provider-contract.js'
import { selectWarmStart, executionEnvironment } from './warm-start.js'
import { searchStages, searchTiersOf } from './stages.js'
import { targetIdentity } from './target-protocol.js'
import { describeFailure, baselineAssessments } from './diagnostics.js'
import { baselinePolicy } from './capabilities.js'

const errorInfo = (error) =>
  describeFailure({
    code: error?.code,
    component: error?.component,
    nextAction: error?.nextAction,
    message: error?.code ? error.message : 'A configured native provider failed',
  })
const clone = (value) => structuredClone(value)
// Pin the native implementation loaded by this process. Source and installed
// package use the same production files; tests are not part of plan identity.
const implementationDigest = digest(
  readdirSync(new URL('.', import.meta.url))
    .filter((n) => n.endsWith('.js') && !n.endsWith('.test.js'))
    .sort()
    .map((n) => [n, readFileSync(new URL(n, import.meta.url), 'utf8')]),
)
export default class NativeController extends ControllerService {
  static inject = ['duoContract', ...providerContractDependencies()]
  constructor(ctx) {
    super(ctx)
    this.active = new Set()
    this.pendingCalls = new Set()
    ctx.effect(() => async () => {
      for (const r of this.active) r.abort.abort()
      await Promise.allSettled([...this.active].map((r) => r.done))
      await Promise.allSettled([...this.pendingCalls])
    })
  }
  bindings(spec) {
    return inspectProviderContracts(this.ctx, spec)
  }
  plan() {
    const { spec: requestedSpec, contractPath, contractDigest } = this.ctx.duoContract.resolve()
    const evidenceStrategy = negotiateEvidence(requestedSpec, this.ctx.duoEvaluators.describe())
    if (evidenceStrategy.requiresPreparation && requestedSpec.preset)
      fail(
        'DUO_ADDITIONAL_EVIDENCE_REQUIRED',
        'Inspect evidenceStrategy in dualloop_design: supply compatible Fast/additional evidence or explicitly choose optimize-basic/auto; no work dispatched',
      )
    const spec = freeze(effectiveEvidenceSpec(requestedSpec, evidenceStrategy)),
      baseline = this.ctx.duoTarget.snapshot(spec.target.path),
      providers = this.bindings(spec)
    evidenceStrategy.target.state = 'READY'
    targetIdentity(this.ctx.duoTarget, baseline)
    const searchPolicy =
      spec.mode === 'evaluation_only'
        ? null
        : {
            version: '2',
            duplicateIdentity: 'target_owned_content_identity',
            defaultDuplicateAction: 'skip_execution_and_evaluation',
            allowNoiseRepeats: spec.allowNoiseRepeats === true,
            repeatRequirement:
              'Explicit noise_measurement purpose and nonempty reason; existing budget and permissions unchanged.',
          }
    const recovery =
      providers.policies.duoJournal.checkpoint === 'settled_search_boundary_v1'
        ? {
            version: '1',
            boundaries: ['baseline', 'generation'],
            implementationDigest,
            deadlinePolicy: 'original_wall_deadline_includes_pause',
            resumeRequires: [
              'current_plan',
              'exact_checkpoint',
              'settled_unchanged_receipts',
              'released_or_dead_owner',
            ],
          }
        : null
    const identity = {
      apiVersion: 2,
      runtime: 'dsh-native',
      spec,
      contractPath,
      contractDigest,
      baseline,
      providers,
      ...(digest(requestedSpec) !== digest(spec) ? { requestedSpec } : {}),
      evidenceStrategy,
      searchPolicy,
      baselinePolicy: baselinePolicy(),
      searchStages: searchStages(spec),
      environment: executionEnvironment(),
      journalRoot: this.ctx.duoJournal.root,
      recovery,
    }
    if (spec.warmStart)
      identity.warmStart = selectWarmStart(
        this.ctx.duoJournal,
        identity,
        spec.warmStart,
        typeof this.ctx.duoFeedback.orderHistory === 'function' ? this.ctx.duoFeedback : undefined,
        this.ctx.duoTarget,
      )
    const planDigest = digest(identity),
      runId = planDigest
    for (const file of [contractPath, spec.target.path]) {
      const rel = relative(resolve(this.ctx.duoJournal.root, runId), file)
      if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)))
        fail('DUO_INPUT_OVERLAP', 'Run artifacts cannot contain protected inputs')
    }
    // Preparation is read-only; the same check is repeated under the Journal
    // admission lock immediately before claiming and initializing the allowance.
    if (!this.ctx.duoJournal.open(runId, { create: false })?.get('run')) {
      if (typeof this.ctx.duoBudget.checkAdmission === 'function')
        this.ctx.duoBudget.checkAdmission(runId, spec.budget)
    }
    return freeze({ ...identity, planDigest, runId })
  }
  status(runId) {
    const j = this.ctx.duoJournal.open(runId, { create: false }),
      checkpoint = j?.checkpointInfo?.() ?? null
    return {
      apiVersion: 2,
      runtime: 'dsh-native',
      runId,
      run: j?.get('run') ?? null,
      result: j?.result() ?? null,
      budget: this.ctx.duoBudget.inspect(runId),
      events: j?.events() ?? [],
      checkpoint,
      interrupted: j ? runInterruption(j, checkpoint) : null,
    }
  }
  async run({ planDigest, signal, pauseAfter, resumeFrom } = {}) {
    const plan = this.plan()
    if (planDigest !== plan.planDigest)
      fail('DUO_PLAN_CHANGED', 'Inspect the current native plan and pass its exact digest')
    if (
      (pauseAfter !== undefined && !['baseline', 'generation'].includes(pauseAfter)) ||
      (resumeFrom !== undefined && (typeof resumeFrom !== 'string' || !resumeFrom))
    )
      fail(
        'DUO_RESUME_INVALID',
        'Use a supported pause boundary and exact retained checkpoint digest',
      )
    if ((pauseAfter || resumeFrom) && !plan.recovery)
      fail(
        'DUO_RESUME_UNSUPPORTED',
        'Configured storage does not support settled-boundary continuation',
      )
    if (pauseAfter === 'generation' && !plan.spec.generations)
      fail('DUO_RESUME_INVALID', 'This contract has no candidate generation boundary')
    if (signal?.aborted) fail('ABORTED', 'Native run cancelled before admission')
    const old = this.ctx.duoJournal.open(plan.runId, { create: false })
    if (old?.result())
      return {
        ...old.result(),
        budget: this.ctx.duoBudget.inspect(plan.runId),
        reusedArtifacts: true,
      }
    if (old?.get('run') && !resumeFrom)
      fail(
        old.get('run').status === 'paused' ? 'DUO_RESUME_REQUIRED' : 'DUO_RUN_UNCERTAIN',
        'Inspect the retained checkpoint; no blind replay',
      )
    if (resumeFrom && !old?.get('run'))
      fail('DUO_RESUME_UNSUPPORTED', 'No original native run exists to continue')
    const deadlineAt = resumeFrom
      ? old?.get('checkpoint')?.state?.deadlineAt
      : Date.now() + plan.spec.budget.maxWallTimeMs
    if (!Number.isSafeInteger(deadlineAt))
      fail('DUO_RESUME_UNSUPPORTED', 'A valid original checkpoint deadline is required')
    if (Date.now() >= deadlineAt)
      fail(
        'DUO_DEADLINE_EXHAUSTED',
        'Original native run deadline has expired; no renewed allowance',
      )
    const abort = new AbortController(),
      timer = setTimeout(
        () => abort.abort(new Error('Native run deadline reached')),
        deadlineAt - Date.now(),
      )
    const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal
    const active = { abort, done: null }
    this.active.add(active)
    active.done = this.execute(plan, combined, { pauseAfter, resumeFrom, deadlineAt })
    try {
      return await active.done
    } finally {
      clearTimeout(timer)
      this.active.delete(active)
    }
  }
  async execute(plan, signal, options = {}) {
    const { spec, runId } = plan
    let j,
      restored = null
    const admit = () => {
      j = this.ctx.duoJournal.open(runId, { create: true })
      if (options.resumeFrom) restored = j.resume(plan.planDigest, options.resumeFrom)
      else {
        // Initialize immutable limits before publishing the claim. Read-only
        // preflight may see an unused ledger, never a claimed unbudgeted run.
        this.ctx.duoBudget.open(runId, spec.budget, searchTiersOf(spec))
        j.claim(plan.planDigest)
      }
    }
    if (typeof this.ctx.duoBudget.admitRun === 'function')
      this.ctx.duoBudget.admitRun(runId, spec.budget, admit)
    else admit()
    const releaseRun = j.lease()
    try {
      return await this.executeClaimed(plan, signal, j, { ...options, restored })
    } finally {
      releaseRun()
    }
  }
  async executeClaimed(plan, signal, j, { pauseAfter, deadlineAt, restored = null } = {}) {
    const { spec, providers, runId } = plan
    const evaluationOnly = spec.mode === 'evaluation_only',
      strategic = !!spec.preset && !evaluationOnly
    const stages = searchStages(spec),
      stageAttempts = restored?.stageAttempts ?? Object.fromEntries(stages.map((s) => [s.tier, 0]))
    if (!restored) {
      j.append({ kind: 'plan', plan })
      j.append({
        kind: 'evidence_strategy',
        strategy: strategySummary(plan.evidenceStrategy),
        declarationSource: 'plan.evidenceStrategy',
      })
    }
    const budget = this.ctx.duoBudget.open(runId, spec.budget, searchTiersOf(spec))
    const check = () => {
      if (signal.aborted) fail('ABORTED', 'Native run cancelled')
      const b = budget.snapshot()
      if (b.blockedReason) fail(b.blockedReason, 'Unresolved native operation stops the run')
    }
    let {
      sequence = 0,
      operations = 0,
      champion = clone(plan.baseline),
      championEvidence = {},
      stopReason = 'generation_limit',
      generationsRun = 0,
      consecutiveEvaluationFailures = 0,
      consecutiveNoProgress = 0,
      searchStopped = false,
    } = restored ?? {}
    const contentIdentity = (c) => targetIdentity(this.ctx.duoTarget, c)
    const final = [],
      latest = new Map(restored?.latest ?? []),
      issued = new Set(),
      contentIndex = new Map(
        restored?.contentIndex ?? [[contentIdentity(plan.baseline), plan.baseline.id]],
      ),
      baselineTiers = new Set(restored?.baselineTiers ?? [])
    // Reconstruct from retained Journal facts, including after a settled resume.
    const baselineAssessment = () => baselineAssessments(j.events())
    const boundary = (name, nextGeneration, stopped = false) => {
      searchStopped = stopped
      if (!plan.recovery) return null
      const paused = pauseAfter === name,
        checkpointDigest = j.saveCheckpoint(
          {
            format: 1,
            deadlineAt,
            implementationDigest,
            nextGeneration,
            searchStopped,
            sequence,
            operations,
            champion,
            championEvidence,
            stopReason,
            generationsRun,
            consecutiveEvaluationFailures,
            consecutiveNoProgress,
            latest: [...latest],
            contentIndex: [...contentIndex],
            baselineTiers: [...baselineTiers],
            stageAttempts,
          },
          { boundary: name, pause: paused },
        )
      return paused
        ? {
            apiVersion: 2,
            runtime: 'dsh-native',
            runId,
            planDigest: plan.planDigest,
            status: 'paused',
            mode: spec.mode,
            stopReason: 'checkpoint_pause',
            checkpointDigest,
            generationsRun,
            championId: null,
            conclusion: 'insufficient_evidence',
            improvementProven: false,
            final: [],
            baselineAssessment: baselineAssessment(),
            ...evidenceOutcome(plan.evidenceStrategy, j.events()),
            budget: budget.snapshot(),
            stageAttempts: clone(stageAttempts),
            reusedArtifacts: false,
          }
        : null
    }
    const nextId = () => {
      const id = 'dl-' + String(++sequence).padStart(4, '0')
      issued.add(id)
      return id
    }
    const record = (candidate, fields) => {
      const row = {
        ...latest.get(candidate.id),
        candidateId: candidate.id,
        parentId: candidate.parentId ?? null,
        parentVersion: candidate.parentVersion ?? null,
        candidateVersion: candidate.version ?? null,
        operatorId: candidate.operatorId ?? null,
        family: candidate.family ?? 'baseline',
        mode: candidate.mode ?? 'exploit',
        ts: Date.now(),
        ...fields,
      }
      latest.set(candidate.id, row)
      j.append({ kind: 'candidate', candidate: clone(candidate), ...row })
    }
    const invoke = createOperations({
      plan,
      signal,
      j,
      budget,
      check,
      stages,
      stageAttempts,
      pendingCalls: this.pendingCalls,
      nextOperationId: () => 'op-' + String(++operations).padStart(6, '0'),
    })
    const { evaluate, compare, assessIncumbent } = createEvaluation({
      ctx: this.ctx,
      plan,
      signal,
      j,
      invoke,
      record,
      baselineTiers,
      final,
      noteEvaluation: (result) => {
        consecutiveEvaluationFailures = result.ok ? 0 : consecutiveEvaluationFailures + 1
        return consecutiveEvaluationFailures
      },
    })
    const finishGeneration = (generation, previousVersion) => {
      if (!spec.stopping) return false
      const progressed = champion.version !== previousVersion
      consecutiveNoProgress = progressed ? 0 : consecutiveNoProgress + 1
      j.append({
        kind: 'search_progress',
        generation,
        progressed,
        consecutiveNoProgress,
        consecutiveEvaluationFailures,
        championId: champion.id,
        championVersion: champion.version,
        stopping: spec.stopping,
      })
      if (
        spec.stopping.maxNoProgressGenerations !== undefined &&
        consecutiveNoProgress >= spec.stopping.maxNoProgressGenerations
      ) {
        stopReason = 'no_progress_limit'
        return true
      }
      return false
    }
    let result
    try {
      check()
      if (!restored) {
        for (const { tier } of strategic ? stages.slice(0, 1) : stages) {
          championEvidence[tier] = await evaluate(champion, tier)
          assessIncumbent(champion, championEvidence[tier], tier)
        }
        record(champion, {
          status: evaluationOnly
            ? 'evaluated'
            : Object.values(baselineAssessment()).some((a) => a.verdict === 'constraint_violation')
              ? 'repair_baseline'
              : 'champion',
          ...championEvidence,
        })
        const paused = boundary('baseline', 1)
        if (paused) return paused
      }
      for (
        let generation = restored?.nextGeneration ?? 1;
        !searchStopped && generation <= spec.generations;
        generation++
      ) {
        const previousVersion = champion.version
        check()
        // Generation-top doctor consult: runs before any further spend, on a
        // path no promotion outcome can skip. The guard must never break the
        // run it guards.
        let doctor = null
        try {
          doctor = this.ctx.get('duoDoctor')?.consult?.(j.events(), spec) ?? null
        } catch {
          doctor = null
        }
        if (doctor) j.append({ kind: 'doctor', ...doctor })
        if (doctor?.severity === 'stop') {
          stopReason = 'doctor_stop'
          const stoppedEarly = boundary('generation', generation, true)
          if (stoppedEarly) return stoppedEarly
          break
        }
        const feedback = {
            ...this.ctx.duoFeedback.summarize([...latest.values()], spec.quotas, {
              fastMetrics: Object.keys(spec[stages[0]?.tier]?.weights ?? { quality: 1 }),
              upperMetric: spec[stages[stages.length - 1]?.tier]?.metric ?? 'quality',
              constraints: spec.constraints,
              tiers: stages.map((s) => s.tier),
              ...(strategic ? { evidenceDecisions: strategyFeedback(j.events()) } : {}),
            }),
            ...(plan.warmStart ? { warmStart: clone(plan.warmStart.context) } : {}),
          },
          feedbackDigest = digest(feedback),
          historyIdentity = plan.warmStart ? { warmStartDigest: plan.warmStart.contextDigest } : {}
        j.append({
          kind: 'feedback',
          generation,
          feedback,
          feedbackDigest,
          ...historyIdentity,
          consumer: {
            service: 'duoGenerator',
            providerId: providers.generator.id,
            providerVersion: providers.generator.version,
          },
        })
        const output = await invoke(
          'generation',
          null,
          providers.generator,
          () =>
            this.ctx.duoGenerator.propose({
              champion: freeze(clone(champion)),
              feedback: freeze(clone(feedback)),
              quotas: freeze(clone(feedback.quotas)),
              generation,
              nextId,
              signal,
            }),
          { generation, parentId: champion.id, feedbackDigest, ...historyIdentity },
        )
        if (!Array.isArray(output.candidates))
          fail('DUO_CANDIDATES_INVALID', 'Generator must return a candidate list')
        if (!output.candidates.length) {
          stopReason = 'no_candidates'
          const paused = boundary('generation', generation + 1, true)
          if (paused) return paused
          break
        }
        const count = { exploit: 0, explore: 0, innovate: 0 },
          seen = new Set(),
          proposed = [],
          candidates = []
        for (const c of output.candidates) {
          if (!issued.has(c.id) || seen.has(c.id) || latest.has(c.id))
            fail(
              'DUO_CANDIDATES_INVALID',
              'Candidate IDs must be unique controller-issued identities',
            )
          seen.add(c.id)
          const applied = this.ctx.duoTarget.apply(c, champion)
          count[c.mode]++
          proposed.push(applied)
        }
        if (Object.keys(count).some((m) => count[m] !== feedback.quotas[m]))
          fail('DUO_QUOTA_INVALID', 'Generator did not honor assigned structural mode quotas')
        for (const c of proposed) {
          const contentDigest = contentIdentity(c),
            duplicateOf = contentIndex.get(contentDigest) ?? null,
            repeat = c.repeat ?? null
          if (
            c.repeat !== undefined &&
            (!spec.allowNoiseRepeats ||
              !duplicateOf ||
              !repeat ||
              Object.keys(repeat).sort().join(',') !== 'purpose,reason' ||
              repeat.purpose !== 'noise_measurement' ||
              typeof repeat.reason !== 'string' ||
              !repeat.reason.trim() ||
              Buffer.byteLength(repeat.reason) > 1024)
          )
            fail(
              'DUO_REPEAT_INVALID',
              'A repeated candidate requires an existing exact-content source, frozen allowNoiseRepeats opt-in and a bounded noise_measurement reason',
            )
          const skip = !!duplicateOf && !repeat
          record(c, {
            status: skip ? 'duplicate_skipped' : 'proposed',
            hypothesis: c.hypothesis,
            delta: c.delta,
            generation,
            contentDigest,
            duplicateOf,
            repeat,
          })
          if (!duplicateOf) contentIndex.set(contentDigest, c.id)
          if (!skip) candidates.push(c)
        }
        generationsRun = generation
        if (!candidates.length) {
          stopReason = 'no_new_candidates'
          const paused = boundary('generation', generation + 1, true)
          if (paused) return paused
          break
        }
        if (spec.mode === 'explore') {
          stopReason = 'explore_only'
          const paused = boundary('generation', generation + 1, true)
          if (paused) return paused
          break
        }
        ;({ champion, championEvidence, searchStopped, stopReason } = await selectGeneration({
          ctx: this.ctx,
          plan,
          j,
          stages,
          stageAttempts,
          budget,
          strategic,
          generation,
          candidates,
          champion,
          championEvidence,
          searchStopped,
          stopReason,
          evaluate,
          assessIncumbent,
          compare,
          record,
        }))
        const stopped = searchStopped || finishGeneration(generation, previousVersion),
          paused = boundary('generation', generation + 1, stopped)
        if (paused) return paused
        if (stopped) break
      }
      result = await completeSearch({
        plan,
        j,
        budget,
        stages,
        champion,
        championEvidence,
        stopReason,
        generationsRun,
        final,
        evaluate,
        compare,
        baselineAssessment,
      })
    } catch (error) {
      const doctorReport = [...j.events()].reverse().find((e) => e.kind === 'doctor')
      result = {
        apiVersion: 2,
        runtime: 'dsh-native',
        runId,
        planDigest: plan.planDigest,
        status: signal.aborted ? 'cancelled' : 'failed',
        mode: spec.mode,
        stopReason: error.code ?? 'provider_failure',
        generationsRun,
        championId: null,
        conclusion: 'insufficient_evidence',
        final,
        improvementProven: false,
        error: errorInfo(error),
        budget: budget.snapshot(),
        reusedArtifacts: false,
        ...(doctorReport
          ? { doctor: { severity: doctorReport.severity, checks: doctorReport.checks } }
          : {}),
      }
    }
    const semantics = evidenceOutcome(plan.evidenceStrategy, j.events())
    Object.assign(result, {
      ...semantics,
      baselineAssessment: baselineAssessment(),
      limitations: [...semantics.limitations, ...(result.limitations ?? [])],
    })
    result.stageAttempts = clone(stageAttempts)
    if (spec.stopping)
      result.stopping = {
        configured: clone(spec.stopping),
        consecutiveEvaluationFailures,
        consecutiveNoProgress,
      }
    if (plan.warmStart)
      result.historyReuse = {
        mode: plan.warmStart.mode,
        contextDigest: plan.warmStart.contextDigest,
        records: plan.warmStart.context.records.length,
        sourceRunIds: plan.warmStart.sources.filter((s) => s.selected).map((s) => s.runId),
        currentBaselineVersion: plan.baseline.version,
        baselineRemeasured: baselineTiers.size > 0,
        baselineTiers: [...baselineTiers],
        priorCostsImported: false,
        finalDataReview: clone(plan.warmStart.finalDataReview),
      }
    j.complete(result)
    return result
  }
}
// Same execution/accounting implementation, with only the unused Generator
// dependency removed for an explicitly evaluation-only profile.
export class EvaluationController extends NativeController {
  static inject = NativeController.inject.filter((key) => key !== 'duoGenerator')
  plan() {
    if (this.ctx.duoContract.resolve().spec.mode !== 'evaluation_only')
      fail(
        'DUO_CONTRACT_INVALID',
        'The evaluation controller only accepts explicit evaluation-only contracts',
      )
    return super.plan()
  }
}
