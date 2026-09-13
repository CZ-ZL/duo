import {Service, type Context} from '@deepseek-ai/cordis'

// Search stage tier names are caller-declared in the contract's ordered
// credibility ladder (one or more stages, uncapped; ^[a-z][a-z0-9_]{0,31}$);
// legacy contracts use the fixed names fast/review/slow. 'final' stays outside
// the search ladder.
export type SearchTier = string
export type Tier = SearchTier | 'final'
export type Mode = 'exploit' | 'explore' | 'innovate'
export type Metrics = Record<string, number | boolean>
export interface Permissions {paid: boolean; network: boolean; externalSideEffects: boolean}
export type Cost = {currency: 'CNY'; costCny: number | null; costEvidence?: unknown}
  | {currency?: 'USD'; costUsd: number | null; costEvidence?: unknown}
export type Reservation = {currency: 'CNY'; reservationCny: number}
  | {currency?: 'USD'; reservationUsd: number}
export interface PolicyDescriptor {id: string; version: string; deterministic: true; [key: string]: unknown}
export type WorkDescriptor = Reservation & {id: string; version: string; permissions: Permissions;
  evidenceKind?: string; configDigest?: string; maxRequests?: number; [key: string]: unknown}
export interface MetricDefinition {meaning?: string; direction?: 'maximize' | 'minimize'; unit?: string;
  purpose?: 'format' | 'hard_constraint' | 'ranking' | 'final_confirmation';
  construct?: 'format' | 'task_result' | 'cost'; lowerBound?: number; upperBound?: number}
export type EvaluatorDescriptor = WorkDescriptor & {tier: Tier; dataId: string; metrics: string[];
  evidenceFamily?: string; fidelityRationale?: string; qualification?: string; metricDefinitions?: Record<string, MetricDefinition>}
export interface Delta {kind: 'cordis-overlay'; target: 'system-prompt'; persona: string}
export interface Snapshot {id: string; version: string; persona: string; path?: string}
export interface Candidate {id: string; parentId: string; parentVersion: string; family: string;
  mode: Mode; hypothesis: string; delta: Delta; operatorId?: string; hypothesisBeforeDelta?: boolean;
  repeat?: {purpose: 'noise_measurement'; reason: string}}
export type AppliedCandidate = Candidate & Snapshot
export type Quotas = Record<Mode, number>
export interface StructuredError {code: string; message?: string; component: string;
  retryable: boolean; nextAction: string; recoveryCondition?: string}
export type Evaluation = Cost & {candidateId: string; evaluatorId: string; version: string;
  dataId: string; tier: Tier; ok: boolean; metrics: Metrics; evidence?: unknown[]; error?: StructuredError | null}
export interface ComparisonSpec {weights: Record<string, number>; epsilon: number; minSamples: number;
  constraints: {metric: string; op: '==' | '!=' | '>' | '>=' | '<' | '<='; value: number | boolean}[]}
export interface Objective {evaluatorId: string; version: string; dataId: string; metric: string;
  direction: 'maximize' | 'minimize'; weights: Record<string, number>}
export interface SearchStage extends Objective {tier: Exclude<Tier, 'final'>;
  purpose: 'screen' | 'rank' | 'confirm'; informationGain: string; maxEvaluations: number; topK: number}
export interface Comparison {ranking: string[]; scores: Record<string, number>;
  verdicts: Record<string, 'better' | 'not_better' | 'incomparable' | 'constraint_violation'>; comparatorId: string;
  exclusions?: Record<string, {code: string; reason: string; scope: Record<string, string>}>}
export interface Feedback {quotas: Quotas; evidence: string; history?: Record<string, unknown>[];
  historyCompleteness?: 'all_latest_candidates'; [key: string]: unknown}
export interface ProposeRequest {champion: Snapshot; feedback: Feedback; quotas: Quotas;
  generation: number; nextId(): string; signal?: AbortSignal}
export interface ExecuteRequest {candidate: Snapshot | AppliedCandidate; applied: Snapshot | AppliedCandidate;
  tier: Tier; signal?: AbortSignal}
export interface EvaluateRequest {candidate: Snapshot | AppliedCandidate; artifact: unknown;
  tier: Tier; signal?: AbortSignal}
export type GenerationResult = Cost & {candidates: Candidate[] | null; artifact?: unknown; error?: StructuredError | null}
export type ExecutionResult = Cost & {artifact: unknown; error?: StructuredError | null}
export interface Plan {apiVersion: 2; runtime: 'dsh-native'; planDigest: string; runId: string;
  spec: Record<string, unknown>; baseline: Snapshot; providers: Record<string, unknown>; [key: string]: unknown}
