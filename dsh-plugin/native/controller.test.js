import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {mkdtempSync,writeFileSync,readFileSync,existsSync,readdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {WeightedComparator,TopKGate} from './policies.js'
import HistoryFeedback from './history-feedback.js'
import {SqliteJournal,ReservedBudget} from './store.js'
import {GeneratorService,ExecutorService,EvaluatorsService,ComparatorService} from './definitions.js'
import * as ExampleProviders from '../../examples/native/fixture-provider.js'
import {digest} from './store.js'
import {buildReport} from './observer.js'
import BoundedTieGate from './bounded-tie-gate.js'
import {descriptor,FixtureGenerator,FixtureExecutor,FixtureEvaluators,setup} from './test-fixtures.js'

test('settled baseline and generation checkpoints resume without repeating work or extending allowance',async t=>{
 const evaluated=[],generated=[]
 class Distinct extends FixtureGenerator{async propose(args){generated.push(args.generation);const r=await super.propose(args);for(const c of r.candidates)c.delta.persona+=' generation '+args.generation+' '+c.id;return r}}
 class Counted extends FixtureExecutor{async execute(args){evaluated.push(args.candidate.id+':'+args.tier);return super.execute(args)}}
 const {ctx,target}=await setup(t,{}, {generator:Distinct,executor:Counted}),p=ctx.duoController.plan(),original=readFileSync(target)
 const paused=await ctx.duoController.run({planDigest:p.planDigest,pauseAfter:'baseline'})
 assert.equal(paused.status,'paused');assert.deepEqual(evaluated,['baseline:fast','baseline:slow']);assert.deepEqual(generated,[])
 const initial=ctx.duoController.status(p.runId),checkpoint=initial.checkpoint
 assert.equal(initial.result,null);assert.equal(checkpoint.resumable,true);assert.equal(checkpoint.boundary,'baseline')
 const initialOps=ctx.duoBudget.open(p.runId,p.spec.budget).operations(),initialReceipts=ctx.duoBudget.open(p.runId,p.spec.budget).receipts()
 await assert.rejects(ctx.duoController.run({planDigest:p.planDigest}),{code:'DUO_RESUME_REQUIRED'})
 const second=await ctx.duoController.run({planDigest:p.planDigest,resumeFrom:checkpoint.digest,pauseAfter:'generation'})
 assert.equal(second.status,'paused');assert.deepEqual(generated,[1]);assert.notEqual(second.checkpointDigest,checkpoint.digest)
 assert.equal(ctx.duoController.status(p.runId).checkpoint.deadlineAt,checkpoint.deadlineAt)
 assert.deepEqual(ctx.duoBudget.open(p.runId,p.spec.budget).operations().slice(0,initialOps.length),initialOps)
 assert.deepEqual(ctx.duoBudget.open(p.runId,p.spec.budget).receipts().slice(0,initialReceipts.length),initialReceipts)
 await assert.rejects(ctx.duoController.run({planDigest:p.planDigest,resumeFrom:checkpoint.digest}),{code:'DUO_CHECKPOINT_CHANGED'})
 const result=await ctx.duoController.run({planDigest:p.planDigest,resumeFrom:second.checkpointDigest})
 assert.equal(result.status,'completed');assert.deepEqual(generated,[1,2]);assert.equal(result.generationsRun,2)
 assert.equal(evaluated.filter(x=>x==='baseline:fast').length,1);assert.equal(evaluated.filter(x=>x==='baseline:slow').length,1)
 assert.equal(result.final.length,2);assert.equal(result.conclusion,'recommend_candidate')
 const status=ctx.duoController.status(p.runId)
 assert.equal(status.run.started,initial.run.started);assert.equal(status.events.filter(e=>e.kind==='plan').length,1)
 assert.equal(status.events.filter(e=>e.kind==='resumed').length,2);assert.equal(status.checkpoint.resumable,false)
 const work=[...evaluated];await ctx.duoController.run({planDigest:p.planDigest});assert.deepEqual(evaluated,work)
 assert.deepEqual(readFileSync(target),original)
})
test('resume rejects target drift and an uncheckpointed or unknown operation without new work',async t=>{
 for(const scenario of ['target','uncheckpointed','unknown']){
  let executions=0
  class Counted extends FixtureExecutor{async execute(args){executions++;return super.execute(args)}}
  const {ctx,target}=await setup(t,{}, {executor:Counted}),p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest,pauseAfter:'baseline'})
  assert.equal(r.status,'paused');const before=executions
  if(scenario==='target')writeFileSync(target,'changed target')
  else{
   // Isolated corruption/control: bypass is not a supported user operation.
   const j=ctx.duoJournal.open(p.runId,{create:true}),op=ctx.duoBudget.open(p.runId,p.spec.budget).operations()[0]
   const extra={...op,id:'orphan',status:scenario==='unknown'?'unknown':'settled',cost:scenario==='unknown'?null:0}
   j.db.prepare('INSERT INTO operations VALUES (?,?)').run(extra.id,JSON.stringify(extra))
  }
  await assert.rejects(ctx.duoController.run({planDigest:p.planDigest,resumeFrom:r.checkpointDigest}),e=>['DUO_PLAN_CHANGED','DUO_CHECKPOINT_CHANGED','DUO_COST_UNKNOWN'].includes(e.code))
  assert.equal(executions,before)
 }
})
test('resume rechecks contract and provider versions and the original deadline before work',async t=>{
 for(const kind of ['contract','provider','deadline']){
  let executions=0
  class Counted extends FixtureExecutor{async execute(args){executions++;return super.execute(args)}}
  const {ctx,contract,experiment,fibers}=await setup(t,{}, {executor:Counted}),p=ctx.duoController.plan(),paused=await ctx.duoController.run({planDigest:p.planDigest,pauseAfter:'baseline'})
  assert.equal(paused.status,'paused');const before=executions,clock=Date.now
  if(kind==='contract')writeFileSync(experiment,JSON.stringify({...contract,epsilon:.02}))
  if(kind==='provider'){
   await fibers[3].dispose();class Changed extends TopKGate{describe(){return {...super.describe(),version:'new-version'}}}
   const changed=await ctx.plugin(Changed);t.after(()=>changed.dispose())
  }
  if(kind==='deadline')Date.now=()=>ctx.duoJournal.open(p.runId).get('checkpoint').state.deadlineAt+1
  try{await assert.rejects(ctx.duoController.run({planDigest:p.planDigest,resumeFrom:paused.checkpointDigest}),{code:kind==='deadline'?'DUO_DEADLINE_EXHAUSTED':'DUO_PLAN_CHANGED'})}finally{Date.now=clock}
  assert.equal(executions,before)
 }
})
test('three-stage and evaluation-only continuations retain all settled tiers and never regenerate an empty search',async t=>{
 class Reviewed extends FixtureEvaluators{describe(){return [...super.describe(),descriptor('fixture-review',{tier:'review',dataId:'review',metrics:['quality','safe','sample_size']})]}}
 const stages=['fast','review','slow'].map((tier,i)=>({tier,evaluatorId:'fixture-'+tier,version:'1',dataId:tier,metric:'quality',direction:'maximize',weights:{quality:1},
  purpose:i===0?'screen':'confirm',informationGain:'Distinct controlled '+tier+' split',maxEvaluations:10,topK:i===2?0:1}))
 for(const evaluationOnly of [false,true]){
  const h=await setup(t,{fast:undefined,slow:undefined,searchStages:stages,...evaluationOnly?{operation:'evaluate',generations:0,quotas:{exploit:0,explore:0,innovate:0}}:{}},{evaluators:Reviewed})
  const p=h.ctx.duoController.plan(),paused=await h.ctx.duoController.run({planDigest:p.planDigest,pauseAfter:'baseline'})
  assert.equal(paused.status,'paused');assert.equal(paused.budget.operations,6)
  const before=h.ctx.duoBudget.open(p.runId,p.spec.budget).receipts(),done=await h.ctx.duoController.run({planDigest:p.planDigest,resumeFrom:paused.checkpointDigest})
  assert.equal(done.status,'completed');assert.deepEqual(h.ctx.duoBudget.open(p.runId,p.spec.budget).receipts().slice(0,before.length),before)
  if(evaluationOnly){assert.equal(done.generationsRun,0);assert.deepEqual(done.evaluations.map(e=>e.tier),['fast','review','slow','final'])}
  else assert.equal(done.generationsRun,2)
 }
 let generated=0
 class Empty extends FixtureGenerator{async propose(){generated++;return {candidates:[],costUsd:0}}}
 const {ctx}=await setup(t,{}, {generator:Empty}),p=ctx.duoController.plan(),paused=await ctx.duoController.run({planDigest:p.planDigest,pauseAfter:'generation'})
 assert.equal(paused.status,'paused');assert.equal(paused.final.length,0);assert.equal(generated,1)
 const done=await ctx.duoController.run({planDigest:p.planDigest,resumeFrom:paused.checkpointDigest})
 assert.equal(done.stopReason,'no_candidates');assert.equal(done.final.length,1);assert.equal(generated,1)
})
test('fresh native process resumes clean boundaries, rejects a different build and preserves receipts',async t=>{
 const {spawnSync}=await import('node:child_process')
 const {readdirSync,mkdirSync}=await import('node:fs')
 for(const boundary of ['pause','crash']){
  const root=mkdtempSync(join(tmpdir(),'duo-resume-process-')),target=join(root,'persona.txt'),experiment=join(root,'experiment.json'),file=join(root,'worker.mjs')
  writeFileSync(target,'You are {{model}} in {{cwd}}.')
  const contract=JSON.parse(readFileSync(new URL('../../examples/native/experiment.json',import.meta.url)))
  contract.target.path=target;contract.id='process-resume';contract.budget.maxWallTimeMs=30000;writeFileSync(experiment,JSON.stringify(contract))
  const module=name=>JSON.stringify(new URL(name,import.meta.url).href)
  writeFileSync(file,`import {Context} from '@deepseek-ai/cordis';
import JsonContract from ${module('./contract.js')};import PersonaTarget from ${module('./target.js')};
const {default:NativeController}=await import(process.argv[4]||${module('./controller.js')});import {WeightedComparator,TopKGate,ConservativeFeedback} from ${module('./policies.js')};
import {SqliteJournal,ReservedBudget} from ${module('./store.js')};import * as Providers from ${module('../../examples/native/fixture-provider.js')};
const root=${JSON.stringify(root)},ctx=new Context(),fibers=[];
for(const [P,config] of [[JsonContract,{experiment:root+'/experiment.json'}],[PersonaTarget],[WeightedComparator],[TopKGate],[ConservativeFeedback],[SqliteJournal,{root:root+'/runs'}],[ReservedBudget],[Providers,{distinctCandidates:true,currency:${JSON.stringify(contract.budget?.currency??null)}}],[NativeController]])fibers.push(await ctx.plugin(P,config));
const p=ctx.duoController.plan(),mode=process.argv[2],prior=process.argv[3];
if(mode==='crash'){const j=ctx.duoJournal.open(p.runId,{create:true}),save=j.saveCheckpoint.bind(j);j.saveCheckpoint=(state,options)=>{const checkpointDigest=save(state,options);console.log(JSON.stringify({plan:p,checkpointDigest,operations:ctx.duoBudget.open(p.runId,p.spec.budget).operations(),receipts:ctx.duoBudget.open(p.runId,p.spec.budget).receipts()}));process.exit(23)}}
const r=await ctx.duoController.run({planDigest:process.argv[5]||p.planDigest,...mode==='pause'?{pauseAfter:'generation'}:mode==='resume'?{resumeFrom:prior}:{}});
console.log(JSON.stringify({plan:p,result:r,status:ctx.duoController.status(p.runId),operations:ctx.duoBudget.open(p.runId,p.spec.budget).operations(),receipts:ctx.duoBudget.open(p.runId,p.spec.budget).receipts()}));
for(const f of fibers.reverse())await f.dispose();`)
  const run=(mode,checkpoint='',build='',plan='')=>spawnSync(process.execPath,['--loader',new URL('../../scripts/dsh_native_loader.mjs',import.meta.url).href,file,mode,checkpoint,build,plan],{encoding:'utf8',timeout:15000,env:{PATH:process.env.PATH,DUO_DSH_PACKAGE:process.env.DUO_DSH_PACKAGE}})
  const first=run(boundary);assert.equal(first.status,boundary==='crash'?23:0,first.stderr)
  const before=JSON.parse(first.stdout.trim()),checkpoint=before.checkpointDigest??before.result.checkpointDigest
  if(boundary==='pause'){
   const copy=join(root,'changed-native');mkdirSync(copy)
   for(const name of readdirSync(new URL('.',import.meta.url)).filter(n=>n.endsWith('.js')&&!n.endsWith('.test.js')))writeFileSync(join(copy,name),readFileSync(new URL(name,import.meta.url),'utf8')+(name==='controller.js'?'\n// Isolated different-build refusal control.\n':''))
   const changed=run('resume',checkpoint,join(copy,'controller.js'),before.plan.planDigest)
   assert.equal(changed.status,1);assert.match(changed.stderr,/DUO_PLAN_CHANGED/)
  }
  const second=run('resume',checkpoint);assert.equal(second.status,0,second.stderr)
  const after=JSON.parse(second.stdout.trim());assert.equal(after.result.status,'completed');assert.equal(after.plan.planDigest,before.plan.planDigest)
  assert.equal(after.result.generationsRun,2);assert.equal(after.result.final.length,2)
  assert.deepEqual(after.operations.slice(0,before.operations.length),before.operations)
  assert.deepEqual(after.receipts.slice(0,before.receipts.length),before.receipts)
  assert.equal(after.operations.filter(o=>o.request.candidateId==='baseline'&&o.request.step==='execute'&&o.request.tier==='fast').length,1)
  const resumed=after.status.events.find(e=>e.kind==='resumed');assert.notEqual(resumed.owner.pid,resumed.previousOwner.pid)
  assert.equal(after.status.events.filter(e=>e.kind==='plan').length,1)
 }
})
test('controller forwards evaluation tier and retains provider usage evidence in the durable budget receipt',async t=>{
 const tiers=[]
 class ReceiptExecutor extends FixtureExecutor {async execute(args){tiers.push(args.tier);return {...await super.execute(args),costEvidence:{kind:'fixture',usage:{inputTokens:10},receiptPath:'fixture-receipt'}}}}
 const {ctx}=await setup(t,{}, {executor:ReceiptExecutor}),p=ctx.duoController.plan()
 const result=await ctx.duoController.run({planDigest:p.planDigest})
 assert.equal(result.status,'completed');assert.deepEqual(new Set(tiers),new Set(['fast','slow','final']))
 const receipts=ctx.duoBudget.open(p.runId,p.spec.budget).receipts().filter(r=>r.evidence.provider==='fixture-executor')
 assert.equal(receipts.length,tiers.length);assert.ok(receipts.every(r=>r.evidence.costEvidence?.receiptPath==='fixture-receipt'))
})
test('known-cost provider refusal preserves its structured code after settling, without continuing evaluation',async t=>{
 class Refusing extends FixtureExecutor{async execute(){return {costUsd:0,error:{code:'DUO_MODEL_ROUTE_CHANGED',message:'Route differs from the inspected plan',component:'duoExecutor'}}}}
 const {ctx}=await setup(t,{}, {executor:Refusing}),p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest})
 assert.equal(r.error.code,'DUO_MODEL_ROUTE_CHANGED');assert.equal(r.error.retryable,false);assert.equal(typeof r.error.nextAction,'string');assert.equal(r.budget.costUsd,0);assert.equal(r.budget.operations,1)
})
for(const operation of ['evaluate','optimize'])test('settled Fast observation survives later baseline Slow refusal: '+operation,async t=>{
 let executions=0
 class PartialExecutor extends FixtureExecutor{async execute(args){executions++;return args.tier==='slow'?{costUsd:0,error:{code:'DUO_MODEL_FAILED',message:'controlled later refusal'}}:super.execute(args)}}
 const overrides=operation==='evaluate'?{operation,generations:0,quotas:{exploit:0,explore:0,innovate:0}}:{}
 const {ctx}=await setup(t,overrides,{executor:PartialExecutor}),p=ctx.duoController.plan()
 const result=await ctx.duoController.run({planDigest:p.planDigest})
 assert.equal(result.status,'failed');assert.equal(result.stopReason,'DUO_MODEL_FAILED')
 const status=ctx.duoController.status(p.runId),report=buildReport(status),baseline=report.candidates.find(c=>c.id==='baseline')
 assert.equal(baseline.fast.state,'EVALUATED');assert.equal(baseline.fast.metrics.quality,0)
 assert.equal(baseline.slow.state,'NOT_EVALUATED');assert.equal(result.budget.operations,3)
 assert.equal(status.events.filter(e=>e.kind==='candidate'&&e.fast).length,1)
 await ctx.duoController.run({planDigest:p.planDigest});assert.equal(executions,2)
})
test('native plan binds inputs and creates no run; target changes invalidate it',async t=>{const {ctx,target,runs}=await setup(t);const p=ctx.duoController.plan();assert.equal(p.runtime,'dsh-native');assert.equal(existsSync(runs),false);writeFileSync(target,'changed');await assert.rejects(ctx.duoController.run({planDigest:p.planDigest}),{code:'DUO_PLAN_CHANGED'});assert.equal(existsSync(runs),false)})
test('public provider contract checks share plan bindings without work or Journal creation',async t=>{
 const {inspectProviderContracts}=await import('./provider-contract.js')
 class NoWork extends FixtureExecutor{async execute(){assert.fail('contract check must not execute the provider')}}
 const {ctx,runs}=await setup(t,{}, {executor:NoWork}),p=ctx.duoController.plan()
 assert.deepEqual(inspectProviderContracts(ctx,p.spec),p.providers)
 assert.equal(Object.isFrozen(inspectProviderContracts(ctx,p.spec)),true)
 const otherCurrency={...p.spec,budget:{...p.spec.budget,currency:'CNY',maxCostUsd:undefined,maxCostCny:0}}
 assert.throws(()=>inspectProviderContracts(ctx,otherCurrency),{code:'DUO_CURRENCY_MISMATCH'})
 assert.equal(existsSync(runs),false)
})
test('Target kind declarations reject malformed lists and mismatched adapters before work',async t=>{
 const {ctx,runs}=await setup(t),describe=ctx.duoTarget.describe.bind(ctx.duoTarget)
 for(const targetKinds of ['prefix-dsh-persona-suffix',[],[null]]){
  ctx.duoTarget.describe=()=>({...describe(),targetKinds})
  assert.throws(()=>ctx.duoController.plan(),{code:'DUO_PROVIDER_INVALID'})
 }
 ctx.duoTarget.describe=()=>({...describe(),targetKinds:['other-kind']})
 assert.throws(()=>ctx.duoController.plan(),{code:'DUO_TARGET_INCOMPATIBLE'})
 assert.equal(existsSync(runs),false)
})
test('public plan reads authorized native warm history without writing runs or transferring its allowance',async t=>{
 const {ctx,contract,experiment,runs}=await setup(t),old=ctx.duoController.plan();await ctx.duoController.run({planDigest:old.planDigest})
 const file=join(runs,old.runId,'duo.sqlite'),before=readFileSync(file),budget=ctx.duoBudget.inspect(old.runId)
 const next={...contract,id:'new-warm-experiment',warmStart:{runIds:[old.runId,old.runId],fixturePolicy:'ideas_only'}};writeFileSync(experiment,JSON.stringify(next))
 const p=ctx.duoController.plan();assert.equal(p.warmStart.mode,'warm_start');assert.ok(p.warmStart.context.records.length>1)
 assert.ok(p.warmStart.context.records.every(r=>r.use==='ideas_only'));assert.equal(p.warmStart.sources.length,1)
 assert.equal(p.baseline.version,old.baseline.version);assert.deepEqual(p.spec.budget,old.spec.budget)
 assert.equal(existsSync(join(runs,p.runId)),false);assert.deepEqual(readFileSync(file),before);assert.deepEqual(ctx.duoBudget.inspect(old.runId),budget)
 next.warmStart.runIds=[old.runId];writeFileSync(experiment,JSON.stringify(next));assert.equal(ctx.duoController.plan().planDigest,p.planDigest)
 next.warmStart.fixturePolicy='exclude';writeFileSync(experiment,JSON.stringify(next));assert.equal(ctx.duoController.plan().warmStart.mode,'cold_start')
})
test('public warm-start contract refuses unbounded and path-based history before any execution',async t=>{
 const {ctx,contract,experiment,runs}=await setup(t)
 for(const warmStart of [{runIds:['../private']},{runIds:[],maxRecords:1000},{runIds:[],maxContextBytes:1e9},{runIds:[],fixturePolicy:'trusted'},{runIds:[],unknown:'field'}]){
  writeFileSync(experiment,JSON.stringify({...contract,warmStart}));assert.throws(()=>ctx.duoController.plan(),{code:'DUO_CONTRACT_INVALID'});assert.equal(existsSync(runs),false)
 }
 writeFileSync(experiment,JSON.stringify({...contract,warmStart:{runIds:[]}}));assert.equal(ctx.duoController.plan().warmStart.mode,'cold_start');assert.equal(existsSync(runs),false)
})
test('a new warm run consumes frozen history, remeasures baseline, and keeps both ledgers and final qualification separate',async t=>{
 const seen=[],executed=[]
 class Recording extends FixtureGenerator{async propose(args){seen.push({champion:structuredClone(args.champion),feedback:structuredClone(args.feedback)});return super.propose(args)}}
 class Executed extends FixtureExecutor{async execute(args){executed.push({id:args.candidate.id,tier:args.tier});return super.execute(args)}}
 const {ctx,contract,experiment,runs,target}=await setup(t,{}, {generator:Recording,executor:Executed}),old=ctx.duoController.plan(),original=readFileSync(target,'utf8')
 await ctx.duoController.run({planDigest:old.planDigest});const oldBudget=ctx.duoBudget.inspect(old.runId),oldBytes=readFileSync(join(runs,old.runId,'duo.sqlite'));seen.length=0;executed.length=0
 writeFileSync(experiment,JSON.stringify({...contract,id:'warm-consumption',warmStart:{runIds:[old.runId],fixturePolicy:'ideas_only'}}))
 const p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest})
 assert.equal(r.status,'completed');assert.notEqual(r.runId,old.runId);assert.ok(seen.length>0)
 assert.equal(digest(seen[0].feedback.warmStart),p.warmStart.contextDigest);assert.equal(seen[0].champion.version,p.baseline.version)
 assert.deepEqual(executed.filter(x=>x.id==='baseline').map(x=>x.tier),['fast','slow','final'])
 assert.equal(r.historyReuse.priorCostsImported,false);assert.equal(r.historyReuse.baselineRemeasured,true);assert.equal(r.historyReuse.contextDigest,p.warmStart.contextDigest)
 assert.equal(r.independentFinal.independence,'NOT_ESTABLISHED');assert.equal(r.independentFinal.observedConclusion,'recommend_candidate');assert.equal(r.conclusion,'insufficient_evidence')
 assert.deepEqual(ctx.duoBudget.inspect(old.runId),oldBudget);assert.deepEqual(readFileSync(join(runs,old.runId,'duo.sqlite')),oldBytes);assert.equal(readFileSync(target,'utf8'),original)
 const status=ctx.duoController.status(p.runId),feedbackEvents=status.events.filter(e=>e.kind==='feedback'),ops=ctx.duoBudget.open(p.runId,p.spec.budget).operations().filter(o=>o.phase==='generation')
 assert.ok(feedbackEvents.every(e=>e.warmStartDigest===p.warmStart.contextDigest));assert.ok(ops.every(o=>o.request.warmStartDigest===p.warmStart.contextDigest))
 const report=buildReport(status);assert.equal(report.historyReuse.contextDigest,p.warmStart.contextDigest);assert.equal(report.finalDataReview.independence,'NOT_ESTABLISHED')
 const repeat=await ctx.duoController.run({planDigest:p.planDigest});assert.equal(repeat.reusedArtifacts,true);assert.deepEqual(repeat.budget,r.budget)
})
test('relevant history tampering invalidates an inspected warm plan before creating the new run',async t=>{
 const {ctx,contract,experiment,runs}=await setup(t),old=ctx.duoController.plan();await ctx.duoController.run({planDigest:old.planDigest})
 writeFileSync(experiment,JSON.stringify({...contract,id:'history-tamper',warmStart:{runIds:[old.runId],fixturePolicy:'ideas_only'}}));const p=ctx.duoController.plan()
 // Simulate external disk corruption in this isolated test, not a supported edit.
 const j=ctx.duoJournal.open(old.runId,{create:true}),row=j.db.prepare("SELECT seq,payload FROM events WHERE payload LIKE '%Check whether%' LIMIT 1").get(),event=JSON.parse(row.payload)
 event.candidate.hypothesis='altered historical hypothesis';j.db.prepare('UPDATE events SET payload=? WHERE seq=?').run(JSON.stringify(event),row.seq)
 // Every later snapshot must change too; the selector uses latest observations.
 for(const row of j.db.prepare('SELECT seq,payload FROM events').all()){const e=JSON.parse(row.payload);if(e.candidate?.id===event.candidate.id){e.candidate.hypothesis='altered historical hypothesis';j.db.prepare('UPDATE events SET payload=? WHERE seq=?').run(JSON.stringify(e),row.seq)}}
 await assert.rejects(ctx.duoController.run({planDigest:p.planDigest}),{code:'DUO_PLAN_CHANGED'});assert.equal(existsSync(join(runs,p.runId)),false)
})
test('a replaced history order changes the inspected plan and the next generator input without importing old authority',async t=>{
 const seen=[]
 class Recording extends FixtureGenerator{async propose(args){seen.push(structuredClone(args.feedback));return super.propose(args)}}
 class SlowFailure extends FixtureEvaluators{async evaluate(args){const out=await super.evaluate(args);return args.tier==='slow'&&args.candidate.id!=='baseline'?{...out,metrics:{...out.metrics,quality:-1}}:out}}
 const {ctx,contract,experiment,runs,fibers}=await setup(t,{generations:1},{generator:Recording,evaluators:SlowFailure})
 const old=ctx.duoController.plan();assert.equal((await ctx.duoController.run({planDigest:old.planDigest})).status,'completed')
 const oldBudget=ctx.duoBudget.inspect(old.runId),oldBytes=readFileSync(join(runs,old.runId,'duo.sqlite'));seen.length=0
 writeFileSync(experiment,JSON.stringify({...contract,id:'ordered-warm-consumption',warmStart:{runIds:[old.runId],maxRecords:1,fixturePolicy:'ideas_only'}}))
 await fibers[4].dispose()
 const balanced=await ctx.plugin(HistoryFeedback,{historyOrder:'balanced'}),previous=ctx.duoController.plan()
 assert.equal(previous.warmStart.context.records[0].role,'baseline');await balanced.dispose()
 const custom=await ctx.plugin(HistoryFeedback,{historyOrder:'recent_failures_first'});t.after(()=>custom.dispose())
 const p=ctx.duoController.plan()
 assert.notEqual(p.planDigest,previous.planDigest)
 assert.equal(p.providers.policies.duoFeedback.historyOrder,'recent_failures_first')
 assert.equal(p.warmStart.selector.historyOrder,'recent_failures_first')
 assert.equal(p.warmStart.context.records.length,1);assert.equal(p.warmStart.context.records[0].role,'failure')
 await assert.rejects(ctx.duoController.run({planDigest:previous.planDigest}),{code:'DUO_PLAN_CHANGED'})
 assert.equal(existsSync(join(runs,p.runId)),false)
 const result=await ctx.duoController.run({planDigest:p.planDigest})
 assert.equal(result.status,'completed');assert.equal(seen.length,1)
 assert.equal(digest(seen[0].warmStart),p.warmStart.contextDigest)
 assert.equal(seen[0].warmStart.records[0].role,'failure')
 assert.equal(result.historyReuse.priorCostsImported,false);assert.equal(result.historyReuse.baselineRemeasured,true)
 assert.deepEqual(ctx.duoBudget.inspect(old.runId),oldBudget);assert.deepEqual(readFileSync(join(runs,old.runId,'duo.sqlite')),oldBytes)
})
test('full native loop produces final evidence, retained overlays, phase costs and no repeat execution',async t=>{const {ctx,target}=await setup(t);const before=readFileSync(target,'utf8'),p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest});assert.equal(r.status,'completed');assert.equal(r.conclusion,'recommend_candidate');assert.equal(r.improvementProven,false);assert.equal(r.budget.costUsd,0);assert.ok(r.budget.fastAttempts>1);assert.equal(r.final.length,2);assert.equal(readFileSync(target,'utf8'),before);const again=await ctx.duoController.run({planDigest:p.planDigest});assert.equal(again.reusedArtifacts,true);assert.deepEqual(again.budget,r.budget);assert.equal(ctx.duoController.status(p.runId).result.runId,r.runId)})
test('native generator provider replacement changes behavior without modifying controller',async t=>{class NoCandidates extends FixtureGenerator{describe(){return descriptor('no-candidates')}async propose(){return {candidates:[],costUsd:0}}}const {ctx}=await setup(t,{}, {generator:NoCandidates});const p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest});assert.equal(r.conclusion,'retain_baseline');assert.equal(r.stopReason,'no_candidates')})
test('valid descriptors cannot admit inherited abstract or non-function work methods',async t=>{
 class MissingGenerator extends GeneratorService{describe(){return descriptor('missing-generator')}}
 class MissingExecutor extends ExecutorService{describe(){return descriptor('missing-executor')}}
 class MissingEvaluators extends EvaluatorsService{describe(){return FixtureEvaluators.prototype.describe()}}
 class NonFunction extends FixtureGenerator{constructor(ctx){super(ctx);this.propose=null}}
 for(const providers of [{generator:MissingGenerator},{executor:MissingExecutor},{evaluators:MissingEvaluators},{generator:NonFunction}]){
  const {ctx,runs}=await setup(t,{},providers);assert.throws(()=>ctx.duoController.plan(),{code:'DUO_PROVIDER_INTERFACE'});assert.equal(existsSync(runs),false)
 }
})
test('missing policy methods and empty provider versions refuse before any Journal or work; concrete inheritance remains supported',async t=>{
 class MissingPolicy extends ComparatorService{describe(){return {id:'missing-comparison',version:'1',deterministic:true}}}
 const {ctx,runs,fibers}=await setup(t);await fibers[2].dispose();const f=await ctx.plugin(MissingPolicy);t.after(()=>f.dispose())
 assert.throws(()=>ctx.duoController.plan(),{code:'DUO_PROVIDER_INTERFACE'});assert.equal(existsSync(runs),false)
 class EmptyVersion extends FixtureGenerator{describe(){return descriptor('empty-version',{version:''})}}
 const h=await setup(t,{}, {generator:EmptyVersion});assert.throws(()=>h.ctx.duoController.plan(),{code:'DUO_PROVIDER_INVALID'});assert.equal(existsSync(h.runs),false)
 class Inherited extends FixtureGenerator{}
 const valid=await setup(t,{}, {generator:Inherited}),p=valid.ctx.duoController.plan();assert.equal((await valid.ctx.duoController.run({planDigest:p.planDigest})).status,'completed')
})
test('configured no-progress limit stops new generations after a completed tie and still performs planned final',async t=>{
 const seen=[]
 class Distinct extends FixtureGenerator{async propose(args){seen.push(args.generation);const out=await super.propose(args);for(const c of out.candidates)c.delta.persona+=' distinct '+c.id;return out}}
 class Tied extends FixtureEvaluators{async evaluate(args){return {...await super.evaluate(args),metrics:{quality:.5,safe:true,sample_size:2}}}}
 const {ctx}=await setup(t,{generations:5,stopping:{maxNoProgressGenerations:1}},{generator:Distinct,evaluators:Tied}),p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest})
 assert.equal(r.status,'completed');assert.equal(r.stopReason,'no_progress_limit');assert.deepEqual(seen,[1]);assert.equal(r.generationsRun,1);assert.equal(r.final.length,1);assert.equal(r.conclusion,'retain_baseline')
 const progress=ctx.duoController.status(p.runId).events.find(e=>e.kind==='search_progress');assert.equal(progress.consecutiveNoProgress,1);assert.equal(progress.progressed,false)
})
test('progress resets its generation counter and absent stopping options preserve the configured generation limit',async t=>{
 class Distinct extends FixtureGenerator{async propose(args){const out=await super.propose(args);for(const c of out.candidates)c.delta.persona+=' distinct '+c.id;return out}}
 const {ctx}=await setup(t,{generations:5,stopping:{maxNoProgressGenerations:1}},{generator:Distinct}),p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest})
 assert.equal(r.stopReason,'no_progress_limit');assert.equal(r.generationsRun,2)
 assert.deepEqual(ctx.duoController.status(p.runId).events.filter(e=>e.kind==='search_progress').map(e=>e.consecutiveNoProgress),[0,1])
 const h=await setup(t,{generations:3},{generator:Distinct}),plan=h.ctx.duoController.plan(),run=await h.ctx.duoController.run({planDigest:plan.planDigest});assert.equal(run.stopReason,'generation_limit');assert.equal(run.generationsRun,3)
})
test('configured consecutive evaluation failures retain the threshold-reaching observation and admit no extra work',async t=>{
 const evaluated=[]
 class Distinct extends FixtureGenerator{async propose(args){const out=await super.propose(args);for(const c of out.candidates)c.delta.persona+=' distinct '+c.id;return out}}
 class Failed extends FixtureEvaluators{async evaluate(args){evaluated.push(args.candidate.id+':'+args.tier);const out=await super.evaluate(args);return {...out,ok:args.candidate.id==='baseline',metrics:args.candidate.id==='baseline'?out.metrics:{},evidence:[{kind:'returned_failure_control'}]}}}
 const {ctx}=await setup(t,{stopping:{maxConsecutiveEvaluationFailures:2}},{generator:Distinct,evaluators:Failed}),p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest})
 assert.equal(r.stopReason,'DUO_EVALUATION_FAILURE_LIMIT');assert.equal(r.status,'failed');assert.equal(r.budget.operations,9)
 assert.deepEqual(evaluated,['baseline:fast','baseline:slow','dl-0001:fast','dl-0002:fast'])
 const report=buildReport(ctx.duoController.status(p.runId));assert.equal(report.candidates.find(c=>c.id==='dl-0002').fast.state,'FAILED');assert.equal(report.candidates.find(c=>c.id==='dl-0003').fast.state,'NOT_EVALUATED')
})
test('a successful evaluation resets consecutive failures and final failure remains in the terminal artifacts',async t=>{
 class Distinct extends FixtureGenerator{async propose(args){const out=await super.propose(args);for(const c of out.candidates)c.delta.persona+=' distinct '+c.id;return out}}
 class Alternating extends FixtureEvaluators{async evaluate(args){const out=await super.evaluate(args);return {...out,ok:args.candidate.id==='baseline'||args.candidate.id==='dl-0002',metrics:{quality:0,safe:true,sample_size:2}}}}
 const {ctx}=await setup(t,{generations:1,stopping:{maxConsecutiveEvaluationFailures:2}},{generator:Distinct,evaluators:Alternating}),p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest});assert.equal(r.status,'completed');assert.equal(r.stopReason,'generation_limit')
 class FinalFailure extends FixtureEvaluators{async evaluate(args){return {...await super.evaluate(args),ok:args.tier!=='final'}}}
 const h=await setup(t,{generations:0,stopping:{maxConsecutiveEvaluationFailures:1}},{evaluators:FinalFailure}),plan=h.ctx.duoController.plan(),run=await h.ctx.duoController.run({planDigest:plan.planDigest})
 assert.equal(run.stopReason,'DUO_EVALUATION_FAILURE_LIMIT');assert.equal(run.final.length,1);assert.equal(run.final[0].ok,false)
 assert.equal(buildReport(h.ctx.duoController.status(plan.runId)).candidates[0].final.state,'FAILED')
})
test('stopping contract rejects invalid or inapplicable limits before any Journal creation',async t=>{
 const {ctx,experiment,contract,runs}=await setup(t)
 for(const stopping of [{maxNoProgressGenerations:0},{maxConsecutiveEvaluationFailures:1.5},{unknown:2},null,[]]){
  writeFileSync(experiment,JSON.stringify({...contract,stopping}));assert.throws(()=>ctx.duoController.plan(),{code:'DUO_CONTRACT_INVALID'});assert.equal(existsSync(runs),false)
 }
 writeFileSync(experiment,JSON.stringify({...contract,operation:'evaluate',generations:0,quotas:{exploit:0,explore:0,innovate:0},stopping:{maxNoProgressGenerations:1}}));assert.throws(()=>ctx.duoController.plan(),{code:'DUO_CONTRACT_INVALID'})
})
test('stopping follows the existing fast-only and evaluation-only paths without admitting unused search work',async t=>{
 class Distinct extends FixtureGenerator{async propose(args){const out=await super.propose(args);for(const c of out.candidates)c.delta.persona+=' distinct '+c.id;return out}}
 const h=await setup(t,{slow:null,generations:5,stopping:{maxNoProgressGenerations:1}},{generator:Distinct}),p=h.ctx.duoController.plan(),r=await h.ctx.duoController.run({planDigest:p.planDigest})
 assert.equal(r.mode,'fast_only');assert.equal(r.generationsRun,2);assert.equal(r.stopReason,'no_progress_limit');assert.equal(r.final.length,2);assert.equal(r.conclusion,'insufficient_evidence')
 class ReturnedFailure extends FixtureEvaluators{async evaluate(args){return {...await super.evaluate(args),ok:false}}}
 const measured=await setup(t,{operation:'evaluate',generations:0,quotas:{exploit:0,explore:0,innovate:0},stopping:{maxConsecutiveEvaluationFailures:1}},{evaluators:ReturnedFailure}),plan=measured.ctx.duoController.plan(),result=await measured.ctx.duoController.run({planDigest:plan.planDigest})
 assert.equal(result.stopReason,'DUO_EVALUATION_FAILURE_LIMIT');assert.equal(result.budget.operations,2);assert.equal(result.generationsRun,0)
 const report=buildReport(measured.ctx.duoController.status(plan.runId));assert.equal(report.candidates[0].fast.state,'FAILED');assert.equal(report.candidates[0].slow.state,'NOT_EVALUATED')
})
test('controller supplies full ranked lineage to replacement feedback without final leakage',async t=>{
 const seen=[]
 // This test exercises a six-generation history, so provide distinct controlled
 // contents. Exact duplicates now correctly stop early in their separate tests.
 class Recording extends FixtureGenerator{async propose(args){seen.push(structuredClone(args.feedback));const out=await super.propose(args);for(const c of out.candidates)c.delta.persona+='\nDistinct history control '+c.id;return out}}
 const {ctx,fibers}=await setup(t,{generations:6,budget:{maxCostUsd:0,maxSessions:200,maxFastEvals:50,maxSlowEvals:30,maxWallTimeMs:10000}},{generator:Recording})
 await fibers[4].dispose();const f=await ctx.plugin(HistoryFeedback);t.after(()=>f.dispose())
 const plan=ctx.duoController.plan(),result=await ctx.duoController.run({planDigest:plan.planDigest})
 assert.equal(result.status,'completed');assert.equal(seen.length,6);assert.equal(seen[5].history.length,16)
 assert.ok(seen[5].history.filter(h=>h.candidateId!=='baseline').every(h=>h.parentId&&h.parentVersion&&h.delta&&h.hypothesis))
 assert.ok(seen[5].history.every(h=>!Object.hasOwn(h,'final')))
 assert.ok(seen[5].history.some(h=>typeof h.fastScore==='number'))
})
test('native target rejects a forged parent and preserves the original',async t=>{class Bad extends FixtureGenerator{async propose(args){const r=await super.propose(args);r.candidates[0].parentVersion='forged';return r}}const {ctx,target}=await setup(t,{}, {generator:Bad});const before=readFileSync(target,'utf8'),p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest});assert.equal(r.status,'failed');assert.equal(r.error.code,'DUO_DELTA_INVALID');assert.equal(readFileSync(target,'utf8'),before)})
test('native unknown cost stops and survives service reopen',async t=>{class Unknown extends FixtureExecutor{async execute(args){const r=await super.execute(args);return {...r,costUsd:null}}}const {ctx}=await setup(t,{}, {executor:Unknown});const p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest});assert.equal(r.budget.costUsd,null);assert.equal(r.status,'failed');assert.equal(r.error.code,'DUO_COST_UNKNOWN');assert.equal(ctx.duoBudget.inspect(p.runId).costUsd,null)})
test('native fast-only mode does not claim a validated champion',async t=>{const {ctx}=await setup(t,{slow:null,final:null});const p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest});assert.equal(r.mode,'fast_only');assert.equal(r.conclusion,'insufficient_evidence');assert.equal(r.championId,null)})
test('single-loop proxy receives independent final evidence only after search, without masquerading as dual validation',async t=>{
 const {ctx}=await setup(t,{slow:null}),p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest})
 assert.equal(r.mode,'fast_only');assert.equal(r.championId,null);assert.equal(r.conclusion,'insufficient_evidence')
 assert.equal(r.final.length,2);assert.equal(r.independentFinal.conclusion,'recommend_candidate')
 assert.equal(r.independentFinal.comparison.verdicts[r.proxyLeaderId],'better')
 const events=ctx.duoController.status(p.runId).events
 assert.equal(events.some(e=>e.kind==='comparison'&&e.tier==='slow'),false)
 assert.ok(events.findIndex(e=>e.kind==='final')>events.findLastIndex(e=>e.kind==='feedback'))
 assert.ok(events.filter(e=>e.kind==='feedback').every(e=>e.feedback.evidence==='insufficient_data'))
})
test('native missing measurement degrades to exploration',async t=>{const {ctx}=await setup(t,{fast:null,slow:null,final:null});const p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest});assert.equal(r.mode,'explore');assert.equal(r.conclusion,'insufficient_evidence');assert.equal(r.budget.fastAttempts,0)})
test('native cancellation preserves an uncertain charged boundary without blind rerun',async t=>{class Waiting extends FixtureExecutor{async execute({signal}){return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))}}const {ctx}=await setup(t,{}, {executor:Waiting});const p=ctx.duoController.plan(),abort=new AbortController();const run=ctx.duoController.run({planDigest:p.planDigest,signal:abort.signal});setTimeout(()=>abort.abort(),20);const r=await run;assert.equal(r.status,'cancelled');assert.equal(r.budget.costUsd,null);assert.equal((await ctx.duoController.run({planDigest:p.planDigest})).reusedArtifacts,true)})
test('incomplete final evidence cannot justify retaining or replacing baseline',async t=>{class MissingFinal extends FixtureEvaluators{async evaluate(args){const r=await super.evaluate(args);if(args.tier==='final')delete r.metrics.quality;return r}}const {ctx}=await setup(t,{}, {evaluators:MissingFinal});const p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest});assert.equal(r.conclusion,'insufficient_evidence')})
test('incomparable slow evidence never penalizes a family',async t=>{class InvalidSlow extends FixtureEvaluators{async evaluate(args){const r=await super.evaluate(args);if(args.tier==='slow'&&args.candidate.id!=='baseline')delete r.metrics.quality;return r}}const {ctx}=await setup(t,{generations:3},{evaluators:InvalidSlow});const p=ctx.duoController.plan();await ctx.duoController.run({planDigest:p.planDigest});const feedback=ctx.duoController.status(p.runId).events.filter(e=>e.kind==='feedback').at(-1).feedback;assert.deepEqual(feedback.penalizedFamilies,[]);assert.equal(feedback.evidence,'insufficient_data')})
test('late cost receipt drains before native journal disposal',async t=>{class Late extends FixtureExecutor{describe(){return descriptor('late',{reservationUsd:0.2,permissions:{paid:true,network:false,externalSideEffects:false}})}async execute(){await new Promise(r=>setTimeout(r,50));return {artifact:'x',costUsd:0.1}}}const {ctx,fibers,runs}=await setup(t,{permissions:{paid:true,network:false,externalSideEffects:false},budget:{maxCostUsd:1,maxSessions:100,maxFastEvals:20,maxSlowEvals:10,maxWallTimeMs:10000}},{executor:Late});const p=ctx.duoController.plan(),abort=new AbortController(),running=ctx.duoController.run({planDigest:p.planDigest,signal:abort.signal});setTimeout(()=>abort.abort(),10);await running;for(const f of [...fibers].reverse())await f.dispose();const other=new Context(),j=await other.plugin(SqliteJournal,{root:runs}),b=await other.plugin(ReservedBudget);t.after(async()=>{await b.dispose();await j.dispose()});assert.equal(other.duoBudget.inspect(p.runId).costUsd,0.1)})
test('changing an injected comparison provider invalidates an inspected plan',async t=>{const {ctx,fibers}=await setup(t);const old=ctx.duoController.plan();await fibers[2].dispose();class Changed extends WeightedComparator{describe(){return {id:'another-comparison',version:'2',deterministic:true}}}const replacement=await ctx.plugin(Changed);t.after(()=>replacement.dispose());const fresh=ctx.duoController.plan();assert.notEqual(fresh.planDigest,old.planDigest);await assert.rejects(ctx.duoController.run({planDigest:old.planDigest}),{code:'DUO_PLAN_CHANGED'})})
test('changing shipped fixture execution config invalidates the same contract and run root',async t=>{
 const {ctx,fibers,runs}=await setup(t)
 for(const i of [7,8,9])await fibers[i].dispose()
 const original=await ctx.plugin(ExampleProviders,{waitForAbort:false})
 const old=ctx.duoController.plan()
 await original.dispose()
 const replacement=await ctx.plugin(ExampleProviders,{waitForAbort:true})
 t.after(()=>replacement.dispose())
 assert.notEqual(ctx.duoController.plan().planDigest,old.planDigest)
 await assert.rejects(ctx.duoController.run({planDigest:old.planDigest}),{code:'DUO_PLAN_CHANGED'})
 assert.equal(existsSync(runs),false)
})
const cnyProvider=Base=>class extends Base{
 describe(){const convert=d=>{const {reservationUsd,...rest}=d;return {...rest,currency:'CNY',reservationCny:reservationUsd}};const d=super.describe();return Array.isArray(d)?d.map(convert):convert(d)}
 async execute(args){const {costUsd,...r}=await super.execute(args);return {...r,currency:'CNY',costCny:costUsd}}
 async propose(args){const {costUsd,...r}=await super.propose(args);return {...r,currency:'CNY',costCny:costUsd}}
 async evaluate(args){const {costUsd,...r}=await super.evaluate(args);return {...r,currency:'CNY',costCny:costUsd}}
}
const cnyBudget={currency:'CNY',maxCostCny:0,maxSessions:100,maxFastEvals:20,maxSlowEvals:10,maxWallTimeMs:10000}
const cnyProviders={generator:cnyProvider(FixtureGenerator),executor:cnyProvider(FixtureExecutor),evaluators:cnyProvider(FixtureEvaluators)}
test('exact content duplicates across IDs and generations are retained but not executed or scored again',async t=>{
 let executions=0
 class Same extends cnyProviders.generator{async propose({champion,quotas,nextId}){return {currency:'CNY',costCny:0,candidates:Array.from({length:quotas.exploit},()=>({id:nextId(),parentId:champion.id,parentVersion:champion.version,mode:'exploit',family:'fixed-control',hypothesis:'Different descriptions do not imply different applied content',delta:{kind:'cordis-overlay',target:'system-prompt',persona:'{{model}} in {{cwd}} answer clearly.'}}))}}}
 class Counting extends cnyProviders.executor{async execute(args){executions++;return super.execute(args)}}
 const {ctx}=await setup(t,{budget:cnyBudget,slow:null,final:null,quotas:{exploit:2,explore:0,innovate:0}},{...cnyProviders,generator:Same,executor:Counting})
 const p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest});assert.equal(r.stopReason,'no_new_candidates');assert.equal(executions,2)
 const report=buildReport(ctx.duoController.status(p.runId)),duplicates=report.candidates.filter(c=>c.duplicateOf)
 assert.equal(duplicates.length,3);assert.ok(duplicates.every(c=>c.duplicateOf==='dl-0001'&&c.status==='duplicate_skipped'&&c.fast.state==='NOT_EVALUATED'&&c.fast.metrics===null))
 assert.equal(r.budget.fastAttempts,2);assert.equal(r.budget.phases.generation.operations,2)
})
test('baseline duplicates skip by default while explicitly authorized noise repeats execute and retain accounting',async t=>{
 for(const noise of [false,true]){
  let executions=0
  class Repeat extends cnyProviders.generator{async propose({champion,nextId}){return {currency:'CNY',costCny:0,candidates:[{id:nextId(),parentId:champion.id,parentVersion:champion.version,mode:'exploit',family:'noise-control',hypothesis:'Repeat to measure stochastic variation',...(noise?{repeat:{purpose:'noise_measurement',reason:'One preregistered variance sample'}}:{}),delta:{kind:'cordis-overlay',target:'system-prompt',persona:champion.persona}}]}}}
  class Charged extends cnyProviders.executor{describe(){return {...super.describe(),reservationCny:.01,permissions:{paid:true,network:false,externalSideEffects:false}}}async execute(args){executions++;return {...await super.execute(args),costCny:.01}}}
  const {ctx}=await setup(t,{budget:{...cnyBudget,maxCostCny:.1},permissions:{paid:true,network:false,externalSideEffects:false},allowNoiseRepeats:noise,generations:1,slow:null,final:null,quotas:{exploit:1,explore:0,innovate:0}},{...cnyProviders,generator:Repeat,executor:Charged})
  const p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest}),c=buildReport(ctx.duoController.status(p.runId)).candidates.find(c=>c.id!=='baseline')
  assert.equal(executions,noise?2:1);assert.equal(r.budget.costCny,noise?.02:.01);assert.equal(c.duplicateOf,'baseline')
  assert.equal(c.fast.state,noise?'EVALUATED':'NOT_EVALUATED');if(noise)assert.equal(c.repeat.reason,'One preregistered variance sample')
 }
})
test('invalid or unauthorized noise declarations refuse before candidate execution without refunding completed baseline work',async t=>{
 for(const [allow,repeat] of [[false,{purpose:'noise_measurement',reason:'unapproved'}],[true,{purpose:'noise_measurement',reason:''}],[true,{purpose:'bypass',reason:'invalid'}]]){
  let executions=0
  class Repeat extends cnyProviders.generator{async propose({champion,nextId}){return {currency:'CNY',costCny:0,candidates:[{id:nextId(),parentId:champion.id,parentVersion:champion.version,mode:'exploit',family:'noise',hypothesis:'Not sufficient authority',repeat,delta:{kind:'cordis-overlay',target:'system-prompt',persona:champion.persona}}]}}}
  class Counting extends cnyProviders.executor{async execute(args){executions++;return super.execute(args)}}
  const {ctx}=await setup(t,{budget:cnyBudget,allowNoiseRepeats:allow,generations:1,slow:null,final:null,quotas:{exploit:1,explore:0,innovate:0}},{...cnyProviders,generator:Repeat,executor:Counting})
  const p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest});assert.equal(r.error.code,'DUO_REPEAT_INVALID');assert.equal(executions,1)
 }
 const {ctx}=await setup(t,{allowNoiseRepeats:'yes'});assert.throws(()=>ctx.duoController.plan(),{code:'DUO_CONTRACT_INVALID'})
})
test('actual second-generation arguments consume different Slow facts and constraint verdicts through both feedback providers',async t=>{
 for(const rich of [false,true]){
  const inputs=[]
  for(const violate of [false,true]){
   const seen=[]
   class Recording extends cnyProviders.generator{async propose(args){seen.push(structuredClone(args.feedback));return super.propose(args)}}
   class ControlledSlow extends cnyProviders.evaluators{async evaluate(args){const r=await super.evaluate(args);if(args.tier==='slow'&&args.candidate.id!=='baseline'){r.metrics.quality=violate?.3:.6;r.metrics.safe=!violate;r.evidence=['PRIVATE_SLOW']}if(args.tier==='final')r.evidence=['PRIVATE_FINAL'];return r}}
   const {ctx,fibers}=await setup(t,{budget:cnyBudget},{...cnyProviders,generator:Recording,evaluators:ControlledSlow})
   if(rich){await fibers[4].dispose();const f=await ctx.plugin(HistoryFeedback);t.after(()=>f.dispose())}
   const p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest});assert.equal(r.status,'completed');assert.equal(seen.length,2)
   const feedback=seen[1],row=feedback.slowFeedback.observations.find(o=>o.candidateId==='dl-0001')
   assert.equal(row.slow.metrics.quality,violate?.3:.6);assert.equal(row.slow.metrics.safe,!violate)
   assert.equal(row.slowVerdict,violate?'constraint_violation':'better');assert.equal(row.slowDecision,violate?'incomparable':'accepted')
   assert.deepEqual(feedback.slowFeedback.constraints,p.spec.constraints);assert.equal(row.slow.evaluatorId,'fixture-slow');assert.equal(row.slow.tier,'slow')
   const event=ctx.duoController.status(p.runId).events.find(e=>e.kind==='feedback'&&e.generation===2)
   const operation=ctx.duoBudget.open(p.runId,p.spec.budget).operations().find(o=>o.request?.generation===2)
   assert.equal(event.feedbackDigest,digest(feedback));assert.equal(operation.request.feedbackDigest,event.feedbackDigest)
   assert.doesNotMatch(JSON.stringify(feedback),/PRIVATE_SLOW|PRIVATE_FINAL/);inputs.push(feedback)
  }
  assert.notDeepEqual(inputs[0].slowFeedback,inputs[1].slowFeedback)
 }
})
test('CNY controller completes both generations and final with currency-bound receipts',async t=>{
 const {ctx}=await setup(t,{budget:cnyBudget},cnyProviders),p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest})
 assert.equal(r.status,'completed');assert.equal(r.generationsRun,2);assert.equal(r.budget.costCny,0);assert.equal(r.budget.costUsd,undefined)
 assert.ok(r.final.length>0);assert.ok(ctx.duoBudget.open(p.runId,p.spec.budget).receipts().every(r=>r.currency==='CNY'))
})
test('a CNY contract rejects a USD provider and ambiguous dual-currency limits before execution',async t=>{
 const a=await setup(t,{budget:cnyBudget});assert.throws(()=>a.ctx.duoController.plan(),{code:'DUO_CURRENCY_MISMATCH'})
 const b=await setup(t,{budget:{...cnyBudget,maxCostUsd:0}},cnyProviders);assert.throws(()=>b.ctx.duoController.plan(),{code:'DUO_CURRENCY_MISMATCH'})
})
test('a provider returning the wrong currency leaves CNY exposure unresolved and stops paid work',async t=>{
 class Wrong extends cnyProviders.executor{async execute(){return {artifact:'wrong currency',costUsd:0.01}}}
 const {ctx}=await setup(t,{budget:cnyBudget},{...cnyProviders,executor:Wrong}),p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest})
 assert.equal(r.stopReason,'DUO_CURRENCY_MISMATCH');assert.equal(r.budget.costCny,null);assert.equal(r.budget.blockedReason,'DUO_COST_UNKNOWN');assert.equal(r.budget.operations,1)
})
test('CNY provider output with a USD tariff stays unknown rather than settling its numeric yuan claim',async t=>{
 class WrongTariff extends cnyProviders.executor{async execute(){return {currency:'CNY',costCny:.01,costEvidence:{currency:'CNY',pricing:{currency:'USD',inputUsdPerMillion:3}}}}}
 const {ctx}=await setup(t,{budget:cnyBudget},{...cnyProviders,executor:WrongTariff}),p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest})
 assert.equal(r.stopReason,'DUO_CURRENCY_MISMATCH');assert.equal(r.budget.costCny,null);assert.equal(r.budget.blockedReason,'DUO_COST_UNKNOWN')
})

