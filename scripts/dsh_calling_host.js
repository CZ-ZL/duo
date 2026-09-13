// A bounded acceptance application composed into an ordinary named DSH profile.
import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {createUserMessage} from '@deepseek-ai/dsh-llm'
import {PERSONA_SECTION} from '@deepseek-ai/dsh-system-prompt'
import {priceUsage,pricingForInterval} from '@dual-loop/dsh-plugin/model-accounting'
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')

export const name='duo-model-calling-acceptance'
export const inject=['agents','tools','llm','duoController','duoBudget','duoJournal','appReady','appExit']
export function apply(ctx,config){
 const output=config.output,save=(name,value)=>writeFileSync(join(output,name),JSON.stringify(value,null,2)+'\n')
 const running=!config.live||process.env.DUO_MODEL_RUN_ENABLED==='1'
 const guide=readFileSync(config.guidePath,'utf8'),objective=readFileSync(config.objectivePath,'utf8')
 const envelope=((config.maxInputBytes+4096)*Math.max(config.pricing.inputCnyPerMillion,config.pricing.cacheReadCnyPerMillion)+config.maxTokens*config.pricing.outputCnyPerMillion)/1e6
 if(config.pricing.currency!=='CNY'||!Number.isFinite(envelope)||envelope<0||!Number.isFinite(config.reservationCny)||config.reservationCny<envelope)throw new Error('Caller reservation does not cover its frozen CNY request envelope')
 const innerPlan=ctx.duoController.plan(),identity={apiVersion:2,scope:'native-model-caller',config,guide,objective,innerPlanDigest:innerPlan.planDigest}
 const planDigest=digest(identity)
 if(!running){
  const refuse=ctx.on('llm/stream',()=>{throw new Error('Preparation cannot call a model')})
  ctx.effect(()=>ctx.appReady.onReady(()=>{save('prepare-plan.json',{planDigest,innerPlan,config});save('prepare-receipt.json',{status:'PREPARED',modelRequests:0,paidCalls:0});refuse();ctx.appExit(0)}));return
 }
 async function run(){
  if(config.live&&JSON.parse(readFileSync(join(output,'prepare-plan.json'),'utf8')).planDigest!==planDigest)throw new Error('Prepared caller plan changed')
  const started=performance.now(),sessionId='duo-caller-'+randomUUID(),calls=[],requests=[],usageTotals={inputTokens:0,cacheReadTokens:0,outputTokens:0,totalTokens:0}
  const journal=ctx.duoJournal.open(planDigest,{create:true});journal.claim(planDigest);const release=journal.lease()
  const limits={currency:'CNY',maxCostCny:config.maxCostCny,maxSessions:config.maxModelRequests,maxFastEvals:0,maxSlowEvals:0,maxWallTimeMs:config.timeoutMs}
  const budget=ctx.duoBudget.open(planDigest,limits),abort=new AbortController(),timer=setTimeout(()=>abort.abort(),config.timeoutMs)
  let handle,failure=null,firstValidRunMs=null,finalText='',unknown=false
  const disposeResult=ctx.on('tools/result',(exec,result)=>{
   if(exec.agent?.session.id!==sessionId)return
   calls.push({name:exec.name,arguments:exec.arguments,result,elapsedMs:performance.now()-started})
   if(firstValidRunMs===null&&exec.name==='dualloop_run'&&!result.isError&&result.value.status==='completed')firstValidRunMs=performance.now()-started
   save('tool-calls.json',calls)
  })
  const disposeStream=ctx.on('llm/stream',(options,next)=>{
   if(options.sessionId!==sessionId)throw new Error('Caller acceptance forbids auxiliary model sessions')
   return (async function*(){
    if(requests.length>=config.maxModelRequests||budget.snapshot().blockedReason)throw new Error('Caller request or cost limit reached')
    if(options.provider!==config.provider||options.model!==config.model||options.maxTokens!==config.maxTokens)throw new Error('Caller route differs from the frozen plan')
    const requestBytes=Buffer.byteLength(JSON.stringify({system:options.system,messages:options.messages,tools:options.tools}))
    if(requestBytes>config.maxInputBytes)throw new Error('Caller request exceeds its reserved input envelope')
    const at=new Date().toISOString()
    if(config.live&&config.pricing.verifiedDate!==at.slice(0,10))throw new Error('Refresh stale CNY pricing before any further request')
    const id='caller-'+(requests.length+1),row={id,startedAt:at,requestBytes,usage:null,costCny:null}
    budget.reserve(id,{phase:'selection',currency:'CNY',maxCostCny:config.reservationCny,request:{sessionId,provider:config.provider,model:config.model,requestBytes,planDigest}})
    requests.push(row);save('requests.json',requests)
    let finish=null
    try{for await(const chunk of next()){
     if(chunk.type==='usage')row.usage=structuredClone(chunk.usage)
     if(chunk.type==='finish')finish=structuredClone(chunk.reason)
     yield chunk
    }}finally{
     row.settledAt=new Date().toISOString();row.finish=finish
     const pricing=pricingForInterval(config.pricing,row.startedAt,row.settledAt)
     row.costCny=priceUsage(row.usage,pricing);row.pricing=pricing
     budget.settle(id,row.costCny,id+':settled',{currency:'CNY',kind:config.live?'model':'fixture',...row})
     if(row.costCny===null)unknown=true
     else for(const key of Object.keys(usageTotals))usageTotals[key]+=row.usage[key]
     save('requests.json',requests)
    }
   })()
  })
  const cancel=()=>handle?.agent.cancel({kind:'parent'})
  try{
   handle=await ctx.agents.create({sessionId,signal:abort.signal,agentOptions:{provider:config.provider,model:config.model,maxTokens:config.maxTokens},setup(c){
    c.systemPrompt.section({name:PERSONA_SECTION,order:0,text:'You are an independent user of a configured DSH plugin. Use only the supplied public guide, goal, and tool responses. Do not claim fixture results prove optimization.'})
    c.tools.restrict({allow:['dualloop_discover','dualloop_plan','dualloop_run','dualloop_status','dualloop_budget_status','dualloop_budget_reconcile']})
    c.on('agent/pre-step',(event,next)=>event.step>config.maxModelRequests?Promise.resolve({kind:'reject'}):next())
   }})
   abort.signal.addEventListener('abort',cancel,{once:true});abort.signal.throwIfAborted()
   handle.agent.followup(createUserMessage({source:{kind:'plugin',plugin:'@dual-loop/dsh-plugin'},content:[{type:'text',text:guide+'\n\nGOAL\n'+objective}]}))
   await handle.agent.whenIdle()
  }catch(error){failure={message:error.message,code:error.code??'DUO_CALLER_FAILED'}}
  finally{
   try{if(handle)await handle.dispose()}catch(error){failure={code:'DUO_CALLER_DISPOSE_FAILED',message:error.message}}
   abort.signal.removeEventListener('abort',cancel);clearTimeout(timer);disposeStream();disposeResult()
  }
  const events=handle?.agent.session.ownEvents()??[]
  save('session-events.json',events)
  finalText=events.filter(e=>e.type==='assistant/message').at(-1)?.data?.message?.content.filter(c=>c.type==='text').map(c=>c.text).join('\n')??''
  const runs=calls.filter(c=>c.name==='dualloop_run'&&!c.result.isError&&c.result.value.status==='completed')
  const required=['dualloop_discover','dualloop_plan','dualloop_status','dualloop_budget_status']
  const recovered=calls.some((c,i)=>c.result.isError&&calls.slice(i+1).some(x=>x.name==='dualloop_run'&&!x.result.isError))
  let interpretation=null;try{interpretation=JSON.parse(finalText)}catch{}
  const interpretationValid=interpretation?.runId===innerPlan.runId&&interpretation?.conclusion===runs[0]?.result.value.conclusion&&interpretation?.evidenceKind==='fixture'&&interpretation?.improvementProven===false
  const completed=!failure&&!unknown&&events.filter(e=>e.type==='turn/end').at(-1)?.data?.reason?.kind==='completed'&&firstValidRunMs!==null&&required.every(name=>calls.some(c=>c.name===name&&!c.result.isError))&&recovered&&runs.some(c=>c.result.value.reusedArtifacts)&&interpretationValid
  const report={apiVersion:2,runId:planDigest,planDigest,status:completed?'completed':'failed',evidenceKind:config.live?'real_model_caller_with_fixture_work':'fixture',
   modelAutonomyEvaluated:config.live,innerEvidenceKind:'fixture',improvementProven:false,
   firstValidRunMs,totalWallTimeMs:performance.now()-started,humanInterventions:0,implementerMessages:0,
   suppliedGuideBytes:Buffer.byteLength(guide),requestUsage:usageTotals,preciseGuideTokens:'NOT_SEPARATELY_MEASURED',
   modelRequests:requests.length,paidCalls:config.live?requests.length:0,currency:'CNY',costCny:config.live?budget.snapshot().costCny:0,
   syntheticCostCny:config.live?null:budget.snapshot().costCny,unknownCost:unknown,budget:budget.snapshot(),recoveredError:recovered,
   reusedRun:runs.some(c=>c.result.value.reusedArtifacts),finalText,interpretationValid,failure,innerRunId:innerPlan.runId,
   limitation:'This accepts model-driven use of an already configured plugin; it does not measure open-ended provider authoring or prove optimizer quality.'}
  journal.complete(report);save('cost-receipts.json',budget.receipts());save('result.json',report);release()
  if(!completed)throw new Error('Calling acceptance incomplete; inspect retained tool/session/cost evidence')
 }
 ctx.effect(()=>ctx.appReady.onReady(()=>{void run().then(()=>ctx.appExit(0),error=>{save('entry-error.json',{message:error.message});ctx.appExit(1)})}))
}
