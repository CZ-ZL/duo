// Native configuration diagnostic providers. Only transport is pinned-source replay.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {createUserMessage} from '@deepseek-ai/dsh-llm'
import {HttpFetchProvider} from '@deepseek-ai/dsh-web-fetch-http'
import {ExecutorService,EvaluatorsService,fail} from '@dual-loop/dsh-plugin/definitions'
import {validateFetchConfig} from '@dual-loop/dsh-plugin/config-target'
import {priceUsage,pricingForInterval} from '@dual-loop/dsh-plugin/model-accounting'
export const name='fetch-config-diagnostic'
export const inject=['agents','llm','tools','systemPrompt','web','appReady','appExit']
const save=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n')
const read=path=>JSON.parse(readFileSync(path,'utf8'))
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
export function scoreAnswer(text,tasks,body){
 let answer
 try{
  answer=JSON.parse(text)
  // Exact full shape; duplicate keys are refused before interpretation.
  const tokens=text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]/g)??[],stack=[]
  for(let i=0;i<tokens.length;i++){
   const x=tokens[i];if(x==='{')stack.push(new Set());else if(x==='[')stack.push(null);else if(x==='}'||x===']')stack.pop()
   else if(x.startsWith('"')&&tokens[i+1]===':'){const k=JSON.parse(x);if(!stack.at(-1)||stack.at(-1).has(k))throw Error('Duplicate key');stack.at(-1).add(k)}
  }
  if(!answer||Object.keys(answer).sort().join(',')!==tasks.map(t=>t.id).sort().join(','))throw Error('Task keys differ')
  for(const row of Object.values(answer))if(!row||Object.keys(row).sort().join(',')!=='quote,type'||!['number','boolean','string','UNKNOWN'].includes(row.type)||typeof row.quote!=='string'||row.type==='UNKNOWN'&&row.quote!=='')throw Error('Answer shape differs')
 }catch(error){return {status:'INVALID_OUTPUT',passed:0,total:tasks.length,rows:[],error:error.message}}
 const rows=tasks.map(t=>({taskId:t.id,answerCorrect:answer[t.id].type===t.expected.type&&answer[t.id].quote===t.expected.quote,
  exposed:typeof body==='string'&&Array.from(body).length>=t.expected.endChar&&body.includes(t.expected.quote)}))
 for(const r of rows)r.passed=r.answerCorrect&&r.exposed
 return {status:'VALID',passed:rows.filter(r=>r.passed).length,total:tasks.length,rows}
}
export function apply(ctx,config){
 const dataset=read(config.datasetPath),source=readFileSync(config.sourcePath)
 if(sha(source)!==config.sourceSha256)throw Error('Frozen source changed')
 const desc=(id)=>({id,version:'1',currency:'CNY',reservationCny:0,permissions:{paid:false,network:false,externalSideEffects:false},evidenceKind:'deterministic-real-output'})
 let active=null
 ctx.web.registerFetchProvider({id:'config-audit',available:()=>!!active,async fetch(request,signal){
  if(!active||request.url!==config.sourceUrl)fail('FETCH_SOURCE_REFUSED','Only the frozen source is allowed')
  if(active.fetchAttempts++>=1)fail('FETCH_CALL_LIMIT','Only one source read per candidate execution')
  return new HttpFetchProvider(active.config).readBody(new Response(source,{headers:{'content-type':'text/plain; charset=utf-8','content-length':String(source.length)}}),new URL(request.url),signal)
 }})
 class FetchExecutor extends ExecutorService {
  describe(){return {...desc('native-fetch-config-executor'),reservationCny:.9,permissions:{paid:true,network:config.live,externalSideEffects:false},maxRequests:2,sourceSha256:config.sourceSha256,transport:'pinned-source-snapshot',maxInputBytes:196608,maxTokens:4096}}
  async execute({candidate,applied,tier,signal}){
   if(active)fail('FETCH_BUSY','Only sequential candidate execution is supported')
   validateFetchConfig(applied.config)
   const sessionId='duo-'+randomUUID(),abort=new AbortController(),combined=AbortSignal.any([signal,abort.signal]),timer=setTimeout(()=>abort.abort(),180000)
   const rows=dataset[tier].tasks,calls=[],before=read(config.ledgerPath).requests.length
   active={config:applied.config,sessionId,attempts:0,fetchAttempts:0};save(join(config.output,'active-fixture-context.json'),{candidateId:candidate.id,tier,config:applied.config,tasks:rows})
   let handle,failure=null,steps=0
   const observer=ctx.on('tools/result',(exec,result)=>{if(exec.agent?.session.id!==sessionId)return;calls.push({name:exec.name,arguments:exec.arguments,result});if(result.isError)failure={code:'FETCH_TOOL_FAILED',message:result.error?.message??'Tool failed'}})
   const cancel=()=>handle?.agent.cancel({kind:'parent'})
   try{
    handle=await ctx.agents.create({sessionId,cwd:config.workspace,signal:combined,agentOptions:{provider:'deepseek-official',model:'deepseek-flash',maxTokens:4096},setup(c){
     c.systemPrompt.section({name:'persona',order:0,text:applied.persona});c.tools.presentAs('native');c.tools.restrict({allow:['web_fetch']})
     c.on('system-prompt/assemble',async(assembly,context,next)=>{const value=await next();return calls.length>=1?{...value,tools:[]}:value})
     c.tools.guard(exec=>exec.name!=='web_fetch'||exec.arguments.url!==config.sourceUrl||calls.length>=1?'Only one fetch of the frozen URL is allowed':undefined)
     c.on('agent/pre-step',(event,next)=>{if(failure||event.step>2)return Promise.resolve({kind:'reject'});steps=event.step;if(event.step===2)c.tools.restrict({allow:[]});return next()})
    }})
    combined.addEventListener('abort',cancel,{once:true});combined.throwIfAborted()
    const prompt={instruction:'Fetch the immutable configuration-catalog source ONCE using web_fetch. The URL identifies a pinned local snapshot, not live HTTP. Then answer every requested field from the returned evidence. If its declaration is unavailable, use UNKNOWN and an empty quote. Return ONLY JSON keyed by task id; each value has exactly {"type":"number|boolean|string|UNKNOWN","quote":"exact trimmed declaration line"}. No extra keys, prose or Markdown. A repeated fetch cannot expose additional content.',tasks:rows.map(({id,input})=>({id,input})),source:config.sourceUrl}
    handle.agent.followup(createUserMessage({source:{kind:'plugin',plugin:name},content:[{type:'text',text:JSON.stringify(prompt)}]}))
    await handle.agent.whenIdle()
   }catch(e){failure??={code:e.code??'FETCH_EXECUTION_ERROR',message:e.message}}
   finally{combined.removeEventListener('abort',cancel);clearTimeout(timer);if(handle)await handle.dispose();observer();active=null}
   const events=handle?.agent.session.ownEvents()??[],terminal=events.filter(e=>e.type==='turn/end').at(-1)?.data?.reason
   const text=events.filter(e=>e.type==='assistant/message').at(-1)?.data?.message.content.filter(b=>b.type==='text').map(b=>b.text).join('\n')??''
   const receipts=read(config.ledgerPath).requests.slice(before),known=receipts.every(r=>r.costCny!==null),cost=known?Number((receipts.reduce((n,r)=>n+BigInt(Math.round(r.costCny*1e9)),0n)).toString())/1e9:null
   if(terminal?.kind!=='completed'||calls.length!==1)failure??={code:'FETCH_TURN_INCOMPLETE',message:'Expected a completed turn with one actual fetch'}
   const artifact={candidateId:candidate.id,candidateVersion:applied.version,config:applied.config,tier,sessionId,text,body:calls.find(c=>!c.result.isError)?.result?.value?.body?.content??'',calls,events,terminal,steps,status:failure?'failed':'completed'}
   save(join(config.output,sessionId+'.json'),{artifact,costCny:cost,receipts,failure})
   return {artifact,currency:'CNY',costCny:cost,costEvidence:{kind:config.live?'model':'fixture',complete:known,receipts},...(failure?{error:failure}:{})}
  }
 }
 class ExactEvaluators extends EvaluatorsService {
  describe(){return Object.entries(dataset).filter(([,s])=>s?.tasks).map(([tier,s])=>({...desc('fetch-field-exact'),tier,dataId:s.id,metrics:['quality','sample_size'],fidelityRationale:'Slow samples distinct development declarations; final questions are withheld from search.'}))}
  async evaluate({candidate,artifact,tier}){
   const score=scoreAnswer(artifact.text,dataset[tier].tasks,artifact.body)
   save(join(config.output,artifact.sessionId+'-score.json'),score)
   return {...desc('fetch-field-exact'),candidateId:candidate.id,evaluatorId:'fetch-field-exact',dataId:dataset[tier].id,tier,ok:score.status==='VALID',metrics:{quality:score.passed/score.total,sample_size:score.total},costCny:0,evidence:[score]}
  }
 }
 ctx.plugin(FetchExecutor);ctx.plugin(ExactEvaluators)
 // All generator, executor, auxiliary and failed requests share this persisted cap.
 ctx.on('llm/stream',(options,next)=>(async function*(){
  if(!config.enabled||config.live&&process.env.DUO_MODEL_RUN_ENABLED!=='1')fail('MODEL_DISABLED','Preparation cannot dispatch model work')
  const ledger=read(config.ledgerPath),bytes=Buffer.byteLength(JSON.stringify({system:options.system,messages:options.messages,tools:options.tools}))
  const used=ledger.requests.reduce((n,r)=>n+(r.costCny??0),0),reservation=active?.45:.18
  if(ledger.stopped||ledger.requests.some(r=>r.costCny===null||r.failed)||ledger.requests.length>=52||used+reservation>2||used+reservation+config.priorCostCny>10)fail('PACKAGE_BUDGET_STOP','Request, cost, prior failure or unknown usage prevents dispatch')
  if(options.provider!=='deepseek-official'||options.model!=='deepseek-flash'||options.maxTokens!==4096||bytes>(active?196608:65536))fail('ROUTE_ENVELOPE_CHANGED','Frozen route or byte envelope differs')
  if(active&&active.attempts++>=2)fail('FETCH_REQUEST_LIMIT','At most two model requests per candidate evaluation')
  const row={id:ledger.requests.length+1,arm:config.arm,sessionId:options.sessionId,operation:active?'execute':'generate',startedAt:new Date().toISOString(),bytes,usage:null,costCny:null}
  ledger.requests.push(row);save(config.ledgerPath,ledger);save(join(config.output,'request-'+row.id+'-input.json'),{system:options.system,messages:options.messages,tools:options.tools})
  try{for await(const chunk of next()){if(chunk.type==='usage')row.usage=chunk.usage;if(chunk.type==='finish')row.finish=chunk.reason;yield chunk}}
  catch(e){row.failed={code:e.code??'MODEL_FAILED',message:e.message};throw e}
  finally{row.finishedAt=new Date().toISOString();row.pricing=pricingForInterval(config.pricing,row.startedAt,row.finishedAt);row.costCny=priceUsage(row.usage,row.pricing);save(config.ledgerPath,ledger)}
 })())
 ctx.inject(['duoController'],c=>c.effect(()=>c.appReady.onReady(()=>{void(async()=>{
  const plan=c.duoController.plan();save(join(config.output,'plan.json'),plan)
  if(!config.enabled||config.live&&process.env.DUO_MODEL_RUN_ENABLED!=='1'){save(join(config.output,'prepare-plan.json'),{planDigest:plan.planDigest,modelRequests:0});ctx.appExit(0);return}
  const result=await c.duoController.run({planDigest:plan.planDigest});save(join(config.output,'result.json'),result)
  if(result.status!=='completed'){const ledger=read(config.ledgerPath);ledger.stopped={arm:config.arm,reason:result.stopReason,error:result.error};save(config.ledgerPath,ledger)}
  save(join(config.output,'Journal.json'),c.duoController.status(plan.runId));ctx.appExit(result.status==='completed'?0:2)
 })().catch(error=>{save(join(config.output,'entry-error.json'),{code:error.code,message:error.message});const ledger=read(config.ledgerPath);ledger.stopped={arm:config.arm,reason:error.code??'ENTRY_FAILED',message:error.message};save(config.ledgerPath,ledger);ctx.appExit(2)})})))
}
