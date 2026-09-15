// Isolated acceptance application. Work is performed only by public tools
// chosen in a separately created Calling Agent session, never by this driver.
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {createUserMessage} from '@deepseek-ai/dsh-llm'
import {PERSONA_SECTION} from '@deepseek-ai/dsh-system-prompt'
import {priceUsage,pricingForInterval} from '@dual-loop/dsh-plugin/model-accounting'
import {diagnoseCombinedFailure,diagnoseRequestBoundary} from './caller_diagnostics.mjs'
const canonical=v=>v&&typeof v==='object'?Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v
const digest=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(canonical(v))).digest('hex')
export const name='duo-caller-acceptance'
export const inject=['agents','llm','tools','duoJournal','duoBudget','appReady','appExit']
export function apply(ctx,config){
 const save=(file,value)=>writeFileSync(join(config.output,file),JSON.stringify(value,null,2)+'\n')
 const guide=readFileSync(config.guidePath,'utf8'),resources=JSON.parse(readFileSync(config.resourcesPath,'utf8')),original=readFileSync(resources.targetPath)
 const evaluationOnly=config.workflow==='evaluation_only',bridgeCode=config.adapterBridgeCode,scope=config.scope??'native-maturation-caller-warm-start'
 if(typeof bridgeCode!=='string'||!bridgeCode)throw new Error('A supplied authorized adapter bridge is required')
 if(config.batchCarry&&(['maxCostCny','maxModelRequests'].some(k=>config[k]!==config.batchCarry[k])||['caller','inner'].some(k=>config[k+'RequestCap']!==config.batchCarry[k+'Remaining'])))throw new Error('Continuation runtime must retain the verified remaining allowance')
 const envelope=((config.callerMaxInputBytes+4096)*Math.max(config.pricing.inputCnyPerMillion,config.pricing.cacheReadCnyPerMillion)+config.maxTokens*config.pricing.outputCnyPerMillion)/1e6
 if(config.pricing.currency!=='CNY'||!Number.isFinite(envelope)||envelope<0||config.callerReservationCny<envelope||priceUsage({inputTokens:0,cacheReadTokens:0,outputTokens:0,totalTokens:0},config.pricing)===null)throw new Error('Caller CNY reservation does not cover its frozen bounded request')
 const planDigest=digest({scope,config,guide,resources,originalVersion:digest(original.toString('utf8'))}),running=!config.live||process.env.DUO_MODEL_RUN_ENABLED==='1'
 if(!running){
  ctx.on('llm/stream',()=>{throw new Error('No model work during preparation')})
  ctx.effect(()=>ctx.appReady.onReady(()=>{save('prepare-plan.json',{planDigest,config,resources,initialEvaluatorBound:!!ctx.get('duoEvaluators')});save('prepare-receipt.json',{status:'PREPARED',modelRequests:0,paidCalls:0});ctx.appExit(0)}));return
 }
 async function run(){
  if(config.live&&JSON.parse(readFileSync(join(config.output,'prepare-plan.json'),'utf8')).planDigest!==planDigest)throw new Error('Prepared combination plan changed')
  if(ctx.get('duoEvaluators'))throw new Error('Caller must attach the custom Evaluator; it was already bound')
  const started=performance.now(),sessionId='duo-caller-'+randomUUID(),calls=[],requests=[],completedRuns=new Map(),attemptedRuns=new Map(),definitions=new Set(),reports=new Map(),plans=new Map(),abort=new AbortController()
  save('requests.json',requests);save('tool-calls.json',calls)
  const j=ctx.duoJournal.open(planDigest,{create:true});j.claim(planDigest);const release=j.lease()
  const budget=ctx.duoBudget.open(planDigest,{currency:'CNY',maxCostCny:config.maxCostCny,maxSessions:config.maxModelRequests,maxFastEvals:0,maxSlowEvals:0,maxWallTimeMs:config.timeoutMs})
  let handle,failure=null,firstValidRunMs=null
  const timer=setTimeout(()=>abort.abort(),config.timeoutMs),counts={caller:0,inner:0},allowedRead=[config.guidePath,config.resourcesPath,resources.targetPath,resources.experimentPath]
  const currentAllowed=spec=>{
   if(!spec||typeof spec!=='object'||Array.isArray(spec))return false
   if(digest(spec)===digest(resources.firstContract))return true
   if(evaluationOnly)return false
   const first=[...completedRuns.values()][0]
   const expected={...resources.firstContract,id:resources.secondId,warmStart:{runIds:[first?.runId],maxRecords:4,maxContextBytes:8192,fixturePolicy:config.live?'exclude':'ideas_only'}}
   return !!first&&digest(spec)===digest(expected)
  }
  const guard=exec=>{
   if(exec.name==='read')return allowedRead.includes(exec.arguments.file_path)?undefined:'Only supplied public resource files may be read; private task/final/receipt files are not Caller input'
   if(exec.name==='write'){
    let spec;try{spec=JSON.parse(exec.arguments.content)}catch{}
    return exec.arguments.file_path===resources.experimentPath&&currentAllowed(spec)?undefined:'Write must be an authorized frozen first contract or second contract with the actual completed source runId'
   }
   if(exec.name==='cordis_define')return exec.arguments.plugin?.kind==='new'&&!exec.arguments.code?.client&&exec.arguments.code?.host===bridgeCode&&definitions.size===0?undefined:'Only the supplied existing-evaluator bridge is authorized; no arbitrary host code'
   if(exec.name==='cordis_run')return definitions.has(exec.arguments.pluginId+':'+exec.arguments.packageId)&&exec.arguments.mode==='run'?undefined:'Only the Caller-defined approved adapter package may run'
   if(exec.name==='dualloop_run'){
    let spec;try{spec=JSON.parse(readFileSync(resources.experimentPath,'utf8'))}catch{}
    if(!currentAllowed(spec)||budget.snapshot().blockedReason||abort.signal.aborted)return 'Frozen contract, current known budget and live authority required'
   }
  }
  const observe=ctx.on('tools/result',(exec,result)=>{
   if(exec.agent?.session.id!==sessionId)return
   calls.push({name:exec.name,arguments:exec.arguments,result,elapsedMs:performance.now()-started});save('tool-calls.json',calls)
   if(result.isError)return
   if(exec.name==='cordis_define')definitions.add(result.value.pluginId+':'+result.value.packageId)
   if(exec.name==='dualloop_plan')plans.set(result.value.runId,result.value)
   if(exec.name==='dualloop_report')reports.set(result.value.runId,result.value)
   if(exec.name==='dualloop_run'){
    attemptedRuns.set(result.value.runId,result.value)
    if(result.value.status==='completed'){completedRuns.set(result.value.runId,result.value);firstValidRunMs??=performance.now()-started}
    if(result.value.budget?.costCny===null){failure={code:'DUO_INNER_COST_UNKNOWN',message:'Inner accounting cannot be reconciled; no next experiment'};abort.abort()}
   }
  })
  const meter=ctx.on('llm/stream',(options,next)=>(async function*(){
   const kind=options.sessionId===sessionId?'caller':'inner',cap=kind==='caller'?config.callerRequestCap:config.innerRequestCap,reservation=kind==='caller'?config.callerReservationCny:config.innerReservationCny
   const bytes=Buffer.byteLength(JSON.stringify({system:options.system,messages:options.messages,tools:options.tools}))
   if(abort.signal.aborted||requests.length>=config.maxModelRequests||counts[kind]>=cap||budget.snapshot().blockedReason)throw new Error('Combined request/CNY authority exhausted or accounting unresolved')
   const kindCost=requests.filter(r=>r.kind===kind).reduce((sum,r)=>sum+(r.costCny??reservation),0),kindCostCap=config[kind+'MaxCostCny']
   if(kindCostCap!==undefined&&Math.round((kindCost+reservation)*1e9)>Math.round(kindCostCap*1e9))throw new Error('Frozen '+kind+' monetary allowance exhausted')
   const boundary=diagnoseRequestBoundary({kind,options,config,requestBytes:bytes})
   if(boundary){failure??=boundary;save('request-refusal.json',boundary);throw new Error(boundary.message)}
   const at=new Date().toISOString()
   if(config.live&&config.pricing.verifiedDate!==at.slice(0,10))throw new Error('Frozen CNY tariff date expired before dispatch')
   const id='request-'+(requests.length+1),row={id,kind,sessionId:options.sessionId,startedAt:at,requestBytes:bytes,usage:null,costCny:null}
   budget.reserve(id,{phase:'selection',currency:'CNY',maxCostCny:reservation,request:{sessionId:options.sessionId,kind,provider:config.provider,model:config.model,requestBytes:bytes,planDigest}})
   requests.push(row);counts[kind]++;save('requests.json',requests)
   save(id+'-input.json',{kind,provider:options.provider,model:options.model,sessionId:options.sessionId,system:options.system,messages:options.messages,tools:options.tools,evidenceKind:config.live?'model':'fixture'})
   try{for await(const chunk of next()){if(chunk.type==='usage')row.usage=structuredClone(chunk.usage);if(chunk.type==='finish')row.finish=structuredClone(chunk.reason);yield chunk}}
   finally{
    row.settledAt=new Date().toISOString();row.pricing=pricingForInterval(config.pricing,row.startedAt,row.settledAt);row.costCny=priceUsage(row.usage,row.pricing)
    budget.settle(id,row.costCny,id+':settled',{currency:'CNY',kind:config.live?'model':'fixture',...row});save('requests.json',requests);save('total-budget.json',budget.snapshot());save('total-cost-receipts.json',budget.receipts())
   }
  })())
  const cancel=()=>handle?.agent.cancel({kind:'parent'})
  try{
   handle=await ctx.agents.create({sessionId,signal:abort.signal,agentOptions:{provider:config.provider,model:config.model,maxTokens:config.maxTokens},setup(c){
   c.systemPrompt.section({name:PERSONA_SECTION,order:0,text:'Use the supplied public DUO guide and authorized resources to complete the user task. You have no implementer instructions or private source access. Respect limits and explain evidence honestly.'})
    const allowed=evaluationOnly?['cordis_inspect_list','cordis_inspect_query','cordis_define','cordis_run','dualloop_plan','dualloop_run','dualloop_report','dualloop_budget_status']:['read','write','cordis_inspect_list','cordis_inspect_query','cordis_define','cordis_run','cordis_inspect_self','dualloop_describe','dualloop_design','dualloop_discover','dualloop_plan','dualloop_run','dualloop_report','dualloop_budget_status']
    // Native restrict validates names at registration. Refresh its visible
    // subset when the Caller activates the deferred runtime; the positive
    // guard remains in force throughout, including between those steps.
    let removeRestriction,currentNames=''
    const refresh=()=>{const known=new Set(ctx.tools.schemas().map(s=>s.name)),names=allowed.filter(n=>known.has(n));if(names.join(',')!==currentNames){removeRestriction?.();removeRestriction=c.tools.restrict({allow:names});currentNames=names.join(',')}}
    c.tools.guard(exec=>allowed.includes(exec.name)?guard(exec):'Tool outside this frozen acceptance authority')
    refresh()
    c.on('agent/pre-step',(event,next)=>{
     refresh()
     if(event.step>config.callerRequestCap){
      failure??={code:'DUO_CALLER_REQUEST_LIMIT',component:'combined-request-admission',causeStatus:'ESTABLISHED_AT_ADMISSION',
       message:`Caller used its ${config.callerRequestCap} authorized requests; no next request is dispatched.`,
       facts:{callerRequests:counts.caller,callerRequestCap:config.callerRequestCap,nextStep:event.step,providerRequestDispatched:false},
       recovery:{automaticRetry:false,preserveReceipts:true,nextAction:'Retain settled consumption. Further Caller work requires an explicit request-cap amendment; a remaining inner allowance is not Caller authority.'}}
      return Promise.resolve({kind:'reject'})
     }
     return budget.snapshot().blockedReason?Promise.resolve({kind:'reject'}):next()
    })
   }})
   abort.signal.addEventListener('abort',cancel,{once:true});abort.signal.throwIfAborted()
   handle.agent.followup(createUserMessage({source:{kind:'plugin',plugin:'duo-caller-acceptance'},content:[{type:'text',text:guide+'\n\nAUTHORIZED TASK AND RESOURCES\n'+JSON.stringify(resources)}]}))
   await handle.agent.whenIdle()
  }catch(error){failure??={code:'DUO_CALLER_FAILED',message:error.message}}
  finally{abort.signal.removeEventListener('abort',cancel);clearTimeout(timer);if(handle)await handle.dispose();meter();observe()}
  const events=handle?.agent.session.ownEvents()??[];save('session-events.json',events)
  const terminalReason=events.filter(e=>e.type==='turn/end').at(-1)?.data?.reason
  if(terminalReason?.kind==='error')failure??={code:terminalReason.error?.code??'DUO_CALLER_TURN_ERROR',message:terminalReason.error?.message??'Caller turn failed'}
  const finalText=events.filter(e=>e.type==='assistant/message').at(-1)?.data?.message?.content.filter(c=>c.type==='text').map(c=>c.text).join('\n')??''
  let interpretation;try{interpretation=JSON.parse(finalText)}catch{}
  // A failed native experiment can still consume history and incur settled
  // charges. Observe every returned run; completion remains a separate gate.
  const completed=[...completedRuns.values()],runs=[...attemptedRuns.values()],first=runs[0],second=runs[1],warm=second&&plans.get(second.runId)?.warmStart
  const generationInputs=requests.filter(r=>r.kind==='inner').map(r=>JSON.parse(readFileSync(join(config.output,r.id+'-input.json'),'utf8'))).flatMap(r=>r.messages.filter(m=>m.role==='user').flatMap(m=>m.content.filter(c=>c.type==='text').flatMap(c=>{try{return [JSON.parse(c.text)]}catch{return []}})))
  const warmConsumed=!!warm?.context.records.length&&generationInputs.some(input=>input.feedback?.warmStart&&digest(input.feedback.warmStart)===warm.contextDigest)
  const attached=calls.some(c=>c.name==='cordis_run'&&!c.result.isError)&&plans.size>0&&[...plans.values()].every(p=>p.providers.evaluators.every(d=>d.id.startsWith(evaluationOnly?resources.evaluatorIdPrefix:'answer-schema-')))
  const interpreted=evaluationOnly?!!first&&reports.has(first.runId)&&interpretation?.runId===first?.runId&&interpretation?.conclusion===reports.get(first?.runId)?.conclusion&&interpretation?.improvementProven===false&&interpretation?.evaluatorId===resources.firstContract.fast.evaluatorId&&interpretation?.innerLedgerCostCny===reports.get(first?.runId)?.budget.costCny&&interpretation?.costAccounting==='final_total_ledger_required'&&interpretation?.evidenceKind===(config.live?'real_model':'fixture')&&typeof interpretation?.explanation==='string'&&!!interpretation.explanation.trim():interpretation?.runIds?.length===2&&interpretation.runIds.every((id,i)=>id===runs[i]?.runId)&&interpretation.conclusions?.length===2&&interpretation.conclusions.every((c,i)=>c===reports.get(runs[i]?.runId)?.conclusion)&&interpretation.warmStartSourceRunId===first?.runId&&interpretation.improvementProven===false
   &&interpretation.evaluatorId==='answer-schema-fast'&&interpretation.evidenceKind===(config.live?'real_model':'fixture')&&interpretation.evaluatorScope==='output_protocol_only'&&interpretation.finalIndependence==='NOT_ESTABLISHED'&&interpretation.costAccounting==='final_total_ledger_required'
   &&interpretation.innerLedgerCostsCny?.length===2&&interpretation.innerLedgerCostsCny.every((cost,i)=>cost===reports.get(runs[i]?.runId)?.budget.costCny)&&typeof interpretation.explanation==='string'&&!!interpretation.explanation.trim()
  const nanos=v=>Math.round(v*1e9),knownRequests=requests.every(r=>r.costCny!==null),meteredInner=requests.filter(r=>r.kind==='inner').reduce((sum,r)=>sum+nanos(r.costCny??0),0)
  const sharedChecks={callerFinished:terminalReason?.kind==='completed',twoCompletedNativeRuns:completed.length===2&&completed.every(r=>r.generationsRun===2),callerAttachedCustomEvaluator:attached,warmStartConsumed:warmConsumed,
   twoReports:reports.size===2,interpretationValid:!!interpreted,originalUnchanged:readFileSync(resources.targetPath).equals(original),
   totalAccounting:knownRequests&&budget.snapshot().costCny!==null&&nanos(budget.snapshot().costCny)===requests.reduce((sum,r)=>sum+nanos(r.costCny),0),
   innerAccounting:knownRequests&&runs.length>0&&runs.every(r=>Number.isFinite(r.budget?.costCny))&&runs.reduce((sum,r)=>sum+nanos(r.budget.costCny),0)===meteredInner,
   boundedRequests:requests.length<=config.maxModelRequests&&counts.caller<=config.callerRequestCap&&counts.inner<=config.innerRequestCap}
  const checks=evaluationOnly?{callerFinished:sharedChecks.callerFinished,oneCompletedEvaluation:completed.length===1&&completed[0].operation==='evaluate'&&completed[0].generationsRun===0,callerAttachedCustomEvaluator:attached,callerReadReport:reports.size===1,interpretationValid:!!interpreted,originalUnchanged:sharedChecks.originalUnchanged,totalAccounting:sharedChecks.totalAccounting,innerAccounting:sharedChecks.innerAccounting,boundedRequests:sharedChecks.boundedRequests}:sharedChecks
  failure=diagnoseCombinedFailure({failure,checks,finalText,terminalReason})
  const ready=!failure&&Object.values(checks).every(Boolean)
  const carry=config.batchCarry,b=budget.snapshot(),batchCost=carry?(config.live?(b.costCny===null?null:(nanos(carry.priorCostCny)+nanos(b.costCny))/1e9):carry.priorCostCny):null
  const batchAccounting=carry?{batch:carry.batch,priorRequests:carry.priorRequests,priorCostCny:carry.priorCostCny,
   modelRequests:carry.priorRequests+(config.live?requests.length:0),costCny:batchCost,
   remainingRequests:carry.maxModelRequests-(config.live?requests.length:0),remainingCostCny:batchCost===null?null:(nanos(carry.batchMaxCostCny)-nanos(batchCost))/1e9,
   callerRemaining:carry.callerRemaining-(config.live?counts.caller:0),innerRemaining:carry.innerRemaining-(config.live?counts.inner:0),
   note:'Prior real consumption plus this attempt only. Offline scripted operations are excluded; inner ledger charges overlap this attempt.'}:null
  // Export retained facts independently of Caller allowance; this never makes
  // the Caller-read or interpretation checks pass on the driver's behalf.
  const exported=[],beforeExport=requests.length;let exportError=null
  for(const item of runs){try{
   const response=await ctx.tools.execute({name:'dualloop_report',arguments:{runId:item.runId},callId:'deterministic-export-'+item.runId,signal:new AbortController().signal})
   if(response.isError)throw new Error(response.error?.message??'Report unavailable')
   const stem='product-report-'+item.runId;save(stem+'.json',response.value);writeFileSync(join(config.output,stem+'.txt'),response.value.text+'\n')
   exported.push({runId:item.runId,json:join(config.output,stem+'.json'),text:join(config.output,stem+'.txt'),jsonSha256:digest(readFileSync(join(config.output,stem+'.json'),'utf8')),textSha256:digest(readFileSync(join(config.output,stem+'.txt'),'utf8'))})
  }catch(error){exportError={message:error.message};break}}
  const delivery={execution:{completedRuns:completed.length,attemptedRuns:runs.length},artifacts:{state:exportError?'EXPORT_FAILED':exported.length?'FILES_WRITTEN':'NO_RUN_EVIDENCE'},caller:{state:ready?'VERIFIED':'NOT_VERIFIED',reportsRead:reports.size,interpretationValid:!!interpreted},reports:exported,reportModelRequests:requests.length-beforeExport,error:exportError}
  save('delivery-receipt.json',delivery)
  const report={apiVersion:2,runId:planDigest,planDigest,status:ready?'completed':'failed',evidenceKind:config.live?(evaluationOnly?'real_caller_real_inner_custom_task_evaluation':'real_caller_real_inner_custom_schema_evaluation'):'offline_transport_fixture',delivery,
   batchAccounting,
   independentRealCallerVerified:config.live&&ready,improvementProven:false,modelRequests:config.live?requests.length:0,syntheticRequests:config.live?0:requests.length,requestCounts:counts,currency:'CNY',costCny:config.live?budget.snapshot().costCny:0,syntheticCostCny:config.live?null:budget.snapshot().costCny,
   accounting:'This total admission ledger covers every model request exactly once. Native experiment ledgers overlap these charges; do not add them again.',budget:budget.snapshot(),firstValidRunMs,totalWallTimeMs:performance.now()-started,humanInterventions:0,implementerMessages:0,invalidToolCalls:calls.filter(c=>c.result.isError).length,
   initialEvaluatorBound:false,callerAttachedCustomEvaluator:attached,warmStartConsumed:warmConsumed,innerRunIds:completed.map(r=>r.runId),attemptedInnerRunIds:runs.map(r=>r.runId),candidateReports:[...reports.values()],interpretationValid:!!interpreted,checks,finalText,failure,
   limitations:evaluationOnly?resources.evidenceLimits:['Custom schema measurement checks format and supplied source membership, not semantic truth.','Existing final task sets are not claimed unseen. Warm history independently reports final-data limits.','No quality improvement, general DUO advantage, autonomous provider authoring or deployment is established.']}
  j.complete(report);save('result.json',report);save('total-budget.json',budget.snapshot());save('total-cost-receipts.json',budget.receipts());release()
  if(!ready)throw new Error('Combined acceptance incomplete; preserve requests, Caller trace and both native Journals without replay')
 }
 ctx.effect(()=>ctx.appReady.onReady(()=>{void run().then(()=>ctx.appExit(0),error=>{save('entry-error.json',{message:error.message});ctx.appExit(1)})}))
}
