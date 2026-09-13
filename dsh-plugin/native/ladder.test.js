import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {mkdtempSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import JsonContract from './contract.js'
import PersonaTarget from './target.js'
import NativeController from './controller.js'
import {WeightedComparator,TopKGate} from './policies.js'
import HistoryFeedback from './history-feedback.js'
import {SqliteJournal,ReservedBudget} from './store.js'
import {EvaluatorsService} from './definitions.js'
import {FixtureGenerator,FixtureExecutor,descriptor} from './test-fixtures.js'
import {buildReport} from './observer.js'

const TIERS=['unit','benchmark','holdout','audit']
class LadderEvaluators extends EvaluatorsService {
 describe(){return [...TIERS,'final'].map(tier=>descriptor('fixture-'+tier,{tier,dataId:tier,metrics:['quality','safe','sample_size']}))}
 async evaluate({candidate,artifact,tier}){return {candidateId:candidate.id,evaluatorId:'fixture-'+tier,version:'1',dataId:tier,tier,ok:true,metrics:{quality:artifact.includes('answer clearly')?1:0,safe:true,sample_size:2},costUsd:0,evidence:[]}}
}
async function setup(t,{Executor=FixtureExecutor,stageCaps={unit:10,benchmark:6,holdout:5,audit:4},generations=2}={}){
 const root=mkdtempSync(join(tmpdir(),'duo-ladder-')),target=join(root,'persona.txt'),experiment=join(root,'experiment.json'),runs=join(root,'runs')
 writeFileSync(target,'You are {{model}} in {{cwd}}.')
 const objective=tier=>({evaluatorId:'fixture-'+tier,version:'1',dataId:tier,weights:{quality:1},direction:'maximize',metric:'quality'})
 const contract={version:1,id:'ladder-fixture',target:{kind:'dsh-persona',path:target},
  searchStages:TIERS.map((tier,i)=>({...objective(tier),tier,purpose:i===0?'screen':i===TIERS.length-1?'confirm':'rank',
   informationGain:'Declared credibility level '+tier,maxEvaluations:stageCaps[tier],topK:i===TIERS.length-1?0:1})),
  final:objective('final'),constraints:[{metric:'safe',op:'==',value:true}],epsilon:0.01,minSamples:2,generations,
  quotas:{exploit:1,explore:1,innovate:1},topK:1,budget:{maxCostUsd:0,maxSessions:200,maxFastEvals:20,maxSlowEvals:40,maxWallTimeMs:10000}}
 writeFileSync(experiment,JSON.stringify(contract))
 const ctx=new Context(),fibers=[]
 for(const [P,config]of [[JsonContract,{experiment}],[PersonaTarget],[WeightedComparator],[TopKGate],[HistoryFeedback],[SqliteJournal,{root:runs}],[ReservedBudget],[FixtureGenerator],[Executor],[LadderEvaluators],[NativeController]])fibers.push(await ctx.plugin(P,config))
 t.after(async()=>{for(const f of fibers.reverse())await f.dispose()})
 return {ctx,root,target,experiment,runs,contract}
}
test('custom ladder: cascade order, stage attempts, pool accounting and observer columns',async t=>{
 const evaluated=[]
 class Counted extends FixtureExecutor{async execute(args){evaluated.push(args.candidate.id+':'+args.tier);return super.execute(args)}}
 const {ctx,experiment,contract}=await setup(t,{Executor:Counted})
 const p=ctx.duoController.plan()
 assert.deepEqual(p.searchStages.map(s=>s.tier),TIERS)
 assert.equal(p.spec.mode,'optimize')
 const result=await ctx.duoController.run({planDigest:p.planDigest})
 assert.equal(result.status,'completed');assert.equal(result.generationsRun,2)
 // Every candidate measurement flows unit → benchmark → holdout → audit; nothing skips a rung.
 const order=['unit','benchmark','holdout','audit','final']
 for(const id of new Set(evaluated.map(x=>x.split(':')[0]))){
  const seen=evaluated.filter(x=>x.startsWith(id+':')).map(x=>x.split(':')[1])
  assert.ok(seen.every((tier,i)=>!i||order.indexOf(tier)>order.indexOf(seen[i-1])),id+' tier order is monotonic: '+seen.join(','))
 }
 assert.deepEqual(Object.keys(result.stageAttempts),TIERS)
 assert.ok(result.stageAttempts.unit<=10&&result.stageAttempts.benchmark<=6&&result.stageAttempts.holdout<=5&&result.stageAttempts.audit<=4)
 // First rung spends the cheap pool; deeper rungs and final spend the expensive pool.
 assert.equal(result.budget.fastAttempts,result.stageAttempts.unit)
 assert.equal(result.budget.slowAttempts,result.stageAttempts.benchmark+result.stageAttempts.holdout+result.stageAttempts.audit+result.final.length)
 // Observer renders the caller's rung names, not a fixed vocabulary.
 const status=ctx.duoController.status(p.runId),report=buildReport(status)
 assert.ok(report.text.includes('Unit | Benchmark | Holdout | Audit'))
 const candidate=report.candidates.find(c=>c.id!=='baseline'&&c.unit.state==='EVALUATED')
 assert.ok(candidate&&['benchmark','holdout','audit','final'].every(t=>candidate[t]))
 assert.ok(report.objectives.audit&&report.objectives.final)
 assert.deepEqual([...new Set(status.events.filter(e=>e.kind==='gate').flatMap(e=>[e.fromTier,e.toTier]))],TIERS)
 assert.ok(status.events.some(e=>e.kind==='feedback'&&e.feedback))
 // Warm start consumes this run's history under its own tier names.
 writeFileSync(experiment,JSON.stringify({...contract,id:'ladder-warm',warmStart:{runIds:[p.runId],fixturePolicy:'ideas_only'}}))
 const warm=ctx.duoController.plan()
 assert.equal(warm.warmStart.mode,'warm_start')
 assert.ok(warm.warmStart.context.records.length>0)
 assert.ok(warm.warmStart.context.records.every(r=>r.source.evaluators.every(e=>TIERS.includes(e.tier))))
})
test('a stage evaluation cap clamps gate promotion at the frozen ladder boundary',async t=>{
 const evaluated=[]
 class Counted extends FixtureExecutor{async execute(args){evaluated.push(args.tier);return super.execute(args)}}
 const {ctx}=await setup(t,{Executor:Counted,stageCaps:{unit:10,benchmark:10,holdout:10,audit:1},generations:1})
 const p=ctx.duoController.plan(),result=await ctx.duoController.run({planDigest:p.planDigest})
 // The baseline alone exhausts the terminal rung; the holdout gate admits nobody.
 assert.equal(result.status,'completed')
 assert.equal(result.stageAttempts.audit,1)
 assert.equal(evaluated.filter(x=>x==='audit').length,1)
 assert.ok(evaluated.some(x=>x==='holdout'))
})
