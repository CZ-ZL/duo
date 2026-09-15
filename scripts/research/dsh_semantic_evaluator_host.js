// Named-profile acceptance of the optional native EvaluatorsService. Control
// artifacts are fixed outputs, not generated candidates or optimization gains.
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {LlmAdapter} from '@deepseek-ai/dsh-llm'
export const name='duo-semantic-evaluator-acceptance'
export const inject=['agents','llm','duoEvaluators','duoJournal','duoBudget','appReady','appExit']
export function apply(ctx,config){
 const save=(name,value)=>writeFileSync(join(config.output,name),JSON.stringify(value,null,2)+'\n')
 const contract=JSON.parse(readFileSync(config.contractPath,'utf8')),running=config.offline||process.env.DUO_MODEL_RUN_ENABLED==='1'
 let requests=0
 ctx.on('llm/stream',(options,next)=>{
  if(!running||requests>=1)throw new Error('One total judge request; no retries or nested requests')
  requests++;save('request-admission.json',{requests,statusAtAdmission:'UNSETTLED',maximum:1});return next()
 })
 if(config.offline){
  class Fixture extends LlmAdapter{async *stream(options){
   const prompt=JSON.parse(options.messages.filter(m=>m.role==='user').at(-1).content[0].text)
   yield {type:'text-delta',index:0,text:JSON.stringify(Object.fromEntries(prompt.tasks.map(t=>[t.id,contract.fixtureGrades[t.id]])))}
   if(!config.missingUsage)yield {type:'usage',usage:{inputTokens:80,cacheReadTokens:20,outputTokens:10,totalTokens:110}}
   yield {type:'finish',reason:{kind:'stop'}}
  }}
  ctx.llm.registerAdapter(['duo-offline'],new Fixture())
 }
 async function run(){
  const descriptors=ctx.duoEvaluators.describe();save('evaluator-descriptors.json',descriptors)
  if(!running){save('prepare-receipt.json',{status:'PREPARED',paidCalls:0,maxRequests:1});return}
  const runId='semantic-provider-calibration-v2',j=ctx.duoJournal.open(runId,{create:true});j.claim(contract.id)
  const ledger=ctx.duoBudget.open(runId,{currency:'CNY',maxCostCny:.15,maxSessions:1,maxFastEvals:0,maxSlowEvals:0})
  ledger.reserve('judge-1',{phase:'evaluation',currency:'CNY',maxCostCny:.15,request:{contractId:contract.id,descriptor:descriptors.find(d=>d.tier==='fast')}})
  j.append({kind:'calibration',contractId:contract.id,fixtureInputs:true,modelJudge:!config.offline})
  const evaluation=await ctx.duoEvaluators.evaluate({candidate:contract.candidate,artifact:contract.artifact,tier:'fast'})
  ledger.settle('judge-1',evaluation.costCny,'judge-1:settled',{currency:'CNY',costEvidence:evaluation.costEvidence})
  save('evaluation.json',evaluation);save('cost-receipts.json',ledger.receipts());save('budget.json',ledger.snapshot())
  const status=evaluation.ok&&evaluation.costCny!==null?'completed':'incomplete'
  const result={status,purpose:'frozen_control_calibration',evidenceKind:config.offline?'fixture':'real_judge_on_fixed_controls',
   modelRequests:config.offline?0:requests,syntheticRequests:config.offline?requests:0,costCny:config.offline?0:evaluation.costCny,
   syntheticCostCny:config.offline?evaluation.costCny:null,evaluation,optimizationProven:false,independentCallingAgentAcceptance:false}
  j.append({kind:'measurement',evaluation});j.complete(result);save('journal.json',{events:j.events(),result});save('result.json',result)
  if(ctx.agents.list().length)throw new Error('Owned judge Agent did not drain')
  if(status!=='completed')throw new Error('Evaluation incomplete; preserve costs and do not retry')
 }
 ctx.effect(()=>ctx.appReady.onReady(()=>{void run().then(()=>ctx.appExit(0),error=>{save('error.json',{message:error.message,requests});ctx.appExit(1)})}))
}
