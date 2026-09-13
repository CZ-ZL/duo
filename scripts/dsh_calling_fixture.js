// Scripted model replies test the real DSH Agent/tool loop, not model autonomy.
import {LlmAdapter} from '@deepseek-ai/dsh-llm'
import {writeFileSync} from 'node:fs'
import {join} from 'node:path'
export const name='duo-calling-model-fixture'
export const inject=['llm']
export function apply(ctx,config={}){
 const jsonProbes=[]
 let prepareJson=async()=>({fields:{}})
 ctx.inject(['deepseekLlmApiExtensions'],c=>c.effect(()=>{
  prepareJson=request=>c.deepseekLlmApiExtensions.prepare(request)
  return()=>{prepareJson=async()=>({fields:{}})}
 }))
 class Adapter extends LlmAdapter{
  async *stream(options){
   const prepared=await prepareJson({sessionId:options.sessionId,body:{model:options.model},signal:options.signal})
   jsonProbes.push({sessionId:options.sessionId,fields:prepared.fields,meaning:'Fixture registry preparation only; no HTTP request or acceptance.'})
   writeFileSync(join(process.env.DSH_HOME,'..','fixture-json-output-probes.json'),JSON.stringify(jsonProbes,null,2)+'\n')
   const values=options.messages.flatMap(m=>(m.content??[]).flatMap(c=>c.type==='tool-result'?c.content:[c]).filter(c=>c.type==='text').flatMap(c=>{try{return [JSON.parse(c.text)]}catch{return []}}))
   const plan=values.find(x=>x.planDigest&&x.spec),run=values.find(x=>x.status==='completed'&&x.planDigest)
   const n=options.messages.filter(m=>m.role==='assistant').length
   const calls=n===0?[['dualloop_discover',{}]]:n===1?[['dualloop_run',{planDigest:'deliberately-stale'}]]:
    n===2?[['dualloop_plan',{}]]:n===3?[['dualloop_run',{planDigest:plan?.planDigest}]]:
    n===4?[['dualloop_status',{runId:plan?.runId}],['dualloop_budget_status',{runId:plan?.runId}],['dualloop_run',{planDigest:plan?.planDigest}]]:[]
   for(const [index,[name,args]] of calls.entries())yield {type:'tool-call-delta',index,id:'caller-'+n+'-'+index,name,argumentsDelta:JSON.stringify(args)}
   if(!calls.length)yield {type:'text-delta',index:0,text:JSON.stringify({runId:run?.runId,conclusion:run?.conclusion,evidenceKind:'fixture',improvementProven:false,explanation:'The configured inner providers are static fixtures; this validates plugin use only.'})}
   if(!config.missingUsage)yield {type:'usage',usage:{inputTokens:100,cacheReadTokens:0,outputTokens:30,totalTokens:130}}
   yield {type:'finish',reason:{kind:calls.length?'tool-calls':'stop'}}
  }
 }
 ctx.llm.registerAdapter(['duo-caller-fixture'],new Adapter())
}
