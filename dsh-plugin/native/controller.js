import {
  negotiateEvidence,
  effectiveEvidenceSpec,
  evidenceReceipt,
  evidenceOutcome,
  aggregateJudgments,
  decideEvidence,
  affordableAcquisitions,
  strategyFeedback,
  strategySummary,
} from './evidence-strategy.js'
import { resolve, relative, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { ControllerService, fail } from './definitions.js'
import { freeze } from './contract.js'
import { digest, runInterruption } from './store.js'
import { moneyFields, assertMoneyEvidence } from './money.js'
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
    const invoke = async (phase, tier, descriptor, fn, request) => {
      check()
      const stage = stages.find((s) => s.tier === tier)
      if (spec.searchStages && stage && stageAttempts[tier] >= stage.maxEvaluations)
        fail('DUO_STAGE_BUDGET_EXHAUSTED', 'The frozen ' + tier + ' evaluation limit is exhausted')
      const id = 'op-' + String(++operations).padStart(6, '0')
      const m = moneyFields(spec.budget)
      budget.reserve(id, {
        phase,
        tier,
        currency: m.currency,
        [m.cap]: descriptor[m.reservation],
        request: { provider: descriptor.id, version: descriptor.version, ...request },
      })
      if (stage) stageAttempts[tier]++
      let settled = false
      const releaseCall = j.lease()
      const work = Promise.resolve()
        .then(fn)
        .then(
          (value) => {
            let currencyMatches = false
            try {
              assertMoneyEvidence(value, m.currency)
              currencyMatches = moneyFields(value).currency === m.currency
            } catch {}
            const amount = value?.[m.cost],
              cost =
                currencyMatches &&
                typeof amount === 'number' &&
                Number.isFinite(amount) &&
                amount >= 0
                  ? amount
                  : null
            budget.settle(id, cost, id + ':completed', {
              currency: m.currency,
              provider: descriptor.id,
              costEvidence: currencyMatches ? (value?.costEvidence ?? null) : null,
              ...(currencyMatches ? {} : { refusedCurrencyEvidence: value ?? null }),
            })
            settled = true
            if (!currencyMatches)
              fail(
                'DUO_CURRENCY_MISMATCH',
                'Provider returned a different currency; reservation remains unknown',
              )
            if (cost === null)
              fail('DUO_COST_UNKNOWN', 'Provider did not return complete cost evidence')
            if (value?.error)
              throw Object.assign(
                new Error(value.error.message ?? 'Provider refused after settling its usage'),
                value.error,
              )
            return value
          },
          (error) => {
            budget.settle(id, null, id + ':failed', { provider: descriptor.id })
            settled = true
            throw error
          },
        )
      const tracked = work
        .then(
          () => {},
          () => {},
        )
        .finally(() => {
          releaseCall()
          this.pendingCalls.delete(tracked)
        })
      this.pendingCalls.add(tracked)
      let onAbort
      const cancelled = new Promise((_, reject) => {
        onAbort = () => {
          try {
            fail('ABORTED', 'Native provider call interrupted')
          } catch (e) {
            reject(e)
          }
        }
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      })
      try {
        return await Promise.race([work, cancelled])
      } catch (error) {
        if (!settled && signal.aborted)
          budget.settle(id, null, id + ':interrupted', { provider: descriptor.id })
        throw error
      } finally {
        signal.removeEventListener('abort', onAbort)
      }
    }
    const evaluate = async (candidate, tier) => {
      const applied = freeze(clone(candidate)),
        d = providers.evaluators.find((e) => e.tier === tier),
        objective = spec[tier]
      const executed = await invoke(
        'evaluation',
        tier,
        providers.executor,
        () => this.ctx.duoExecutor.execute({ candidate: applied, applied, tier, signal }),
        { candidateId: candidate.id, tier, step: 'execute' },
      )
      const result = await invoke(
        'evaluation',
        null,
        d,
        () =>
          this.ctx.duoEvaluators.evaluate({
            candidate: applied,
            artifact: executed.artifact,
            tier,
            signal,
          }),
        { candidateId: candidate.id, tier, step: 'evaluate' },
      )
      if (
        result.candidateId !== candidate.id ||
        result.evaluatorId !== objective.evaluatorId ||
        result.version !== objective.version ||
        result.dataId !== objective.dataId ||
        result.tier !== tier ||
        typeof result.ok !== 'boolean' ||
        !result.metrics
      )
        fail(
          'DUO_EVIDENCE_INVALID',
          'Evaluator result identity or shape differs from the frozen contract',
        )
      j.append({ kind: 'evidence_acquired', receipt: evidenceReceipt(d, result) })
      // Preserve each settled measurement before the next provider can fail.
      // This records an observation, without granting promotion or adoption.
      if (tier !== 'final') record(candidate, { [tier]: result })
      if (candidate.id === plan.baseline.id) baselineTiers.add(tier)
      consecutiveEvaluationFailures = result.ok ? 0 : consecutiveEvaluationFailures + 1
      if (
        spec.stopping?.maxConsecutiveEvaluationFailures !== undefined &&
        consecutiveEvaluationFailures >= spec.stopping.maxConsecutiveEvaluationFailures
      ) {
        // Retain the observation that reaches the cap before stopping. Provider
        // exceptions and unknown costs still stop immediately in invoke().
        if (tier === 'final') {
          final.push(freeze(clone(result)))
          j.append({ kind: 'final', results: clone(final) })
        } else record(candidate, { status: 'error', [tier]: result })
        fail(
          'DUO_EVALUATION_FAILURE_LIMIT',
          'Configured consecutive evaluation failures reached; no further work admitted',
        )
      }
      return freeze(clone(result))
    }
    const compare = (results, tier, incumbentId) =>
      this.ctx.duoComparator.compare(
        results,
        {
          weights: spec[tier].weights,
          epsilon: spec.epsilon,
          minSamples: spec.minSamples,
          constraints: spec.constraints,
        },
        incumbentId,
      )
    const assessIncumbent = (candidate, evidence, tier) => {
      const comparison = compare([evidence], tier, null),
        verdict = comparison.verdicts[candidate.id],
        searchAllowed = ['better', 'constraint_violation'].includes(verdict),
        reason =
          verdict === 'constraint_violation'
            ? 'VALID_MEASUREMENT_REQUIRES_QUALITY_REPAIR'
            : searchAllowed
              ? 'QUALITY_CONSTRAINTS_MET'
              : 'UNUSABLE_BASELINE_EVIDENCE'
      j.append({
        kind: candidate.id === plan.baseline.id ? 'baseline_assessment' : 'incumbent_assessment',
        candidateId: candidate.id,
        tier,
        verdict,
        searchAllowed,
        reason,
        comparison,
      })
      if (!evaluationOnly && !searchAllowed)
        fail(
          'DUO_BASELINE_INVALID',
          'Baseline has unusable ' +
            tier +
            ' evidence; inspect baselineAssessment before repairing the evaluator or inputs',
        )
    }
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
        let eligible = candidates
        const measured = new Map(candidates.map((c) => [c.id, {}])),
          observations = new Map(candidates.map((c) => [c.id, []]))
        const decide = (
          candidate,
          comparison,
          tier,
          next,
          selected,
          affordability,
          terminalSelected = false,
          selectedCandidateId = null,
        ) => {
          const r = measured.get(candidate.id)[tier],
            option = plan.evidenceStrategy.additional_options.find((o) => o.tier === tier)
          const ownReceipt = evidenceReceipt(
              providers.evaluators.find((d) => d.tier === tier),
              r,
            ),
            incumbentReceipt = evidenceReceipt(
              providers.evaluators.find((d) => d.tier === tier),
              championEvidence[tier],
            )
          const coverageConfirmed = option?.available
            ? option.addedCoverage.every(
                (k) => ownReceipt.coverage.includes(k) && incumbentReceipt.coverage.includes(k),
              )
            : null
          observations.get(candidate.id).push({ tier, result: r, comparison, coverageConfirmed })
          const input = { candidateId: candidate.id, observations: observations.get(candidate.id) }
          const aggregate =
            typeof this.ctx.duoComparator.aggregate === 'function'
              ? this.ctx.duoComparator.aggregate(freeze(clone(input)))
              : aggregateJudgments(input)
          const request = freeze(
            clone({
              candidateId: candidate.id,
              aggregate,
              next,
              selected,
              affordability,
              terminalSelected,
            }),
          )
          let d =
            typeof this.ctx.duoGate.decide === 'function'
              ? this.ctx.duoGate.decide(request)
              : decideEvidence(request)
          if (
            !d ||
            !['reject', 'hold', 'promote', 'request_more_evidence', 'stop'].includes(d.action) ||
            typeof d.reason !== 'string' ||
            !d.reason ||
            !Array.isArray(d.evidence_gaps) ||
            !d.basis ||
            (d.action === 'request_more_evidence' &&
              (!selected ||
                !next?.available ||
                affordability.remaining < 1 ||
                d.request?.tier !== next.tier)) ||
            (d.action === 'promote' &&
              (next ||
                !['better', 'not_better'].includes(comparison.verdicts[candidate.id]) ||
                coverageConfirmed === false))
          )
            fail(
              'DUO_EVIDENCE_DECISION_INVALID',
              'Policy decision must reference current comparable evidence and an admitted planned acquisition; it cannot bypass budget or coverage',
            )
          // A policy permits promotion; the lifecycle has one terminal slot.
          // Preserve the proposal when rank-based arbitration consumes that slot.
          if (d.action === 'promote' && selectedCandidateId)
            d = {
              ...d,
              action: 'hold',
              reason: 'ANOTHER_CANDIDATE_SELECTED',
              policyProposal: { action: d.action, reason: d.reason },
              selectedCandidateId,
              basis: {
                ...d.basis,
                inference: [
                  ...(d.basis.inference ?? []),
                  'A higher-ranked policy-admissible candidate occupies the terminal slot',
                ],
              },
            }
          if (d.action === 'stop') {
            searchStopped = true
            stopReason = 'evidence_policy_stop'
          }
          j.append({
            kind: 'evidence_decision',
            candidateId: candidate.id,
            generation,
            policy: providers.policies.duoGate,
            decision: clone(d),
          })
          return d
        }
        for (const [index, stage] of stages.entries()) {
          if (!eligible.length || searchStopped) break
          const { tier } = stage,
            results = []
          if (!championEvidence[tier]) {
            championEvidence[tier] = await evaluate(champion, tier)
            assessIncumbent(champion, championEvidence[tier], tier)
          }
          for (const c of eligible) {
            const r = await evaluate(c, tier)
            results.push(r)
            measured.get(c.id)[tier] = r
            record(c, { status: r.ok ? tier + '_evaluated' : 'error', [tier]: r })
          }
          const comparison = compare([championEvidence[tier], ...results], tier, champion.id)
          j.append({ kind: 'comparison', tier, generation, comparison })
          for (const c of [champion, ...eligible])
            record(c, {
              [tier + 'Score']: comparison.scores[c.id] ?? null,
              [tier + 'Verdict']: comparison.verdicts[c.id],
              [tier + 'Rank']: comparison.ranking.indexOf(c.id),
            })
          const next = stages[index + 1]
          if (!next) {
            let id = comparison.ranking.find(
              (id) => id !== champion.id && comparison.verdicts[id] === 'better',
            )
            if (strategic) {
              id = null
              const byId = new Map(eligible.map((c) => [c.id, c]))
              const ordered = [
                ...comparison.ranking.filter((key) => byId.has(key)),
                ...eligible
                  .map((c) => c.id)
                  .filter((key) => !comparison.ranking.includes(key))
                  .sort(),
              ]
              for (const candidateId of ordered) {
                if (searchStopped) break
                const c = byId.get(candidateId)
                const decision = decide(
                  c,
                  comparison,
                  tier,
                  null,
                  false,
                  null,
                  !id && comparison.verdicts[c.id] === 'better',
                  id,
                )
                record(c, {
                  status:
                    decision.action === 'promote'
                      ? 'champion'
                      : decision.action === 'reject'
                        ? 'rejected'
                        : 'held',
                  slowDecision:
                    decision.action === 'promote'
                      ? 'accepted'
                      : decision.action === 'reject'
                        ? 'rejected'
                        : 'held',
                })
                if (decision.action === 'promote' && !id) id = c.id
              }
            }
            if (stages.length > 1 && !strategic)
              for (const c of eligible)
                record(c, {
                  status:
                    c.id === id
                      ? 'champion'
                      : comparison.verdicts[c.id] === 'not_better'
                        ? 'rejected'
                        : 'held',
                  slowDecision:
                    c.id === id
                      ? 'accepted'
                      : comparison.verdicts[c.id] === 'not_better'
                        ? 'rejected'
                        : comparison.verdicts[c.id] === 'better'
                          ? 'held'
                          : 'incomparable',
                })
            if (id) {
              champion = eligible.find((c) => c.id === id)
              championEvidence = measured.get(id)
            }
            break
          }
          const snapshot = budget.snapshot(),
            legacyRemaining = Math.max(
              0,
              Math.min(
                next.maxEvaluations - stageAttempts[next.tier],
                spec.budget.maxSlowEvals - snapshot.slowAttempts - (spec.final ? 2 : 0),
              ),
            )
          const affordability = strategic
            ? affordableAcquisitions({
                snapshot,
                limits: spec.budget,
                executor: providers.executor,
                evaluator: providers.evaluators.find((d) => d.tier === next.tier),
                stageRemaining: next.maxEvaluations - stageAttempts[next.tier],
                evaluationRemaining:
                  spec.budget.maxSlowEvals - snapshot.slowAttempts - (spec.final ? 2 : 0),
                baselineNeeded: !championEvidence[next.tier],
                finalReserved: spec.final ? 2 : 0,
              })
            : null
          const remaining = strategic ? affordability.remaining : legacyRemaining
          const gateLimits = {
            topK: stage.topK,
            remaining,
            incumbentId: champion.id,
            epsilon: spec.epsilon,
          }
          let promoted = this.ctx.duoGate.select(
            comparison,
            eligible.map((c) => c.id),
            gateLimits,
          )
          if (
            !Array.isArray(promoted) ||
            new Set(promoted).size !== promoted.length ||
            promoted.length > Math.min(stage.topK, remaining) ||
            promoted.some(
              (id) =>
                !eligible.some((c) => c.id === id) ||
                !['better', 'not_better'].includes(comparison.verdicts[id]),
            )
          )
            fail(
              'DUO_GATE_INVALID',
              'Gate must select unique valid candidate evidence within the frozen limits',
            )
          if (strategic) {
            const nextOption = plan.evidenceStrategy.additional_options.find(
                (o) => o.tier === next.tier,
              ),
              admitted = []
            for (const c of eligible) {
              const chosen =
                promoted.includes(c.id) ||
                (remaining === 0 && comparison.verdicts[c.id] === 'better')
              const decision = decide(c, comparison, tier, nextOption, chosen, affordability)
              if (decision.action === 'request_more_evidence') admitted.push(c.id)
              else record(c, { status: decision.action === 'reject' ? 'rejected' : 'held' })
            }
            promoted = admitted
          }
          j.append({
            kind: 'gate',
            generation,
            fromTier: tier,
            toTier: next.tier,
            policy: providers.policies.duoGate,
            limits: gateLimits,
            considered: eligible.map((c) => c.id),
            selected: promoted.map((candidateId) => ({
              candidateId,
              verdict: comparison.verdicts[candidateId],
              score: comparison.scores[candidateId],
              reason:
                comparison.verdicts[candidateId] === 'better'
                  ? index === 0
                    ? 'FAST_BETTER'
                    : 'STAGE_BETTER'
                  : Math.abs(comparison.scores[candidateId] - comparison.scores[champion.id]) <=
                      spec.epsilon
                    ? 'WITHIN_EPSILON_DEEPER_TEST'
                    : 'PROVIDER_DEEPER_TEST',
            })),
          })
          eligible = promoted.map((id) => eligible.find((c) => c.id === id))
        }
        const stopped = searchStopped || finishGeneration(generation, previousVersion),
          paused = boundary('generation', generation + 1, stopped)
        if (paused) return paused
        if (stopped) break
      }
      const noFeasibleCandidate =
        champion.id === plan.baseline.id &&
        Object.values(baselineAssessment()).some((a) => a.verdict === 'constraint_violation')
      let conclusion =
        spec.mode === 'optimize' && champion.id === plan.baseline.id && !noFeasibleCandidate
          ? 'retain_baseline'
          : 'insufficient_evidence'
      let independentFinal = null
      if (spec.final && spec.mode !== 'explore' && stopReason !== 'evidence_policy_stop') {
        for (const c of champion.id === plan.baseline.id
          ? [plan.baseline]
          : [plan.baseline, champion])
          final.push(await evaluate(c, 'final'))
        j.append({ kind: 'final', results: final })
        const cmp = compare(final, 'final', plan.baseline.id)
        const admitted = final.every(
          (r) =>
            ['better', 'not_better'].includes(cmp.verdicts[r.candidateId]) ||
            (r.candidateId === plan.baseline.id &&
              champion.id !== plan.baseline.id &&
              cmp.verdicts[r.candidateId] === 'constraint_violation'),
        )
        const finalConclusion = !admitted
          ? 'insufficient_evidence'
          : champion.id !== plan.baseline.id && cmp.verdicts[champion.id] === 'better'
            ? 'recommend_candidate'
            : 'retain_baseline'
        const reusedHistory = plan.warmStart?.mode === 'warm_start',
          qualifiedConclusion =
            reusedHistory && finalConclusion === 'recommend_candidate'
              ? 'insufficient_evidence'
              : finalConclusion
        if (!evaluationOnly)
          independentFinal = {
            conclusion: qualifiedConclusion,
            comparison: cmp,
            ...(reusedHistory
              ? {
                  observedConclusion: finalConclusion,
                  independence: 'NOT_ESTABLISHED',
                  dataReview: clone(plan.warmStart.finalDataReview),
                }
              : {}),
          }
        if (spec.mode === 'optimize' && !noFeasibleCandidate) conclusion = qualifiedConclusion
      }
      result = {
        apiVersion: 2,
        runtime: 'dsh-native',
        runId,
        planDigest: plan.planDigest,
        status: 'completed',
        mode: spec.mode,
        stopReason,
        generationsRun,
        championId: spec.mode === 'optimize' && !noFeasibleCandidate ? champion.id : null,
        proxyLeaderId: spec.mode === 'fast_only' && !noFeasibleCandidate ? champion.id : null,
        ...(!evaluationOnly
          ? {
              selectionOutcome: noFeasibleCandidate
                ? 'no_feasible_candidate'
                : champion.id === plan.baseline.id
                  ? 'baseline_retained'
                  : 'feasible_candidate',
            }
          : {}),
        conclusion,
        selectedOverlay: champion.id === plan.baseline.id ? null : champion.delta,
        final,
        independentFinal,
        improvementProven: false,
        evidenceKind: providers.evaluators.every(
          (d) => d.evidenceKind === providers.evaluators[0]?.evidenceKind,
        )
          ? (providers.evaluators[0]?.evidenceKind ?? 'unknown')
          : 'mixed_declared',
        budget: budget.snapshot(),
        reusedArtifacts: false,
      }
      if (evaluationOnly) {
        const evaluations = [...stages.map((s) => championEvidence[s.tier]), ...final].filter(
          Boolean,
        )
        Object.assign(result, {
          operation: 'evaluate',
          stopReason: 'evaluation_complete',
          championId: null,
          conclusion: evaluations.every((r) => r.ok) ? 'retain_baseline' : 'insufficient_evidence',
          evaluations,
          measurementChecks: Object.fromEntries(
            evaluations.map((r) => [r.tier, compare([r], r.tier, null)]),
          ),
          limitations: [
            'Evaluation-only measures the current target; no search or candidate improvement was attempted.',
            'Retaining the target is not a claim that its constraints or quality passed; inspect measurementChecks.',
          ],
        })
      }
    } catch (error) {
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
