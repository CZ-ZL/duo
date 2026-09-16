// Runnable local text-hygiene example. Measures the supplied text itself; it
// does not simulate model answers or establish Agent task-quality improvement.
import { GeneratorService, ExecutorService } from '@dual-loop/dsh-plugin/definitions'
import FunctionEvaluators from '@dual-loop/dsh-plugin/function-evaluators'
export const name = 'duo-local-text-example'
export const cost = { currency: 'CNY', costCny: 0 }
export const descriptor = (id) => ({
  id,
  version: '1',
  currency: 'CNY',
  reservationCny: 0,
  permissions: { paid: false, network: false, externalSideEffects: false },
  evidenceKind: 'local_text_measurement',
})
export function evaluateText({ artifact, tier }, expanded = false) {
  const lines = artifact.text.split('\n'),
    clean = lines.filter((line) => !/\s+$/.test(line)).length
  const boundary = artifact.text.includes('{{model}}') && artifact.text.includes('{{cwd}}'),
    extra = expanded && tier === 'slow'
  return {
    ok: true,
    evidenceCoverage: ['line-end-whitespace', ...(extra ? ['required-template'] : [])],
    metrics: {
      quality: extra ? (clean / lines.length + Number(boundary)) / 2 : clean / lines.length,
      safe: artifact.text.trim().length > 0,
      sample_size: lines.length,
    },
    ...cost,
    evidence: [
      {
        kind: 'local_trailing_whitespace_check',
        lines: lines.length,
        cleanLines: clean,
        hostPid: process.pid,
        ...(extra ? { boundary } : {}),
      },
    ],
  }
}
export const descriptors = (expanded = false) =>
  ['fast', 'slow', 'final'].map((tier) => ({
    ...descriptor('local-' + tier),
    tier,
    dataId: 'local-text-' + tier,
    metrics: ['quality', 'safe', 'sample_size'],
    evidenceSource: {
      measurement:
        'Line-end whitespace' +
        (expanded && tier === 'slow' ? ' and required template placeholders' : ''),
      targetKinds: ['dsh-persona', 'local-text'],
      family: 'text_hygiene',
      coverage: [
        'line-end-whitespace',
        ...(expanded && tier === 'slow' ? ['required-template'] : []),
      ],
      dataScope: {
        id: 'target-text-checks',
        purpose: tier === 'final' ? 'final' : 'search',
        description: 'Current applied target text, no model task output',
      },
      independentOfSearch: false,
      realTools: false,
      deterministic: true,
      requiresModel: false,
      approximateCost: { currency: 'CNY', amount: 0 },
      latencyMs: null,
      sideEffects: 'none',
      ...(expanded && tier === 'slow'
        ? {
            increment: {
              relativeTo: { id: 'local-fast', version: '1', dataId: 'local-text-fast' },
              kind: 'expanded_evidence',
              reason: 'Additionally execute required template placeholder assertions.',
            },
          }
        : {}),
    },
    configDigest: 'local-text-v1',
    evidenceFamily: 'text_hygiene',
    qualification: 'LOCAL_FORMAT_MEASUREMENT_ONLY',
    independentData: false,
    fidelityRationale:
      'Repeated text checks do not establish higher fidelity or independent generalization.',
    metricDefinitions: {
      quality: {
        meaning:
          expanded && tier === 'slow'
            ? 'Mean of clean-line fraction and required template assertion'
            : 'Fraction of lines without trailing whitespace',
        direction: 'maximize',
        unit: 'fraction',
        purpose: 'format',
        construct: 'format',
        lowerBound: 0,
        upperBound: 1,
      },
    },
  }))
export async function apply(ctx, config = {}) {
  class Generator extends GeneratorService {
    describe() {
      return {
        ...descriptor('local-trim-generator'),
        targetKinds: ['dsh-persona'],
        configDigest: 'trim-line-ends-v1',
      }
    }
    async propose({ champion, quotas, nextId, feedback }) {
      // Historical ideas reach this deterministic generator and are recorded;
      // it has one documented transformation, not a research search algorithm.
      const sources = (feedback.warmStart?.records ?? []).map((r) => r.source.candidateId)
      return {
        ...cost,
        candidates: Object.entries(quotas).flatMap(([mode, n]) =>
          Array.from({ length: n }, () => ({
            id: nextId(),
            parentId: champion.id,
            parentVersion: champion.version,
            mode,
            family: 'trim-line-ends',
            hypothesis:
              'Remove trailing whitespace while preserving text and placeholders.' +
              (sources.length ? ' Historical ideas received: ' + sources.join(', ') + '.' : ''),
            delta: {
              kind: 'cordis-overlay',
              target: 'system-prompt',
              persona: champion.persona
                .split('\n')
                .map((line) => line.trimEnd())
                .join('\n'),
            },
          })),
        ),
        artifact: { kind: 'deterministic_transformation', historyCandidateIds: sources },
      }
    }
  }
  class Executor extends ExecutorService {
    describe() {
      return {
        ...descriptor('local-text-executor'),
        targetKinds: ['dsh-persona'],
        configDigest: 'text-pass-through-v1',
      }
    }
    async execute({ applied, signal }) {
      signal?.throwIfAborted()
      return { ...cost, artifact: { text: applied.persona } }
    }
  }
  if (config.generator !== false) await ctx.plugin(Generator)
  await ctx.plugin(Executor)
  if (config.evaluators !== false)
    await ctx.plugin(FunctionEvaluators, {
      evaluate: (args) => evaluateText(args, config.expandedEvidence === true),
      descriptors: descriptors(config.expandedEvidence === true),
      implementationDigest: 'local-text-check-v1',
      dataDigest: 'target-text-local-only-v1',
    })
}
