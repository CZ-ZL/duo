// Explicit result-delivery continuation. Native experiments are never resumed.
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {createUserMessage,LlmAdapter} from '@deepseek-ai/dsh-llm'
import {PERSONA_SECTION} from '@deepseek-ai/dsh-system-prompt'
import {ObserverService} from '@dual-loop/dsh-plugin/definitions'
import {buildReport} from '@dual-loop/dsh-plugin/observer'
import {priceUsage,pricingForInterval} from '@dual-loop/dsh-plugin/model-accounting'
const digest=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex')
const fileHash=p=>createHash('sha256').update(readFileSync(p)).digest('hex')
const read=p=>JSON.parse(readFileSync(p,'utf8'))
export const name='duo-retained-caller-delivery'
export const inject=['agents','llm','tools','duoJournal','duoBudget','appReady','appExit']
export function apply(ctx,config){
 const save=(name,value)=>writeFileSync(join(config.output,name),JSON.stringify(value,null,2)+'\n')
 const source=read(config.sourcePath),seed=read(config.seedPath),statuses=read(config.statusesPath)
 const reports=new Map(source.candidateReports.map(r=>[r.runId,r])),runIds=source.innerRunIds
 class RetainedReports extends ObserverService{
  describe(){return {id:'retained-journal-reports',version:'1',deterministic:true,readOnly:true}}
  report(runId){const status=statuses.find(s=>s.runId===runId);if(!status)throw new Error('Only the two retained run IDs are authorized');return buildReport(status)}
 }
 ctx.plugin(RetainedReports)
 if(!config.live){
  class Fixture extends LlmAdapter{
   count=0
   async *stream(){
    this.count++
    if(this.count===1){
     // A denied optimization tool must never activate any work provider.
     yield {type:'tool-call-delta',index:0,id:'denied-new-run',name:'dualloop_run',argumentsDelta:'{}'}
     yield {type:'tool-call-delta',index:1,id:'read-retained-report',name:'dualloop_report',argumentsDelta:JSON.stringify({runId:runIds[1]})}
    }else{
     yield {type:'text-delta',index:0,text:JSON.stringify({runIds,conclusions:runIds.map(id=>reports.get(id)?.conclusion),warmStartSourceRunId:runIds[0],evaluatorId:'answer-schema-fast',improvementProven:false,evidenceKind:'real_model',evaluatorScope:'output_protocol_only',finalIndependence:'NOT_ESTABLISHED',costAccounting:'final_total_ledger_required',innerLedgerCostsCny:runIds.map(id=>reports.get(id)?.budget.costCny),explanation:'Offline transport control reading retained real artifacts. Both runs retain baseline; the output-protocol score does not establish semantics or unseen final performance. Inner costs overlap the total ledger and omit Caller costs. This scripted response is not real Caller evidence.'})}
    }
    if(!config.missingUsage)yield {type:'usage',usage:{inputTokens:100,cacheReadTokens:0,outputTokens:30,totalTokens:130}}
    yield {type:'finish',reason:{kind:this.count===1?'tool-calls':'stop'}}
   }
  }
  ctx.llm.registerAdapter(['duo-delivery-fixture'],new Fixture())
 }
 const unchanged=()=>Object.entries(config.sourceHashes).every(([p,h])=>fileHash(p)===h)
 const planDigest=digest(config)
 if(config.live&&process.env.DUO_MODEL_RUN_ENABLED!=='1'){
  ctx.on('llm/stream',()=>{throw new Error('Preparation must not dispatch models')})
  ctx.effect(()=>ctx.appReady.onReady(()=>{save('prepare-plan.json',{planDigest,config});save('prepare-receipt.json',{status:'PREPARED',modelRequests:0,costCny:0});ctx.appExit(0)}));return
 }
 async function run(){
  if(!unchanged())throw new Error('Retained source changed before delivery')
  if(config.live&&read(join(config.output,'prepare-plan.json')).planDigest!==planDigest)throw new Error('Prepared delivery changed')
  const requests=[],calls=[],sessionId=source.callerSessionId,abort=new AbortController()
  const j=ctx.duoJournal.open(planDigest,{create:true});j.claim(planDigest);const release=j.lease()
  const budget=ctx.duoBudget.open(planDigest,{currency:'CNY',maxCostCny:config.maxCostCny,maxSessions:config.maxModelRequests,maxFastEvals:0,maxSlowEvals:0,maxWallTimeMs:120000})
  const timer=setTimeout(()=>abort.abort(),120000)
  let handle,failure=null
  const observe=ctx.on('tools/result',(exec,result)=>{if(exec.agent?.session.id===sessionId){calls.push({name:exec.name,arguments:exec.arguments,result});if(exec.name==='dualloop_report'&&!result.isError)reports.set(result.value.runId,result.value);save('tool-calls.json',calls)}})
  const meter=ctx.on('llm/stream',(options,next)=>(async function*(){
   if(options.sessionId!==sessionId)throw new Error('No nested or inner model calls authorized')
   if(options.provider!==config.provider||options.model!==config.model)throw new Error('Only the frozen Caller route is authorized')
   if(requests.length>=config.maxModelRequests||budget.snapshot().blockedReason||abort.signal.aborted)throw new Error('Delivery admission stopped')
   const bytes=Buffer.byteLength(JSON.stringify({system:options.system,messages:options.messages,tools:options.tools}))
   if(bytes>config.maxInputBytes)throw new Error('Delivery input exceeds frozen bound')
   const startedAt=new Date().toISOString()
   if(config.live&&config.pricing.verifiedDate!==startedAt.slice(0,10))throw new Error('Frozen CNY tariff expired')
   const id='request-'+(requests.length+1),row={id,kind:'caller',sessionId,requestBytes:bytes,startedAt,usage:null,costCny:null}
   budget.reserve(id,{phase:'selection',currency:'CNY',maxCostCny:config.reservationCny,request:{sessionId,kind:'caller',planDigest}})
   requests.push(row);save('requests.json',requests)
   save(id+'-input.json',{sessionId,system:options.system,messages:options.messages,tools:options.tools,evidenceKind:config.live?'model':'fixture'})
   try{for await(const chunk of next()){if(chunk.type==='usage')row.usage=structuredClone(chunk.usage);if(chunk.type==='finish')row.finish=structuredClone(chunk.reason);yield chunk}}
   finally{row.settledAt=new Date().toISOString();row.pricing=pricingForInterval(config.pricing,row.startedAt,row.settledAt);row.costCny=priceUsage(row.usage,row.pricing);budget.settle(id,row.costCny,id+':settled',{currency:'CNY',kind:config.live?'model':'fixture',...row});save('requests.json',requests);save('total-budget.json',budget.snapshot());save('total-cost-receipts.json',budget.receipts())}
  })())
  try{
   handle=await ctx.agents.create({sessionId,seed,signal:abort.signal,agentOptions:{provider:config.provider,model:config.model,maxTokens:2048},setup(c){
    c.systemPrompt.section({name:PERSONA_SECTION,order:0,text:'Use the supplied public DUO guide and authorized resources to complete the user task. You have no implementer instructions or private source access. Respect limits and explain evidence honestly.'})
    c.tools.restrict({allow:['dualloop_report']})
    c.tools.guard(exec=>exec.name==='dualloop_report'&&runIds.includes(exec.arguments.runId)?undefined:'Only retained report reading is authorized')
    c.on('agent/pre-step',(event,next)=>requests.length>=config.maxModelRequests||budget.snapshot().blockedReason?Promise.resolve({kind:'reject'}):next())
   }})
   handle.agent.followup(createUserMessage({source:{kind:'plugin',plugin:'duo-delivery-recovery'},content:[{type:'text',text:'Continue the original task from this retained session. This continuation permits only reading existing reports and delivering the original final response. No new optimization, execution, evaluation, component changes or deployment is authorized. Use the public dualloop_report interface; the original final-response contract still applies.'}]}))
   await handle.agent.whenIdle()
  }catch(e){failure={code:e.code??'DUO_DELIVERY_FAILED',message:e.message}}
  finally{clearTimeout(timer);if(handle)await handle.dispose();observe();meter()}
  const events=handle?.agent.session.ownEvents()??[];save('session-events.json',events)
  const finalText=events.filter(e=>e.type==='assistant/message').at(-1)?.data?.message?.content.filter(c=>c.type==='text').map(c=>c.text).join('\n')??''
  let value;try{value=JSON.parse(finalText)}catch{}
  const interpreted=value?.runIds?.length===2&&value.runIds.every((id,i)=>id===runIds[i])&&value.conclusions?.length===2&&value.conclusions.every((c,i)=>c===reports.get(runIds[i])?.conclusion)&&value.warmStartSourceRunId===runIds[0]&&value.improvementProven===false&&value.evaluatorId==='answer-schema-fast'&&value.evidenceKind==='real_model'&&value.evaluatorScope==='output_protocol_only'&&value.finalIndependence==='NOT_ESTABLISHED'&&value.costAccounting==='final_total_ledger_required'&&value.innerLedgerCostsCny?.length===2&&value.innerLedgerCostsCny.every((cost,i)=>cost===reports.get(runIds[i])?.budget.costCny)&&typeof value.explanation==='string'&&!!value.explanation.trim()
  const checks={sourcePrerequisites:source.eligible===true,seedPreserved:digest(events.slice(0,seed.length))===digest(seed),sourceUnchanged:unchanged(),callerFinished:events.filter(e=>e.type==='turn/end').at(-1)?.data?.reason?.kind==='completed',
   twoReports:runIds.every(id=>reports.has(id))&&calls.some(c=>c.name==='dualloop_report'&&!c.result.isError&&c.arguments.runId===runIds[1]),interpretationValid:!!interpreted,
   knownUsage:requests.every(r=>r.usage&&r.costCny!==null)&&budget.snapshot().costCny!==null&&budget.snapshot().reservedCostCny===0,
   totalAccounting:budget.snapshot().costCny!==null&&requests.every(r=>r.costCny!==null)&&Math.round(budget.snapshot().costCny*1e9)===requests.reduce((sum,r)=>sum+Math.round(r.costCny*1e9),0),
   boundedRequests:requests.length<=config.maxModelRequests,noWorkProviders:['duoGenerator','duoExecutor','duoEvaluators','duoController'].every(k=>!ctx.get(k))}
  const passed=!failure&&Object.values(checks).every(Boolean)
  const carry=config.batchCarry,used=carry?carry.priorRequests+(config.live?requests.length:0):null
  const total=carry?(config.live?(budget.snapshot().costCny===null?null:(Math.round(carry.priorCostCny*1e9)+Math.round(budget.snapshot().costCny*1e9))/1e9):carry.priorCostCny):null
  const batchAccounting=carry?{batch:carry.batch,modelRequests:used,costCny:total,remainingRequests:carry.batchMaxRequests-used,remainingCostCny:total===null?null:(Math.round(carry.batchMaxCostCny*1e9)-Math.round(total*1e9))/1e9,callerRemaining:carry.callerCapAfterApproval-carry.priorCallerRequests-(config.live?requests.length:0),innerRemaining:carry.innerCapAfterApproval-carry.priorInnerRequests}:null
  const result={apiVersion:2,scope:'native-maturation-report-delivery',runId:planDigest,planDigest,status:passed?'completed':'failed',sourceStatus:'failed',sourceRunId:source.runId,sourceRun:source.directory,evidenceKind:config.live?'real_caller_retained_session_delivery':'offline_transport_retained_real_artifacts',independentRealCallerVerified:config.live&&passed,improvementProven:false,
   modelRequests:config.live?requests.length:0,syntheticRequests:config.live?0:requests.length,innerRequests:0,currency:'CNY',costCny:config.live?budget.snapshot().costCny:0,syntheticCostCny:config.live?null:budget.snapshot().costCny,budget:budget.snapshot(),checks,toolCalls:calls,reportRunIds:[...reports.keys()],finalText,failure,
   batchAccounting,recoveryControlMessages:1,implementerOutcomeCoaching:0,limitation:'Explicit Caller result-delivery continuation with retained event history; source terminal failure is unchanged. This does not resume a DUO experiment, establish semantic quality, unseen final data or optimization benefit.'}
  j.complete(result);save('result.json',result);release()
  if(!passed)throw new Error('Delivery incomplete; retained source and all costs preserved')
 }
 ctx.effect(()=>ctx.appReady.onReady(()=>{void run().then(()=>ctx.appExit(0),e=>{save('entry-error.json',{message:e.message});ctx.appExit(1)})}))
}
