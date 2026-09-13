// Fixed two-response diagnostic on retained Caller input. It uses DSH's model
// service and existing Journal/budget, but never dispatches returned tool calls.
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {priceUsage,pricingForInterval} from '@dual-loop/dsh-plugin/model-accounting'
const canonical=v=>v&&typeof v==='object'?Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v
const digest=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(canonical(v))).digest('hex')
export const name='duo-caller-format-probe'
export const inject=['llm','tools','deepseekLlmApiExtensions','duoJournal','duoBudget','appReady','appExit']
export function apply(ctx,config){
 const save=(name,value)=>writeFileSync(join(config.output,name),JSON.stringify(value,null,2)+'\n')
 const bytes=readFileSync(config.sourcePath),source=JSON.parse(bytes),input={system:source.system,messages:source.messages,tools:source.tools},inputDigest=digest(input)
 if(createHash('sha256').update(bytes).digest('hex')!==config.sourceSha256||typeof input.system!=='string'||!Array.isArray(input.messages)||!Array.isArray(input.tools))throw new Error('Frozen Caller input invalid or changed')
 const inputBytes=Buffer.byteLength(JSON.stringify(input)),parent=config.parent,envelope=((config.maxInputBytes+4096)*Math.max(config.pricing.inputCnyPerMillion,config.pricing.cacheReadCnyPerMillion)+config.maxTokens*config.pricing.outputCnyPerMillion)/1e6
 if(config.maxModelRequests!==2||config.maxCostCny!==.5||config.reservationCny!==.25||config.maxTokens!==2048||config.arms.join(',')!=='json_on,json_off'||inputBytes>config.maxInputBytes||config.pricing.currency!=='CNY'||!Number.isFinite(envelope)||envelope<0||envelope>.25)throw new Error('Invalid fixed format-probe envelope')
 if(parent.priorRequests+2>parent.batchMaxRequests||parent.priorCostCny+.5>parent.batchMaxCostCny||parent.callerRemaining<2)throw new Error('Diagnostic cannot reset or exceed parent allocation')
 const planDigest=digest({scope:'native-maturation-caller-format-probe',config,inputDigest}),running=!config.live||process.env.DUO_MODEL_RUN_ENABLED==='1'
 if(!running){
  ctx.on('llm/stream',()=>{throw new Error('Model calls prohibited during probe preparation')})
  ctx.effect(()=>ctx.appReady.onReady(()=>{save('prepare-plan.json',{planDigest,config,inputDigest,inputBytes,toolExecution:false,independentCallerSession:false});save('prepare-receipt.json',{status:'PREPARED',modelRequests:0,costCny:0});ctx.appExit(0)}));return
 }
 async function run(){
  if(config.live&&JSON.parse(readFileSync(join(config.output,'prepare-plan.json'),'utf8')).planDigest!==planDigest)throw new Error('Prepared diagnostic changed')
  const j=ctx.duoJournal.open(planDigest,{create:true});j.claim(planDigest);const release=j.lease()
  const budget=ctx.duoBudget.open(planDigest,{currency:'CNY',maxCostCny:.5,maxSessions:2,maxFastEvals:0,maxSlowEvals:0,maxWallTimeMs:config.timeoutMs}),abort=new AbortController(),timer=setTimeout(()=>abort.abort(),config.timeoutMs)
  const rows=[],formats=[];let failure=null,activeSession=null,activeMode=null,dispatches=0
  const guard=ctx.on('llm/stream',(options,next)=>{
   if(!activeSession||options.sessionId!==activeSession||++dispatches>1||options.provider!==config.provider||options.model!==config.model||options.maxTokens!==2048||digest({system:options.system,messages:options.messages,tools:options.tools})!==inputDigest)throw new Error('Unplanned or repeated model request prohibited')
   return next()
  })
  const extension=ctx.deepseekLlmApiExtensions.register('response_format',{prepare(request){
   if(request.sessionId!==activeSession)throw new Error('Unplanned format extension request')
   if(Buffer.byteLength(JSON.stringify(request.body))>config.maxInputBytes+4096)throw new Error('Wire input exceeds the priced envelope')
   const row={mode:activeMode,sessionId:request.sessionId,baseBodyDigest:digest(request.body),responseFormat:activeMode==='json_on'?{type:'json_object'}:null,prepared:true,httpAccepted:null}
   formats.push(row);save('request-formats.json',formats)
   if(activeMode==='json_off')return
   return {value:{type:'json_object'},accept(){row.httpAccepted=true;save('request-formats.json',formats)}}
  }})
  try{
   for(const mode of config.arms){
    abort.signal.throwIfAborted()
    if(config.live&&config.pricing.verifiedDate!==new Date().toISOString().slice(0,10))throw new Error('CNY tariff UTC date expired')
    if(budget.snapshot().blockedReason||rows.length>=2)throw new Error('Request or accounting limit reached')
    activeSession='duo-format-probe-'+planDigest.slice(0,20)+'-'+rows.length;activeMode=mode;dispatches=0
    const id='probe-'+(rows.length+1),row={id,kind:'caller_format_diagnostic',mode,sessionId:activeSession,inputDigest,startedAt:new Date().toISOString(),usage:null,costCny:null,chunks:[]}
    budget.reserve(id,{phase:'selection',currency:'CNY',maxCostCny:.25,request:{planDigest,mode,inputDigest,parentRunId:parent.parentRunId,batch:parent.batch}})
    rows.push(row);save('requests.json',rows)
    try{
     for await(const chunk of ctx.llm.stream({provider:config.provider,model:config.model,sessionId:activeSession,maxTokens:2048,...structuredClone(input),signal:abort.signal})){
      row.chunks.push(structuredClone(chunk));if(chunk.type==='usage')row.usage=structuredClone(chunk.usage);if(chunk.type==='finish')row.finish=structuredClone(chunk.reason)
     }
    }finally{
     row.settledAt=new Date().toISOString();row.pricing=pricingForInterval(config.pricing,row.startedAt,row.settledAt);row.costCny=priceUsage(row.usage,row.pricing)
     budget.settle(id,row.costCny,id+':settled',{currency:'CNY',kind:config.live?'model':'fixture',...row});save('requests.json',rows);save('total-budget.json',budget.snapshot());save('total-cost-receipts.json',budget.receipts())
    }
    row.text=row.chunks.filter(c=>c.type==='text-delta').map(c=>c.text).join('');row.nativeToolNames=[...new Set(row.chunks.filter(c=>c.type==='tool-call-delta').map(c=>c.name).filter(Boolean))];row.toolShapedText=row.text.includes('<｜｜DSML｜｜tool_calls>')
    try{JSON.parse(row.text);row.validJsonText=true}catch{row.validJsonText=false}
    save('requests.json',rows)
    if(row.costCny===null||budget.snapshot().blockedReason)throw new Error('Unknown model usage/cost; no second request')
    if(!['stop','tool-calls'].includes(row.finish?.kind))throw new Error('Provider did not finish normally; no retry')
   }
  }catch(error){failure={code:'DUO_FORMAT_PROBE_INCOMPLETE',message:error.message}}
  finally{activeSession=null;guard();extension();clearTimeout(timer)}
  const b=budget.snapshot(),known=b.costCny!==null,batchCost=config.live?(known?Number((parent.priorCostCny+b.costCny).toFixed(9)):null):parent.priorCostCny
  const checks={twoResponses:rows.length===2&&rows.every(r=>['stop','tool-calls'].includes(r.finish?.kind)),knownCost:known,matchedInput:rows.every(r=>r.inputDigest===inputDigest),matchedWireBody:formats.length===2&&formats[0].baseBodyDigest===formats[1].baseBodyDigest,noToolsRegistered:ctx.tools.schemas().length===0,withinBatch:known&&parent.priorRequests+(config.live?rows.length:0)<=parent.batchMaxRequests&&batchCost<=parent.batchMaxCostCny}
  const observations=rows.map(r=>({mode:r.mode,finish:r.finish,toolNames:r.nativeToolNames??[],toolShapedText:r.toolShapedText??false,validJsonText:r.validJsonText??false,costCny:r.costCny}))
  const report={status:!failure&&Object.values(checks).every(Boolean)?'completed':'failed',runId:planDigest,planDigest,evidenceKind:config.live?'real_model_format_probe':'offline_transport_control',modelRequests:config.live?rows.length:0,syntheticRequests:config.live?0:rows.length,currency:'CNY',costCny:config.live?b.costCny:0,syntheticCostCny:config.live?null:b.costCny,budget:b,parent,batchModelRequests:parent.priorRequests+(config.live?rows.length:0),batchCostCny:batchCost,batchRemainingRequests:parent.batchMaxRequests-parent.priorRequests-(config.live?rows.length:0),batchRemainingCostCny:batchCost===null?null:Number((parent.batchMaxCostCny-batchCost).toFixed(9)),observations,checks,failure,toolExecutions:0,independentCallerVerified:false,causalEffectProven:false,limitations:['One fixed pair cannot establish a reliable model-side causal effect.','No returned tools are executed; this is not independent Caller or full DUO acceptance.','Only the two recorded response_format modes differ; order and sampling variability remain limitations.']}
  try{j.complete(report);save('result.json',report);save('total-budget.json',b);save('total-cost-receipts.json',budget.receipts())}finally{release()}
  if(report.status!=='completed')throw new Error('Format diagnostic incomplete; preserve receipts without replay')
 }
 ctx.effect(()=>ctx.appReady.onReady(()=>{void run().then(()=>ctx.appExit(0),error=>{save('entry-error.json',{message:error.message});ctx.appExit(1)})}))
}