test('native tie exploration records its reason and keeps adoption strict',async t=>{
 class Tied extends FixtureEvaluators{async evaluate(args){const out=await super.evaluate(args);out.metrics.quality=1;return out}}
 const h=await setup(t,{generations:1},{evaluators:Tied}),ctx=h.ctx
 // Replace the existing service through Cordis, without altering the core.
 await h.fibers[3].dispose()
 const fiber=await ctx.plugin(BoundedTieGate,{maxTies:1});t.after(()=>fiber.dispose())
 const p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest})
 assert.equal(r.status,'completed');assert.equal(r.championId,'baseline');assert.equal(r.conclusion,'retain_baseline')
 const status=ctx.duoController.status(p.runId),gate=status.events.find(e=>e.kind==='gate')
 assert.equal(gate.selected.length,1);assert.equal(gate.selected[0].reason,'WITHIN_EPSILON_DEEPER_TEST')
 assert.equal(gate.policy.maxTies,1)
 const candidateRows=status.events.filter(e=>e.kind==='candidate'&&e.candidateId!=='baseline'&&e.slow)
 assert.equal(new Set(candidateRows.map(e=>e.candidateId)).size,1)
})

test('gate provider configuration changes invalidate the inspected plan',async t=>{
 const {ctx,fibers}=await setup(t)
 await fibers[3].dispose()
 const first=await ctx.plugin(BoundedTieGate,{maxTies:1}),p=ctx.duoController.plan()
 await first.dispose()
 const second=await ctx.plugin(BoundedTieGate,{maxTies:2});t.after(()=>second.dispose())
 assert.notEqual(ctx.duoController.plan().planDigest,p.planDigest)
 await assert.rejects(()=>ctx.duoController.run({planDigest:p.planDigest}),{code:'DUO_PLAN_CHANGED'})
})
test('a replacement gate cannot bypass recorded hard constraints',async t=>{
 class Unsafe extends FixtureEvaluators{async evaluate(args){const value=await super.evaluate(args);if(args.candidate.id!=='baseline')value.metrics.safe=false;return value}}
 class BadGate extends TopKGate{select(comparison,ids){return ids.slice(0,1)}}
 const {ctx,fibers}=await setup(t,{generations:1},{evaluators:Unsafe});await fibers[3].dispose()
 const replacement=await ctx.plugin(BadGate);t.after(()=>replacement.dispose())
 const p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest})
 assert.equal(r.stopReason,'DUO_GATE_INVALID')
 assert.equal(r.budget.slowAttempts,1) // Baseline only; no candidate Slow work.
})

