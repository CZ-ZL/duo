// Method-study adapters, composed through the existing Feedback service.
// This is preparation code; an adapter is not evidence of an effective ablation.
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import Schema from '@deepseek-ai/schemastery'
import ConservativeFeedback from '@dual-loop/dsh-plugin/feedback'
import HistoryFeedback from '@dual-loop/dsh-plugin/history-feedback'
import {digest} from '@dual-loop/dsh-plugin/contract'
import {readDataset} from '@dual-loop/dsh-plugin/model-accounting'

export function publicDevelopmentTasks(dataset){
 return [dataset.fast,...dataset.slow?[dataset.slow]:[]].flatMap(s=>s.tasks.map(({id,input})=>({id,input})))
}

// Same original development cases and scoring; no new questions or answer keys.
export function singleLoopData(dataset,answerKey){
 if(answerKey?.datasetDigest!==digest(dataset)||!dataset.slow)throw new Error('Original frozen task/key with Fast and Slow is required')
 const data=structuredClone(dataset),key=structuredClone(answerKey)
 data.fast={id:dataset.fast.id+'-full-development',tasks:[...data.fast.tasks,...data.slow.tasks]}
 delete data.slow
 key.splits.fast={...key.splits.fast,...key.splits.slow};delete key.splits.slow
 key.datasetDigest=digest(data)
 return {dataset:data,answerKey:key,derivation:{kind:'same_development_union',sourceDatasetDigest:digest(dataset),
  datasetDigest:key.datasetDigest,sourceSplits:[dataset.fast.id,dataset.slow.id],finalUnchanged:true}}
}

// Code keys bind the actual file bytes and have flat task rows. Keep the fact
// derivation above intact; returning serialized bytes prevents hash/rewrite drift.
export function singleLoopCodeData(datasetBytes,answerKey){
 const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
 if(!(Buffer.isBuffer(datasetBytes)||typeof datasetBytes==='string')||answerKey?.datasetSha256!==sha(datasetBytes))
  throw new Error('Code dataset/key byte identity mismatch')
 const dataset=JSON.parse(datasetBytes)
 if(dataset.responseMode!=='python-code-v1'||['fast','slow','final'].some(t=>!Array.isArray(dataset[t]?.tasks)||!dataset[t].tasks.length))
  throw new Error('Code derivation needs original nonempty Fast/Slow/final splits')
 const tasks=['fast','slow','final'].flatMap(t=>dataset[t].tasks),ids=tasks.map(t=>t.id)
 if(new Set(ids).size!==ids.length)throw new Error('Code development and final tasks must be disjoint')
 if(tasks.some(t=>typeof t.id!=='string'||typeof t.input!=='string'||!t.input.trim()||typeof answerKey.tasks?.[t.id]?.test!=='string')||Object.keys(answerKey.tasks??{}).length!==tasks.length)
  throw new Error('Every public code task requires exactly one private test row')
 const data=structuredClone(dataset),key=structuredClone(answerKey)
 data.fast={id:dataset.fast.id+'-full-development',tasks:[...data.fast.tasks,...data.slow.tasks]}
 delete data.slow
 if(key.propertyTiers?.includes('slow'))key.propertyTiers=[...new Set(key.propertyTiers.map(t=>t==='slow'?'fast':t))]
 const bytes=Buffer.from(JSON.stringify(data,null,2)+'\n')
 key.datasetSha256=sha(bytes)
 return {dataset:data,datasetBytes:bytes,answerKey:key,derivation:{kind:'same_code_development_union',
  sourceDatasetSha256:answerKey.datasetSha256,datasetSha256:key.datasetSha256,
  sourceSplits:[dataset.fast.id,dataset.slow.id],finalUnchanged:true,originalTestsUnchanged:true}}
}

const fastOnly=entries=>entries.map(e=>Object.fromEntries(Object.entries(e).filter(([key])=>
 !/^(slow|review|final)/.test(key)&&key!=='status')))
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value[k]!==undefined).map(k=>[k,structuredClone(value[k])]))

function codeDevelopmentRows(evidence,tasks,maxTestDetails=0){
 if(!Array.isArray(evidence?.rows)||evidence.tier!==undefined&&evidence.tier!=='fast')return null
 const ids=new Set(tasks.map(t=>t.id))
 const detail=value=>{const row=pick(value,['name','status','error']);if(maxTestDetails&&typeof row.error==='string')row.error=row.error.slice(0,160);return row}
 // Candidate program text, private test source and filesystem receipt paths are
 // not feedback. Preserve measured failures and timing on public development IDs.
 return evidence.rows.filter(r=>r&&ids.has(r.taskId)).map(r=>({
  ...pick(r,['taskId','status','taskPassed','passed','planned','wallTimeMs','error']),
  ...(maxTestDetails&&typeof r.error==='string'?{error:r.error.slice(0,160)}:{}),
  tests:Array.isArray(r.tests)?(maxTestDetails?r.tests.filter(t=>t.status!=='passed').slice(0,maxTestDetails):r.tests).map(detail):[],
 }))
}

