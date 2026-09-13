import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import MethodFeedback from './method-feedback.js'

const quotas={exploit:1,explore:1,innovate:1}
const options={fastMetrics:['task_pass_rate'],upperMetric:'task_pass_rate',tiers:['fast','slow']}
const measurement=(id,quality,tier='fast')=>({candidateId:id,evaluatorId:'eval-'+tier,version:'1',dataId:tier,tier,ok:true,
 metrics:{task_pass_rate:quality,sample_size:6},evidence:[{kind:'executed_python_unittest',tier,privateTest:'PRIVATE_SOURCE',rows:[
  {taskId:tier==='fast'?'fast-a':'slow-a',status:'completed',taskPassed:false,passed:0,planned:1,receiptPath:'/private/receipt',
   tests:[{name:'test_public_behavior',status:'failed',error:tier==='fast'?'observed wrong return':'RAW_SLOW_ERROR',source:'PRIVATE_SOURCE'}]}]}]})
const entries=()=>[
 {candidateId:'baseline',generation:0,mode:'baseline',family:'baseline',fast:measurement('baseline',.8),fastScore:.8,slow:measurement('baseline',.9,'slow')},
 {candidateId:'rejected',parentId:'baseline',parentVersion:'base',candidateVersion:'candidate-hash',generation:1,mode:'exploit',family:'local',
  hypothesis:'Explicit assumption that failed',delta:{kind:'cordis-overlay',persona:'candidate with {{model}}'},fast:measurement('rejected',.4),fastScore:.4,fastVerdict:'not_better',
  slow:measurement('rejected',.1,'slow'),slowVerdict:'not_better',slowDecision:'rejected',status:'rejected',final:{secret:'FINAL_SECRET'}}]

async function setup(t,method,contextMode='history'){
 const root=mkdtempSync(join(tmpdir(),'duo-history-input-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
 const dataset={version:1,responseMode:'python-code-v1',responseInstructions:'Return source strings.'}
 for(const tier of ['fast','slow','final'])dataset[tier]={id:tier,tasks:[{id:tier+'-a',input:'Implement '+tier+' function.'}]}
 const datasetPath=join(root,'dataset.json');writeFileSync(datasetPath,JSON.stringify(dataset))
 const ctx=new Context(),fiber=await ctx.plugin(MethodFeedback,{method,datasetPath,contextMode});t.after(()=>fiber.dispose())
 return ctx.duoFeedback
}

test('history mode gives B2 rejected deltas and measured Fast failures, preserving source events',async t=>{
 const service=await setup(t,'B2'),source=entries(),before=structuredClone(source),feedback=service.summarize(source,quotas,options)
 assert.equal(feedback.historyCompleteness,'all_latest_candidates')
 assert.deepEqual(feedback.history.map(h=>h.candidateId),['baseline','rejected'])
 assert.equal(feedback.history[1].delta.persona,'candidate with {{model}}')
 assert.equal(feedback.history[1].hypothesis,'Explicit assumption that failed')
 assert.equal(feedback.developmentMeasurements[1].rows[0].tests[0].error,'observed wrong return')
 assert.equal(feedback.slowFeedback.observations.find(x=>x.candidateId==='rejected').slow.metrics.task_pass_rate,.1)
 assert.doesNotMatch(JSON.stringify(feedback),/PRIVATE_SOURCE|RAW_SLOW_ERROR|FINAL_SECRET|\/private\/receipt/)
 assert.deepEqual(source,before)
})

test('history ablation removes explicit Slow through history as well as the summary',async t=>{
 const b2=await setup(t,'B2'),b3=await setup(t,'B3'),source=entries()
 const full=b2.summarize(source,quotas,options),removed=b3.summarize(source,quotas,options)
 assert.equal(removed.historyCompleteness,'all_latest_candidates')
 assert.equal(removed.history.length,2)
 assert.equal(removed.history[1].delta.persona,full.history[1].delta.persona)
 assert.deepEqual(removed.developmentMeasurements,full.developmentMeasurements)
 assert.deepEqual(removed.quotas,full.quotas)
 for(const key of ['slowFeedback','fastSlowCorrelation','penalizedFamilies','failedRegions','championLineage','evidence'])assert.equal(removed[key],undefined)
 for(const row of removed.history)for(const key of ['slow','slowDecision','slowVerdict','status'])assert.equal(row[key],undefined)
 assert.deepEqual(removed.families,{local:{fastAvg:.4}})
})

test('legacy method context remains available under its own version',async t=>{
 const legacy=await setup(t,'B2','legacy'),history=await setup(t,'B2')
 assert.equal(legacy.summarize(entries(),quotas,options).history,undefined)
 assert.notEqual(legacy.describe().version,history.describe().version)
 assert.notEqual(legacy.describe().configDigest,history.describe().configDigest)
})