export interface RunResult {apiVersion: 2; runId: string; status: 'completed' | 'failed' | 'cancelled' | 'paused';
  conclusion: 'recommend_candidate' | 'retain_baseline' | 'insufficient_evidence'; improvementProven: boolean;
  budget: Record<string, unknown>; final: Evaluation[]; [key: string]: unknown}
export interface RunStatus {apiVersion: 2; runId: string; run: unknown; result: RunResult | null;
  budget: Record<string, unknown> | null; events: Record<string, unknown>[]; checkpoint?: Record<string, unknown> | null}

export function fail(code: string, message: string): never
export function required(): never
export function assertProviderMethods(service: unknown, component: string, methods: string[]): void
export abstract class ContractService extends Service {constructor(ctx: Context); abstract resolve(): {spec: Record<string, unknown>; contractPath: string; contractDigest: string}}
export abstract class TargetService extends Service {constructor(ctx: Context); abstract describe(): PolicyDescriptor; abstract snapshot(path: string): Snapshot; abstract apply(candidate: Candidate, parent: Snapshot): AppliedCandidate}
export abstract class ComparatorService extends Service {constructor(ctx: Context); abstract describe(): PolicyDescriptor; abstract compare(results: Evaluation[], spec: ComparisonSpec, incumbentId?: string | null): Comparison}
export abstract class GateService extends Service {constructor(ctx: Context); abstract describe(): PolicyDescriptor; abstract select(comparison: Comparison, candidateIds: string[], limits: {topK: number; remaining: number; incumbentId?: string; epsilon?: number}): string[]}
export abstract class FeedbackService extends Service {constructor(ctx: Context); abstract describe(): PolicyDescriptor; abstract summarize(entries: Record<string, unknown>[], quotas: Quotas, options?: Record<string, unknown>): Feedback; orderHistory?(screenedRecords: Record<string, unknown>[]): number[]}
export abstract class JournalService extends Service {constructor(ctx: Context); root: string; abstract describe(): PolicyDescriptor; abstract open(runId: string, options?: {create?: boolean}): unknown}
// Cross-run accounting summary attached to every budget snapshot. The cap is
// read from the inspected run's own frozen ledger; known cost sums settled
// operations across all retained runs in the same journal root.
export interface CumulativeBudget {currency: 'CNY' | 'USD'; knownCostCny?: number; knownCostUsd?: number;
  maxCumulativeCostCny?: number | null; maxCumulativeCostUsd?: number | null; excludedCurrencies: ('CNY' | 'USD')[]}
export interface ReconcileOutcome {outcome: 'applied' | 'already-settled' | 'unknown-receipt' | 'rejected';
  receiptHash: string; operationId?: string | null; status?: 'reserved' | 'unknown' | 'settled' | null;
  overrun?: boolean; reason: string | null; code?: string; budget: Record<string, unknown>}
export abstract class BudgetService extends Service {constructor(ctx: Context); abstract describe(): PolicyDescriptor; abstract open(runId: string, limits: Record<string, unknown>, tiers?: string[]): unknown; abstract inspect(runId: string): Record<string, unknown> | null; abstract reconcile(runId: string, receiptHash: string): ReconcileOutcome; abstract cumulativeKnownCost(currency: 'CNY' | 'USD'): {knownCostUnits: number; runs: number; excludedCurrencies: ('CNY' | 'USD')[]}}
export abstract class GeneratorService extends Service {constructor(ctx: Context); abstract describe(): WorkDescriptor; abstract propose(request: ProposeRequest): Promise<GenerationResult>}
export abstract class ExecutorService extends Service {constructor(ctx: Context); abstract describe(): WorkDescriptor; abstract execute(request: ExecuteRequest): Promise<ExecutionResult>}
export abstract class EvaluatorsService extends Service {constructor(ctx: Context); abstract describe(): EvaluatorDescriptor[]; abstract evaluate(request: EvaluateRequest): Promise<Evaluation>}
export abstract class ControllerService extends Service {constructor(ctx: Context); abstract plan(): Plan; abstract run(args: {planDigest: string; signal?: AbortSignal; pauseAfter?: 'baseline' | 'generation'; resumeFrom?: string}): Promise<RunResult>; abstract status(runId: string): RunStatus}
export abstract class ObserverService extends Service {constructor(ctx: Context); abstract describe(): PolicyDescriptor; abstract report(runId: string): Record<string, unknown>}

declare module '@deepseek-ai/cordis' {
 interface Context {duoContract: ContractService; duoTarget: TargetService; duoComparator: ComparatorService;
  duoGate: GateService; duoFeedback: FeedbackService; duoJournal: JournalService; duoBudget: BudgetService;
  duoGenerator: GeneratorService; duoExecutor: ExecutorService; duoEvaluators: EvaluatorsService;
  duoController: ControllerService; duoObserver: ObserverService}
}