// Explicit ablation keeps the same already-computed quotas and parent lineage.
// Raw Slow, Slow-derived status and verdicts must not survive via rich history.
export function withoutExplicitSlow(result){
 return {quotas:structuredClone(result.quotas),
  families:Object.fromEntries(Object.entries(result.families??{}).map(([name,value])=>[name,{fastAvg:value.fastAvg}])),
  ...result.history?{history:result.history.map(row=>pick(row,['candidateId','parentId','parentVersion','candidateVersion','generation','mode','family','operatorId','hypothesis','delta','fast','fastScore','fastVerdict'])),
   historyCompleteness:result.historyCompleteness,historyLimitations:['Explicit upper-stage measurements and decisions removed; parent selection and quotas remain indirect effects.']}: {},
  ...result.developmentMeasurements?{developmentMeasurements:structuredClone(result.developmentMeasurements)}:{},
  ...result.developmentTasks?{developmentTasks:structuredClone(result.developmentTasks)}:{}}
}

export default class MethodFeedback extends ConservativeFeedback {
 static Config=Schema.object({method:Schema.union(['B1','B2','B3']).required(),datasetPath:Schema.string().required(),contextMode:Schema.union(['legacy','history']).default('legacy'),maxTestDetails:Schema.natural().max(32).default(0)})
 constructor(ctx,config){
  super(ctx)
  if(!['B1','B2','B3'].includes(config?.method))throw new Error('Explicit B1/B2/B3 method required')
  const dataset=readDataset(config.datasetPath)
  this.method=config.method;this.tasks=publicDevelopmentTasks(dataset);this.codeMode=dataset.responseMode==='python-code-v1'
  this.contextMode=config.contextMode??'legacy'
  this.maxTestDetails=config.maxTestDetails??0
  if(!Number.isSafeInteger(this.maxTestDetails)||this.maxTestDetails<0||this.maxTestDetails>32||this.maxTestDetails&&!this.codeMode)throw new Error('Bounded test details require code mode and an integer limit0..32')
  if(!['legacy','history'].includes(this.contextMode)||this.contextMode==='history'&&!this.codeMode)throw new Error('History method context requires the code study')
  this.configDigest=digest({method:this.method,contextMode:this.contextMode,...this.maxTestDetails?{maxTestDetails:this.maxTestDetails,maxErrorChars:160}:{},tasks:this.tasks,implementation:readFileSync(new URL(import.meta.url),'utf8')})
 }
 describe(){return {id:this.codeMode?'code-method-feedback':'fact-method-feedback',version:this.maxTestDetails?'4':this.contextMode==='history'?'3':'2',method:this.method,contextMode:this.contextMode,configDigest:this.configDigest,deterministic:true,
  publicTaskContext:'same_complete_development_documents_no_keys_or_final',
  ...this.maxTestDetails?{testDetailPolicy:{maxFailedTestsPerTask:this.maxTestDetails,maxErrorChars:160,completeTaskCounts:true,completeRawReceipts:'Retained in evaluation artifacts'}}:{},
  explicitSlowFeedback:this.method==='B2',indirectSlowEffects:this.method==='B3'?['unchanged_parent_selection','unchanged_computed_quotas']:[],
  limits:'Method adapters require frozen run/input operation checks; no causal or effectiveness claim.'}}
 summarize(entries,quotas,options={}){
  let result
  if(this.method==='B1'||this.contextMode==='history'){
   // Reuse existing complete candidate history; only the single measured tier
   // enters B1, including actual errors rather than selected successful rows.
   const fast=this.method==='B1'?fastOnly(entries):entries
   result=HistoryFeedback.prototype.summarize.call({exclusions:[]},fast,quotas,options)
   result.developmentMeasurements=[...new Map(fast.map(e=>[e.candidateId,e])).values()].map(e=>{
    const evidence=e.fast?.evidence?.find(x=>x.kind===(this.codeMode?'executed_python_unittest':'deterministic_fact_support_measurement'))
    const rows=this.codeMode?codeDevelopmentRows(evidence,this.tasks,this.maxTestDetails):evidence?.rows
    return {candidateId:e.candidateId,generation:e.generation??0,measurement:result.history.find(h=>h.candidateId===e.candidateId)?.fast??null,
     rowAvailability:Array.isArray(rows)?this.maxTestDetails?'PROVIDED_BOUNDED_FAILED_TEST_DETAILS':'PROVIDED':'NOT_PROVIDED',rows:structuredClone(rows??[])}
   })
   if(this.method==='B3')result=withoutExplicitSlow(result)
  }else{
   result=super.summarize(entries,quotas,options)
   if(this.method==='B3')result={quotas:result.quotas,
    families:Object.fromEntries(Object.entries(result.families).map(([name,value])=>[name,{fastAvg:value.fastAvg}]))}
  }
  return {...result,developmentTasks:structuredClone(this.tasks)}
 }
}
