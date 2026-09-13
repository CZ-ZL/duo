import type {Context} from '@deepseek-ai/cordis'
import {EvaluatorsService, type EvaluatorDescriptor, type EvaluateRequest, type Evaluation, type Cost, type Metrics, type StructuredError} from './definitions.js'
export type FunctionFacts = Cost & {ok: boolean; metrics: Metrics; evidence?: unknown[]; error?: StructuredError | null}
export interface FunctionEvaluatorConfig {
 descriptors: (EvaluatorDescriptor & {currency: 'CNY'; reservationCny: number; evidenceFamily: string; fidelityRationale: string})[];
 implementationDigest: string; dataDigest: string;
 evaluate(request: EvaluateRequest): Promise<FunctionFacts> | FunctionFacts;
}
export interface EvaluatorControl {
 id: string; purpose: 'control'; artifact: Record<string, unknown>; expectedMetrics: Metrics;
}
/** Only checks supplied controls. maxInvocations bounds callback invocations,
 * not undisclosed requests inside caller-owned callbacks. No automatic retries. */
export function createControlEvaluation(config: {
 evaluate: FunctionEvaluatorConfig['evaluate']; controls: EvaluatorControl[];
 discriminationMetric: string; reservationCnyPerCase: number;
}): Readonly<{controlsDigest: string; maxInvocations: number; reservationCny: number;
 evaluate: FunctionEvaluatorConfig['evaluate']}>
export default class FunctionEvaluators extends EvaluatorsService {
 constructor(ctx: Context, config: FunctionEvaluatorConfig);
 describe(): EvaluatorDescriptor[];
 evaluate(request: EvaluateRequest): Promise<Evaluation>;
}
