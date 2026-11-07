// Run doctor service: in-loop guard for headless optimization. Consults the
// retained journal after the baseline assessment and at every generation
// boundary; a stop-severity verdict halts the run with an auditable diagnosis
// instead of quietly burning budget on a lying metric or a flat landscape.
// Optional: runs without it behave exactly as before (the controller consults
// via optional chaining).
import { Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { analyzeEvents } from './run-doctor.js'

export class RunDoctor extends Service {
  static Config = Schema.object({
    enabled: Schema.boolean().default(true),
    driftStop: Schema.number().default(0.5),
    driftWarn: Schema.number().default(0.2),
    flatMinEvals: Schema.number().default(5),
  })
  constructor(ctx, config) {
    super(ctx, 'duoDoctor')
    this.options = config
  }
  describe() {
    return {
      id: 'duo-run-doctor',
      version: '1',
      permissions: { paid: false, network: false, externalSideEffects: false },
      evidenceKind: 'deterministic-real-output',
    }
  }
  // Consult the journal; returns { overall, checks } when any check fires,
  // null when clean or disabled. Purely read-only over retained facts.
  consult(events, spec) {
    if (this.options.enabled === false) return null
    const report = analyzeEvents(events, {
      driftStop: this.options.driftStop,
      driftWarn: this.options.driftWarn,
      flatMinEvals: this.options.flatMinEvals,
      baselineId: spec?.baseline?.id ?? null,
    })
    return report.checks.length ? { severity: report.overall, ...report } : null
  }
}

export default RunDoctor
