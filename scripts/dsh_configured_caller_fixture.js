// Scripted transport only. The real DSH AgentLoop, attachment, native execution,
// evaluator function and accounting run normally. No live autonomy claim.
import {LlmAdapter} from '@deepseek-ai/dsh-llm'
import {readFileSync} from 'node:fs'
export const name='duo-configured-caller-fixture'
export const inject=['llm']
export function apply(ctx,config){
 const resources=JSON.parse(readFileSync(config.resourcesPath,'utf8')),key=JSON.parse(readFileSync(config.answerKeyPath,'utf8'))
 class Adapter extends LlmAdapter{
  async *stream(options){
   if(options.sessionId.startsWith('duo-caller-')){
    const texts=options.messages.flatMap(m=>(m.content??[]).flatMap(c=>c.type==='tool-result'?c.content:[c]).filter(c=>c.type==='text').map(c=>c.text))
    const values=texts.flatMap(text=>{try{return [JSON.parse(text)]}catch{return []}}),resource=values.map(x=>x.data??x).find(x=>x.service==='factMeasurement')
    const matched=texts.map(text=>/^Defined ([^/]+)\/([^ ]+) /.exec(text)).find(Boolean),defined=matched?{pluginId:matched[1],packageId:matched[2]}:values.find(x=>x.pluginId&&x.packageId)
    const plan=values.find(x=>x.spec&&x.planDigest),run=values.find(x=>['completed','failed'].includes(x.status)&&x.planDigest&&!x.spec&&!x.reportVersion),report=values.find(x=>x.reportVersion)
    const n=options.messages.filter(m=>m.role==='assistant').length,contract=resources.firstContract
    const schedule=[
     [['cordis_inspect_query',{platform:'host',provider:'FactMeasurement',method:'describe',input:{}}]],
     [['cordis_define',{plugin:{kind:'new',idPrefix:'fact'},name:'Use supplied fact evaluator',purpose:'Attach the authorized existing measurement to DUO',code:{host:resource?.bridgeCode}}]],
     [['cordis_run',{pluginId:defined?.pluginId,packageId:defined?.packageId,mode:'run'}]],
     [['dualloop_plan',{view:'summary'}]],
     [['dualloop_run',{planDigest:plan?.planDigest}]],
     [['dualloop_report',{runId:run?.runId,view:'summary'}]]
    ],calls=schedule[n]??[]
    for(const [index,[name,args]] of calls.entries())yield {type:'tool-call-delta',index,id:'configured-'+n+'-'+index,name,argumentsDelta:JSON.stringify(args)}
    if(!calls.length)yield {type:'text-delta',index:0,text:JSON.stringify({runId:run?.runId,conclusion:report?.conclusion,evaluatorId:'fact-support-fast',improvementProven:false,innerLedgerCostCny:report?.budget.costCny,evidenceKind:'fixture',costAccounting:'final_total_ledger_required',explanation:'The supplied Fast task was evaluated once with the existing deterministic keyed fact/support measurement. No candidate search or final confirmation occurred. Fixture answers and fees verify functionality only. Refer to total-cost-receipts.json for the full Caller and inner cost without adding overlapping ledger views.'})}
    if(!config.missingUsage)yield {type:'usage',usage:{inputTokens:100,cacheReadTokens:0,outputTokens:30,totalTokens:130}}
    yield {type:'finish',reason:{kind:calls.length?'tool-calls':'stop'}}
   }else{
    const input=JSON.parse(options.messages.filter(m=>m.role==='user').at(-1).content[0].text)
    const answers=Object.fromEntries(input.tasks.map(task=>{const k=key.splits.fast[task.id];return [task.id,{answer:String(k.answer),unit:k.unit,abstain:k.abstain,citations:[...new Set(k.support.map(e=>e.source))],evidence:k.support}]}))
    yield {type:'text-delta',index:0,text:JSON.stringify(answers)}
    yield {type:'usage',usage:{inputTokens:80,cacheReadTokens:20,outputTokens:10,totalTokens:110}}
    yield {type:'finish',reason:{kind:'stop'}}
   }
  }
 }
 ctx.llm.registerAdapter(['duo-configured-caller-fixture'],new Adapter())
}
