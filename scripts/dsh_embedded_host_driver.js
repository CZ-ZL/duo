// Actual DSH AgentLoop integration with a bounded scripted adapter. This proves
// native task composition, not independent model judgment or optimization gains.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {LlmAdapter,createUserMessage} from '@deepseek-ai/dsh-llm'
import {PERSONA_SECTION} from '@deepseek-ai/dsh-system-prompt'
export const name='duo-embedded-host-verification'
export const inject=['agents','llm','tools','appReady','appExit']
export function apply(ctx,config){
 const checks=[],calls=[],requests=[],sessionId='duo-embedded-offline-caller',tokens=new Map()
 const save=(name,value)=>writeFileSync(join(config.outputDir,name),JSON.stringify(value,null,2)+'\n')
 const check=(label,value)=>{assert.ok(value,label);checks.push(label)}
 const tokenId=token=>{if(!token)return null;if(!tokens.has(token))tokens.set(token,tokens.size+1);return tokens.get(token)}
 const trace=ctx.on('tools/result',(exec,result)=>{
  if(exec.agent?.session.id!==sessionId)return
  calls.push({name:exec.name,args:exec.arguments,callId:exec.callId,rootCallId:exec.rootCallId,token:tokenId(exec.token),parent:tokenId(exec.parent),sessionId:exec.agent.session.id,result});save('agent-tool-calls.json',calls)
 })
 class Adapter extends LlmAdapter{
  async *stream(options){
   if(options.sessionId!==sessionId||options.provider!=='duo-embedded-fixture'||options.model!=='scripted'||options.maxTokens!==512||requests.length>=3||Buffer.byteLength(JSON.stringify(options.messages))>65536)throw new Error('Offline embedded Agent request exceeds the frozen fixture scope')
   requests.push({sessionId:options.sessionId,provider:options.provider,model:options.model,messages:options.messages,tools:options.tools,fixture:true});save('adapter-requests.json',requests)
   const values=options.messages.flatMap(m=>(m.content??[]).flatMap(c=>c.type==='tool-result'?c.content:[c]).filter(c=>c.type==='text').flatMap(c=>{try{return [JSON.parse(c.text)]}catch{return []}}))
   const plan=values.find(x=>x.planDigest&&x.spec),outcome=values.find(x=>x.kind==='duo_task_outcome')
   const step=requests.length
   if(step<3)yield {type:'tool-call-delta',index:0,id:'embedded-'+step,name:step===1?'dualloop_plan':'duo_task',argumentsDelta:JSON.stringify(step===1?{}:{planDigest:plan?.planDigest})}
   else yield {type:'text-delta',index:0,text:JSON.stringify({task:'consume_duo_measurement',status:outcome?.deliveryState==='COMPLETE'?'measurement_received':'refused',runId:outcome?.run.runId??null,conclusion:outcome?.run.conclusion??null,budget:outcome?.report?.budget??null,evidenceKind:'fixture',improvementProven:false,limitation:'Scripted offline Agent and fixture measurements; no independent model or efficacy claim.'})}
   yield {type:'usage',usage:{inputTokens:0,cacheReadTokens:0,outputTokens:0,totalTokens:0}}
   yield {type:'finish',reason:{kind:step<3?'tool-calls':'stop'}}
  }
 }
 ctx.llm.registerAdapter(['duo-embedded-fixture'],new Adapter())
 async function run(){
  const guide=readFileSync(config.guidePath,'utf8'),abort=new AbortController(),timer=setTimeout(()=>abort.abort(),10000)
  let handle
  try{
   handle=await ctx.agents.create({sessionId,signal:abort.signal,agentOptions:{provider:'duo-embedded-fixture',model:'scripted',maxTokens:512},setup(c){
    c.systemPrompt.section({name:PERSONA_SECTION,order:0,text:'You use DUO as a measurement subtask of another task. Inspect the public plan, invoke duo_task, then consume its structured result. Preserve all declared limits.'})
    c.tools.restrict({allow:['dualloop_plan','duo_task','dualloop_run','dualloop_report']})
    if(config.scenario==='embedded-denied')c.tools.guard(exec=>exec.name==='dualloop_run'?'Offline control: nested DUO execution not authorized':undefined)
    c.on('agent/pre-step',(event,next)=>event.step>3?Promise.resolve({kind:'reject'}):next())
   }})
   handle.agent.followup(createUserMessage({source:{kind:'plugin',plugin:'duo-embedded-task-example'},content:[{type:'text',text:guide+'\nUse the configured evaluation-only DUO task as a subtask. Return its run ID, conclusion, current CNY budget and fixture limits. No retries or configuration changes.'}]}))
   await handle.agent.whenIdle()
   const events=handle.agent.session.ownEvents();save('agent-session.json',events)
   const finalText=events.filter(e=>e.type==='assistant/message').at(-1)?.data?.message?.content.filter(c=>c.type==='text').map(c=>c.text).join('\n')??''
   const interpreted=JSON.parse(finalText);save('agent-consumed-result.json',interpreted)
   check('actual Agent loop completed exactly three bounded scripted adapter requests',requests.length===3&&events.filter(e=>e.type==='turn/end').at(-1)?.data?.reason?.kind==='completed')
   const plan=calls.find(c=>c.name==='dualloop_plan')?.result.value,outer=calls.find(c=>c.name==='duo_task'),nested=calls.filter(c=>c.parent===outer?.token)
   save('plan.json',plan)
   check('nested DUO work retains the enclosing Agent, root call and opaque parent identity',nested.length>=1&&nested.every(c=>c.sessionId===sessionId&&c.rootCallId===outer.rootCallId&&c.parent===outer.token))
   if(config.scenario==='embedded-denied'){
    check('agent-scoped guard denial survives embedding before any Journal or reservation',outer.result.isError&&nested[0].result.isError&&!existsSync(config.runsRoot))
    check('Agent reports refusal without retry or fabricated measurements',interpreted.status==='refused'&&calls.filter(c=>c.name==='dualloop_run').length===1&&nested.length===1)
   }else{
    const delivered=outer.result.value;save('embedded-outcome.json',delivered)
    check('Agent consumes actual native evaluation output through caller-owned public composition',!outer.result.isError&&delivered.deliveryState==='COMPLETE'&&delivered.run.mode==='evaluation_only'&&delivered.run.status==='completed'&&interpreted.runId===plan.runId&&interpreted.conclusion===delivered.run.conclusion)
    check('same native ledger covers exactly execution and evaluation without generator work',delivered.report.budget.operations===2&&delivered.report.budget.phases.generation.operations===0&&delivered.run.generationsRun===0&&interpreted.budget.costCny===0)
    check('native report retains actual stage outcomes, source versions and diagnostic limits',delivered.report.candidates[0].version===plan.baseline.version&&delivered.report.candidates[0].fast.state==='EVALUATED'&&delivered.report.diagnostics.recovery.automaticNewRunAuthorized===false)
    const reread=await ctx.tools.execute({name:'duo_task',arguments:{planDigest:plan.planDigest},callId:'host-idempotence-check',signal:abort.signal})
    check('repeated embedded invocation reads terminal artifacts with unchanged native cost',!reread.isError&&reread.value.run.reusedArtifacts&&JSON.stringify(reread.value.report.budget)===JSON.stringify(delivered.report.budget))
    check('original Target remains byte-identical',readFileSync(plan.spec.target.path,'utf8')===plan.baseline.persona)
    check('two nested public calls deliver the subtask without private core access',nested.map(c=>c.name).join(',')==='dualloop_run,dualloop_report')
   }
   check('fixture consumption makes no optimization or independent real Caller claim',interpreted.evidenceKind==='fixture'&&interpreted.improvementProven===false)
  }finally{clearTimeout(timer);if(handle)await handle.dispose();trace()}
  check('embedded Agent is disposed after use',ctx.agents.list().length===0)
  save('receipt.json',{status:'PASS',host:'actual named DSH profile and AgentLoop',scenario:config.scenario,checks,toolCalls:calls.length,modelSessions:1,adapterRequests:requests.length,paidCalls:0,currency:'CNY',costCny:0,usageEvidence:'Zero usage is a static fixture marker, not a real provider receipt',independentCallerVerified:false,improvementProven:false})
 }
 ctx.effect(()=>ctx.appReady.onReady(()=>{void run().then(()=>ctx.appExit(0),error=>{save('receipt.json',{status:'FAIL',checks,error:{name:error.name,message:error.message},toolCalls:calls.length,adapterRequests:requests.length});ctx.appExit(1)})}))
}
