import test from 'node:test'
import assert from 'node:assert/strict'
import {buildReport} from './observer.js'
import NativeObserver from './observer.js'
import * as ObserverTools from './observer-tools.js'
import {ControllerService} from './definitions.js'
import {Context} from '@deepseek-ai/cordis'
import Tools from '@deepseek-ai/dsh-tools'
import Agents from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
function history(){return {
 apiVersion:2,runId:'run',run:{status:'completed'},budget:{currency:'CNY',costCny:.02,knownCostCny:.02},
 result:{status:'completed',mode:'optimize',championId:'baseline',conclusion:'retain_baseline',improvementProven:false,
  final:[{candidateId:'baseline',tier:'final',ok:true,metrics:{quality:1},evaluatorId:'final',version:'1',dataId:'heldout'}]},
 events:[{kind:'plan',plan:{spec:{mode:'optimize',fast:{metric:'quality'},slow:{metric:'quality'},final:{metric:'quality'}},providers:{}}},
  {kind:'candidate',candidateId:'baseline',candidate:{id:'baseline',version:'base'},status:'champion',fast:{ok:true,metrics:{quality:.75}},slow:{ok:true,metrics:{quality:.75}}},
  {kind:'candidate',candidateId:'c1',candidate:{id:'c1',parentId:'baseline',parentVersion:'base',version:'one',delta:{persona:'change'}},generation:1,hypothesis:'try change',fast:{ok:true,metrics:{quality:.75}},status:'fast_evaluated'},
  {kind:'comparison',tier:'fast',comparison:{ranking:['baseline','c1'],scores:{baseline:.75,c1:.75},verdicts:{baseline:'not_better',c1:'not_better'}}}]
}}
test('observer distinguishes a tied candidate without Slow/final from baseline final=1',()=>{
 const source=history(),before=structuredClone(source),r=buildReport(source)
 assert.equal(r.candidates.length,2)
 const b=r.candidates.find(c=>c.id==='baseline'),c=r.candidates.find(c=>c.id==='c1')
 assert.equal(b.final.metrics.quality,1);assert.equal(c.slow.state,'NOT_PROMOTED')
 assert.equal(c.final.state,'NOT_SELECTED_FOR_FINAL');assert.equal(c.final.metrics,null)
 assert.equal(c.parentId,'baseline');assert.equal(c.hypothesis,'try change')
 assert.equal(r.improvementProven,false);assert.equal(r.health.costPerSlowAcceptedCandidate,null)
 assert.match(r.text,/NOT_PROMOTED/);assert.deepEqual(source,before)
})
test('selected tie with an unfinished Slow call is not mislabeled as unpromoted',()=>{
 const source=history();source.events.push({kind:'gate',toTier:'slow',selected:[{candidateId:'c1',reason:'WITHIN_EPSILON_DEEPER_TEST'}]})
 source.result.status='failed'
 const row=buildReport(source).candidates.find(c=>c.id==='c1')
 assert.equal(row.slow.state,'NOT_EVALUATED');assert.match(row.slow.reason,/Selected for deeper evaluation/)
 assert.equal(row.slow.metrics,null)
})
test('late unknown accounting wins over an old terminal total and stays unknown in report',()=>{
 const source=history();source.result.budget={currency:'CNY',costCny:0};source.budget={currency:'CNY',costCny:null,knownCostCny:.02,reservedCostCny:.1}
 const r=buildReport(source);assert.equal(r.budget.costCny,null);assert.match(r.text,/unknown/)
})
test('report availability is distinct from execution success and observed Caller delivery',()=>{
 const source=history(),before=structuredClone(source),r=buildReport(source)
 assert.equal(r.delivery.execution.state,'completed');assert.equal(r.delivery.execution.terminal,true)
 assert.equal(r.delivery.artifacts.state,'REPORT_RENDERED');assert.equal(r.delivery.artifacts.modelRequestsRequired,0)
 assert.equal(r.delivery.caller.state,'NOT_OBSERVED');assert.equal(r.delivery.accounting.callerCostsIncluded,false)
 assert.equal(r.delivery.accounting.wholeChainBudgetEnforced,false);assert.deepEqual(source,before)
 source.result.status='failed';source.budget.costCny=null
 const failed=buildReport(source);assert.equal(failed.delivery.execution.state,'failed');assert.equal(failed.delivery.artifacts.state,'REPORT_RENDERED')
 assert.equal(failed.budget.costCny,null);assert.equal(failed.delivery.caller.state,'NOT_OBSERVED')
 source.result=null;source.run.status='running';assert.equal(buildReport(source).delivery.artifacts.state,'PARTIAL_REPORT_RENDERED')
 const absent=buildReport({runId:'absent',events:[]});assert.equal(absent.delivery.artifacts.state,'NO_RUN_EVIDENCE')
})
test('diagnosis separates observed Fast ties from hypotheses and does not invent a score ceiling or evaluator defect',()=>{
 const source=history();source.events[0].plan.spec.epsilon=.01
 const r=buildReport(source),d=r.diagnostics
 assert.ok(d.facts.some(f=>f.code==='FAST_SCORES_WITHIN_EPSILON'&&f.candidateIds.includes('c1')))
 assert.ok(d.facts.some(f=>f.code==='NO_CANDIDATE_SLOW_MEASUREMENT'));assert.ok(d.facts.some(f=>f.code==='BASELINE_RETAINED'))
 assert.equal(d.causeEstablished,false);assert.equal(d.metricCeilingEstablished,false)
 assert.ok(d.unresolvedQuestions.every(q=>q.state==='NOT_TESTED'&&q.requiredEvidence))
 assert.equal(d.recovery.readOnlyInspectionSafe,true);assert.equal(d.recovery.resumeSupported,false);assert.equal(d.recovery.automaticNewRunAuthorized,false)
 source.events.at(-1).comparison.scores.c1=.25
 assert.ok(!buildReport(source).diagnostics.facts.some(f=>f.code==='FAST_SCORES_WITHIN_EPSILON'))
})
test('metric bound observations require explicit finite provider bounds and successful measurements',()=>{
 const source=history(),plan=source.events[0].plan
 plan.spec.fast.direction='maximize'
 plan.providers.evaluators=[{tier:'fast',metricDefinitions:{quality:{upperBound:.75,construct:'format'}}}]
 let d=buildReport(source).diagnostics
 assert.ok(d.facts.some(f=>f.code==='METRIC_AT_DECLARED_BOUND'&&f.candidateIds.includes('c1')))
 assert.equal(d.causeEstablished,false);assert.equal(d.metricCeilingEstablished,false)
 delete plan.providers.evaluators[0].metricDefinitions.quality.upperBound
 assert.ok(!buildReport(source).diagnostics.facts.some(f=>f.code==='METRIC_AT_DECLARED_BOUND'))
 plan.providers.evaluators[0].metricDefinitions.quality.upperBound=1
 assert.ok(!buildReport(source).diagnostics.facts.some(f=>f.code==='METRIC_AT_DECLARED_BOUND'))
})
test('diagnosis retains invalid-candidate and failed-evaluation facts with conservative cost and side-effect recovery',()=>{
 const source=history();source.result={status:'failed',stopReason:'DUO_DELTA_INVALID',conclusion:'insufficient_evidence',error:{code:'DUO_DELTA_INVALID',component:'duoTarget'}}
 source.events[0].plan.providers={executor:{permissions:{externalSideEffects:true}}};source.events[2].fast={ok:false,metrics:{},error:{code:'measurement_failed'}}
 source.budget={currency:'CNY',costCny:null,knownCostCny:.02,reservedCostCny:.1,blockedReason:'DUO_COST_UNKNOWN',operations:2}
 const d=buildReport(source).diagnostics
 assert.ok(d.facts.some(f=>f.code==='CANDIDATE_INVALID'));assert.ok(d.facts.some(f=>f.code==='EVALUATION_FAILED'))
 assert.equal(d.recovery.costState,'UNKNOWN');assert.equal(d.recovery.nextAction,'inspect_and_reconcile_supported_receipts')
 assert.equal(d.recovery.safeToRepeatWork,false);assert.equal(d.sideEffects.externalEffects,'UNKNOWN_FROM_TRUSTED_PROVIDER');assert.equal(d.cost.known,.02);assert.equal(d.cost.reserved,.1)
})
test('diagnosis never calls an unfinished run resumable or infers settled cost from missing accounting',()=>{
 const source=history();source.result=null;source.budget=null;source.run.status='running'
 const d=buildReport(source).diagnostics
 assert.equal(d.recovery.resumeSupported,false);assert.equal(d.recovery.safeToRepeatWork,false);assert.equal(d.recovery.costState,'UNKNOWN');assert.equal(d.recovery.nextAction,'inspect_active_owner_and_retained_state')
})
test('retaining baseline after evaluation-only never hides a recorded constraint violation',()=>{
 const source=history();source.result.mode='evaluation_only';source.result.measurementChecks={fast:{verdicts:{baseline:'constraint_violation'}}}
 const d=buildReport(source).diagnostics
 assert.ok(d.facts.some(f=>f.code==='CONSTRAINT_VIOLATION'&&f.candidateIds.includes('baseline')))
 assert.ok(d.facts.some(f=>f.code==='BASELINE_RETAINED'))
})
test('failed evaluation and unconfigured tiers never become zero scores',()=>{
 const source=history();source.events[0].plan.spec.slow=null;source.events[2].fast={ok:false,metrics:{},error:{code:'failed'}}
 const c=buildReport(source).candidates.find(c=>c.id==='c1')
 assert.equal(c.fast.state,'FAILED');assert.equal(c.slow.state,'NOT_CONFIGURED')
 assert.equal(c.fast.metrics.quality,undefined)
})
test('empty or interrupted history is reported without manufacturing a completed run',()=>{
 const r=buildReport({runId:'missing',run:null,result:null,budget:null,events:[]})
 assert.equal(r.status,'NOT_STARTED');assert.deepEqual(r.candidates,[]);assert.equal(r.conclusion,'insufficient_evidence')
 const s=history();s.result=null;s.run.status='running';assert.equal(buildReport(s).status,'running')
})
test('baseline known from the plan remains visible when cancellation precedes its first measurement',()=>{
 const r=buildReport({runId:'cancel',run:{status:'cancelled'},result:{status:'cancelled',conclusion:'insufficient_evidence'},events:[{kind:'plan',plan:{baseline:{id:'baseline',version:'base',persona:'existing'},spec:{fast:{metric:'quality'}}}}]})
 assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].id,'baseline')
 assert.equal(r.candidates[0].fast.state,'NOT_EVALUATED');assert.equal(r.candidates[0].fast.metrics,null)
})
test('duplicate candidate report preserves the reference and never copies source scores',()=>{
 const source=history();source.events.push({kind:'candidate',candidateId:'duplicate',candidate:{id:'duplicate',parentId:'baseline',version:'one'},status:'duplicate_skipped',duplicateOf:'c1'})
 const c=buildReport(source).candidates.find(c=>c.id==='duplicate')
 assert.equal(c.duplicateOf,'c1');assert.equal(c.fast.state,'NOT_EVALUATED');assert.match(c.fast.reason,/duplicate/i)
 assert.equal(c.fast.metrics,null);assert.equal(c.slow.metrics,null)
})
test('text report scopes observed facts to candidate ids and names duplicate-skipped rows',()=>{
 const source=history()
 source.events.push({kind:'candidate',candidateId:'dup2',candidate:{id:'dup2',parentId:'baseline',version:'two'},status:'duplicate_skipped',duplicateOf:'c1'})
 const r=buildReport(source)
 assert.match(r.text,/observed: .*FAST_NOT_BETTER \[c1\]/)
 const row=r.text.split('\n').find(l=>l.startsWith('dup2 |'))
 assert.ok(row&&row.includes('duplicate_of c1'),row)
})
test('JSONL export preserves original events and is not another journal or replay',()=>{
 const source=history(),r=buildReport(source)
 assert.deepEqual(r.journalJsonl.trim().split('\n').map(line=>JSON.parse(line)),source.events)
 assert.equal(r.replayedOperations,0)
})
test('different declared evidence families are visible but never automatically qualified',()=>{
 const source=history();source.events[0].plan.providers={generator:{model:'generator'},evaluators:[
  {tier:'fast',evidenceFamily:'unit',fidelityRationale:'dev'},
  {tier:'slow',evidenceFamily:'integration',fidelityRationale:'integration fixtures',qualification:'claimed-by-provider'}]}
 const r=buildReport(source)
 assert.equal(r.fidelity.status,'DIFFERENT_DECLARED_FAMILIES_NOT_QUALIFIED')
 assert.equal(r.fidelity.higherFidelityProven,false)
})
test('custom ladder reports derive diagnostic codes and health fields from declared tier names',()=>{
 const source={apiVersion:2,runId:'run',run:{status:'completed'},budget:{currency:'CNY',costCny:.02,knownCostCny:.02},
  result:{status:'completed',mode:'optimize',championId:'baseline',conclusion:'retain_baseline',improvementProven:false,
   final:[{candidateId:'baseline',tier:'final',ok:true,metrics:{quality:1},evaluatorId:'final',version:'1',dataId:'heldout'}]},
  events:[{kind:'plan',plan:{spec:{mode:'optimize',epsilon:.01,
    searchStages:[{tier:'lint',metric:'quality'},{tier:'holdout',metric:'quality'}],
    lint:{metric:'quality'},holdout:{metric:'quality'},final:{metric:'quality'}},
    providers:{evaluators:[{tier:'lint',evidenceFamily:'unit'},{tier:'holdout',evidenceFamily:'integration',fidelityRationale:'deeper fixtures'}]}}},
   {kind:'candidate',candidateId:'baseline',candidate:{id:'baseline',version:'base'},status:'champion',lint:{ok:true,metrics:{quality:.75}},holdout:{ok:true,metrics:{quality:.75}}},
   {kind:'candidate',candidateId:'c1',candidate:{id:'c1',parentId:'baseline',parentVersion:'base',version:'one'},generation:1,lint:{ok:true,metrics:{quality:.75}},status:'lint_evaluated'},
   {kind:'comparison',tier:'lint',comparison:{ranking:['baseline','c1'],scores:{baseline:.75,c1:.75},verdicts:{baseline:'not_better',c1:'not_better'}}}]}
 const r=buildReport(source),codes=r.diagnostics.facts.map(f=>f.code)
 assert.ok(codes.includes('LINT_SCORES_WITHIN_EPSILON'));assert.ok(codes.includes('LINT_NOT_BETTER'));assert.ok(codes.includes('NO_CANDIDATE_HOLDOUT_MEASUREMENT'))
 assert.ok(!codes.some(c=>/FAST|SLOW/.test(c)))
 assert.deepEqual(Object.keys(r.health),['holdoutEvaluatedCandidates','holdoutAcceptedCandidates','holdoutAcceptanceFraction','costPerHoldoutAcceptedCandidate','lintHoldoutCorrelation'])
 assert.equal(r.health.holdoutEvaluatedCandidates,0);assert.equal(r.health.holdoutAcceptanceFraction,null)
 assert.equal(r.fidelity.lintFamily,'unit');assert.equal(r.fidelity.holdoutFamily,'integration');assert.equal(r.fidelity.fastFamily,undefined)
 const c=r.candidates.find(c=>c.id==='c1')
 assert.equal(c.holdout.state,'NOT_PROMOTED');assert.equal(c.holdoutDecision,null);assert.equal(c.slowDecision,undefined)
 assert.match(r.text,/Lint \| Holdout/);assert.match(r.text,/LINT_NOT_BETTER \[c1\]/)
})
test('legacy flat contracts keep the historical fast/slow diagnostic and health vocabulary',()=>{
 const source=history();source.events[0].plan.spec.epsilon=.01
 const r=buildReport(source),codes=r.diagnostics.facts.map(f=>f.code)
 assert.ok(codes.includes('FAST_SCORES_WITHIN_EPSILON'));assert.ok(codes.includes('FAST_NOT_BETTER'));assert.ok(codes.includes('NO_CANDIDATE_SLOW_MEASUREMENT'))
 assert.deepEqual(Object.keys(r.health),['slowEvaluatedCandidates','slowAcceptedCandidates','slowAcceptanceFraction','costPerSlowAcceptedCandidate','fastSlowCorrelation'])
 assert.equal(r.candidates.every(c=>Object.hasOwn(c,'slowDecision')),true)
})
test('actual observer service and ToolRuntime read status without executing and dispose cleanly',async t=>{
 const ctx=new Context(),fibers=[];let reads=0
 class ReadOnlyController extends ControllerService {
  status(runId){assert.equal(runId,'run');reads++;return history()}
  run(){throw new Error('Observer must not execute')}
 }
 for(const P of [Agents,SystemPrompt,Tools,ReadOnlyController,NativeObserver,ObserverTools])fibers.push(await ctx.plugin(P))
 t.after(async()=>{for(const f of fibers.reverse())await f.dispose()})
 const call=args=>ctx.tools.execute({name:'dualloop_report',arguments:args,callId:'report',signal:new AbortController().signal})
 const a=await call({runId:'run'});assert.equal(a.isError,false);assert.equal(reads,1);assert.equal(a.value.journalJsonl,undefined)
 const b=await call({runId:'run',includeEvents:true});assert.equal(b.isError,false);assert.ok(b.value.journalJsonl.length)
 const compact=await call({runId:'run',view:'summary'});assert.equal(compact.isError,false)
 const text=JSON.parse(compact.content[0].text)
 assert.equal(text.view,'summary');assert.equal(text.budget.costCny,.02);assert.equal(text.improvementProven,false)
 assert.match(text.text,/NOT_PROMOTED/);assert.match(text.fullReport,/dualloop_report/)
 assert.deepEqual(compact.value,a.value,'Compact model rendering retains the full structured result')
 assert.ok(Buffer.byteLength(compact.content[0].text)<Buffer.byteLength(a.content[0].text))
 const invalid=await call({runId:'run',view:'discard_errors'});assert.equal(invalid.isError,true)
 await fibers.at(-1).dispose();assert.ok(!ctx.tools.schemas().some(s=>s.name==='dualloop_report'))
})