class ThreeEvaluators extends FixtureEvaluators {
 describe(){return ['fast','review','slow','final'].map(tier=>descriptor('fixture-'+tier,{tier,dataId:tier,metrics:['quality','safe','sample_size']}))}
}
async function threeStageSetup(t,overrides={},providers={}){
 const h=await setup(t,{}, {evaluators:ThreeEvaluators,...providers}),c={...h.contract,...overrides}
 const objective=c.fast;delete c.fast;delete c.slow
 c.searchStages=['fast','review','slow'].map((tier,i)=>({...objective,tier,evaluatorId:'fixture-'+tier,dataId:tier,
  purpose:['screen','rank','confirm'][i],informationGain:['Screen minimal cases','Review additional cases','Confirm broader cases'][i],maxEvaluations:10,topK:i===2?0:c.topK}))
 writeFileSync(h.experiment,JSON.stringify(c));return {...h,contract:c}
}
test('one stage skeleton executes three search tiers, feeds intermediate observations and isolates final',async t=>{
 const calls=[],feedback=[]
 class Traced extends FixtureExecutor{async execute(args){calls.push([args.candidate.id,args.tier]);return super.execute(args)}}
 class Seen extends FixtureGenerator{async propose(args){feedback.push(structuredClone(args.feedback));return super.propose(args)}}
 const {ctx}=await threeStageSetup(t,{}, {executor:Traced,generator:Seen}),p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest})
 assert.equal(r.status,'completed');assert.equal(r.generationsRun,2);assert.equal(r.conclusion,'recommend_candidate')
 assert.deepEqual(calls.slice(0,3),[['baseline','fast'],['baseline','review'],['baseline','slow']])
 assert.deepEqual(calls.filter(([id])=>id==='dl-0001').slice(0,3).map(([,tier])=>tier),['fast','review','slow'])
 assert.deepEqual(p.searchStages.map(s=>s.tier),['fast','review','slow'])
 assert.ok(feedback[1].reviewFeedback.observations.some(o=>o.review?.candidateId==='dl-0001'))
 assert.ok(!JSON.stringify(feedback).includes('"tier":"final"'))
 assert.equal(r.stageAttempts.review,2)
 assert.equal(r.budget.slowAttempts,calls.filter(([,tier])=>['review','slow','final'].includes(tier)).length)
 const status=ctx.duoController.status(p.runId),report=buildReport(status)
 assert.equal(report.candidates.find(c=>c.id==='dl-0001').review.state,'EVALUATED')
 assert.deepEqual(status.events.filter(e=>e.kind==='gate'&&e.generation===1).map(e=>[e.fromTier,e.toTier]),[['fast','review'],['review','slow']])
})
test('intermediate constraint failure prevents candidate Slow work and cannot adopt',async t=>{
 class UnsafeReview extends ThreeEvaluators{async evaluate(args){const r=await super.evaluate(args);if(args.tier==='review'&&args.candidate.id!=='baseline')r.metrics.safe=false;return r}}
 const {ctx}=await threeStageSetup(t,{generations:1},{evaluators:UnsafeReview}),p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest})
 assert.equal(r.status,'completed');assert.equal(r.championId,'baseline');assert.equal(r.stageAttempts.slow,1)
 assert.equal(buildReport(ctx.duoController.status(p.runId)).candidates.find(c=>c.id==='dl-0001').slow.state,'NOT_PROMOTED')
})
test('per-stage caps and evaluation-only share the same native monetary ledger',async t=>{
 const h=await threeStageSetup(t,{generations:1}),c=h.contract;c.searchStages[0].maxEvaluations=1;writeFileSync(h.experiment,JSON.stringify(c))
 const p=h.ctx.duoController.plan(),r=await h.ctx.duoController.run({planDigest:p.planDigest})
 assert.equal(r.stopReason,'DUO_STAGE_BUDGET_EXHAUSTED');assert.equal(r.stageAttempts.fast,1)
 const e=await threeStageSetup(t,{operation:'evaluate',generations:0,quotas:{exploit:0,explore:0,innovate:0}})
 const ep=e.ctx.duoController.plan(),er=await e.ctx.duoController.run({planDigest:ep.planDigest})
 assert.equal(er.status,'completed');assert.deepEqual(er.evaluations.map(e=>e.tier),['fast','review','slow','final'])
 assert.equal(er.budget.slowAttempts,3)
})
test('status marks an owner-dead interrupted run with an explicit next step',async t=>{
 const {ctx}=await setup(t),p=ctx.duoController.plan()
 const paused=await ctx.duoController.run({planDigest:p.planDigest,pauseAfter:'baseline'})
 assert.equal(paused.status,'paused');assert.equal(ctx.duoController.status(p.runId).interrupted,null)
 const dead={pid:2**22+12345,start:'0'},j=ctx.duoJournal.open(p.runId,{create:true})
 j.set('run',{...j.get('run'),owner:dead})
 let status=ctx.duoController.status(p.runId)
 assert.equal(status.interrupted.ownerActive,false);assert.equal(status.interrupted.resumable,true);assert.equal(status.interrupted.nextStep,'resume_from_checkpoint');assert.equal(status.interrupted.checkpointDigest,paused.checkpointDigest)
 const bare=ctx.duoJournal.open('bare-crash',{create:true});bare.claim('bare')
 bare.set('run',{...bare.get('run'),owner:dead})
 status=ctx.duoController.status('bare-crash')
 assert.equal(status.budget,null);assert.equal(status.interrupted.resumable,false);assert.equal(status.interrupted.nextStep,'start_a_new_run')
 assert.equal(typeof status.interrupted.guidance,'string')
})
test('cumulative cross-run cap validates as a positive same-currency amount before any journal creation',async t=>{
 const {ctx,experiment,contract,runs}=await setup(t)
 for(const [budget,code] of [[{...contract.budget,maxCumulativeCostUsd:0},'DUO_CONTRACT_INVALID'],[{...contract.budget,maxCumulativeCostUsd:-1},'DUO_CONTRACT_INVALID'],[{...contract.budget,maxCumulativeCostUsd:NaN},'DUO_CONTRACT_INVALID'],[{...contract.budget,maxCumulativeCostUsd:'1'},'DUO_CONTRACT_INVALID'],[{...contract.budget,maxCumulativeCostCny:1},'DUO_CURRENCY_MISMATCH']]){
  writeFileSync(experiment,JSON.stringify({...contract,budget}));assert.throws(()=>ctx.duoController.plan(),{code});assert.equal(existsSync(runs),false)
 }
 writeFileSync(experiment,JSON.stringify({...contract,budget:{...contract.budget,maxCumulativeCostUsd:1}}));assert.equal(typeof ctx.duoController.plan().planDigest,'string');assert.equal(existsSync(runs),false)
})
test('cumulative cross-run cap refuses a new run once retained settled spend plus its allowance exceeds it',async t=>{
 class Charged extends cnyProviders.executor{describe(){return {...super.describe(),reservationCny:.01,permissions:{paid:true,network:false,externalSideEffects:false}}}async execute(args){return {...await super.execute(args),costCny:.01}}}
 const budget={...cnyBudget,maxCostCny:.05,maxCumulativeCostCny:.08}
 const {ctx,contract,experiment,runs}=await setup(t,{budget,permissions:{paid:true,network:false,externalSideEffects:false},generations:1,slow:null,final:null,quotas:{exploit:1,explore:0,innovate:0}},{...cnyProviders,executor:Charged})
 const p=ctx.duoController.plan(),r=await ctx.duoController.run({planDigest:p.planDigest})
 assert.equal(r.status,'completed');assert.equal(r.budget.costCny,.02);assert.equal(readdirSync(runs).length,1)
 const again=await ctx.duoController.run({planDigest:p.planDigest});assert.equal(again.reusedArtifacts,true)
 // One byte of new budget identity is a new runId, but its full allowance no longer fits the frozen cumulative cap.
 writeFileSync(experiment,JSON.stringify({...contract,budget:{...budget,maxCumulativeCostCny:.06}}))
 assert.throws(()=>ctx.duoController.plan(),e=>{
  assert.equal(e.code,'DUO_CUMULATIVE_BUDGET_EXCEEDED');assert.equal(e.component,'duoBudget');assert.equal(typeof e.nextAction,'string')
  assert.deepEqual(e.cumulative,{currency:'CNY',knownCostCny:.02,maxCostCny:.05,maxCumulativeCostCny:.06});return true
 })
 assert.equal(readdirSync(runs).length,1)
 // Exact fit is admitted; omitting the cap preserves the previous per-run-only behavior.
 writeFileSync(experiment,JSON.stringify({...contract,budget:{...budget,maxCumulativeCostCny:.07}}))
 const p2=ctx.duoController.plan(),r2=await ctx.duoController.run({planDigest:p2.planDigest})
 assert.equal(r2.status,'completed');assert.deepEqual(ctx.duoBudget.inspect(p2.runId).cumulative,{currency:'CNY',knownCostCny:.04,maxCumulativeCostCny:.07,excludedCurrencies:[]})
 writeFileSync(experiment,JSON.stringify({...contract,budget:{...cnyBudget,maxCostCny:.05}}))
 const p3=ctx.duoController.plan(),r3=await ctx.duoController.run({planDigest:p3.planDigest})
 assert.equal(r3.status,'completed');assert.deepEqual(ctx.duoBudget.inspect(p3.runId).cumulative,{currency:'CNY',knownCostCny:.06,maxCumulativeCostCny:null,excludedCurrencies:[]})
})
