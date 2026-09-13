// A bounded use of the host's existing Agent lifecycle, not another agent loop.
import {randomUUID} from 'node:crypto'
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {createUserMessage} from '@deepseek-ai/dsh-llm'
import {PERSONA_SECTION} from '@deepseek-ai/dsh-system-prompt'
import {fail} from './definitions.js'
import {digest} from './store.js'
import {freeze} from './contract.js'
import {moneyFields} from './money.js'
import {tierNamePattern} from './stages.js'

export const datasetTiers=dataset=>Object.keys(dataset??{}).filter(k=>dataset[k]&&typeof dataset[k]==='object'&&('id' in dataset[k]||'tasks' in dataset[k]))

export function modelSettings(config) {
 const c={maxInputBytes:4096,...structuredClone(config)},m=moneyFields(c)
 if(m.currency!==moneyFields(c.pricing).currency)fail('DUO_CURRENCY_MISMATCH','Model reservation and tariff currencies differ')
 if(!['provider','model','artifactRoot','datasetPath'].every(k=>typeof c[k]==='string'&&c[k])||
    !['maxTokens','timeoutMs','maxInputBytes'].every(k=>Number.isSafeInteger(c[k])&&c[k]>0)||
    !Number.isFinite(c[m.reservation])||c[m.reservation]<=0||!['fixture','model'].includes(c.evidenceKind))
  fail('DUO_MODEL_CONFIG_INVALID','Explicit model, dataset, artifact directory, positive reservation and request limits are required')
 if(priceUsage({inputTokens:0,cacheReadTokens:0,outputTokens:0,totalTokens:0},c.pricing)===null)
  fail('DUO_MODEL_CONFIG_INVALID','A complete frozen price table in the reservation currency is required before any model request')
 // Conservative byte envelope plus 4096 framing tokens; output includes reasoning.
 const envelope=((c.maxInputBytes+4096)*Math.max(c.pricing[m.input],c.pricing[m.cache])+c.maxTokens*c.pricing[m.output])/1e6
 if(c[m.reservation]<envelope)fail('DUO_MODEL_CONFIG_INVALID','Reservation must cover the bounded input, framing allowance and maximum output at frozen prices')
 c.artifactRoot=resolve(c.artifactRoot);c.datasetPath=resolve(c.datasetPath)
 const dataset=readDataset(c.datasetPath)
 return freeze({config:c,dataset,datasetDigest:digest(dataset)})
}

export function readDataset(path) {
 let dataset;try{dataset=JSON.parse(readFileSync(path,'utf8'))}catch{fail('DUO_DATA_INVALID','Dataset must be readable JSON')}
 const ids=new Set(),taskIds=new Set(),inputs=new Set()
 if(dataset?.version!==1)fail('DUO_DATA_INVALID','Dataset version 1 is required')
 const splitTiers=datasetTiers(dataset)
 if(!splitTiers.length||splitTiers.some(t=>t!=='final'&&!tierNamePattern.test(t)))fail('DUO_DATA_INVALID','Dataset splits use tier names matching the contract credibility ladder plus final')
 for(const tier of splitTiers){
  const split=dataset[tier]
  if(!split||typeof split.id!=='string'||!split.id||ids.has(split.id)||!Array.isArray(split.tasks)||!split.tasks.length)fail('DUO_DATA_INVALID','Every supplied split must be nonempty and distinct')
  ids.add(split.id)
  for(const task of split.tasks){
   if(typeof task.id!=='string'||!task.id||taskIds.has(task.id)||typeof task.input!=='string'||!task.input.trim()||inputs.has(task.input))fail('DUO_DATA_INVALID','Task ids and task inputs must be unique across search and final splits')
   taskIds.add(task.id);inputs.add(task.input)
  }
 }
 return freeze(dataset)
}

export function modelDescriptor(id,state) {
 const m=moneyFields(state.config)
 return {id,version:'1',currency:m.currency,[m.reservation]:state.config[m.reservation],
  permissions:{paid:true,network:state.config.evidenceKind==='model',externalSideEffects:false},
  evidenceKind:state.config.evidenceKind,configDigest:digest(state.config),datasetDigest:state.datasetDigest,
  provider:state.config.provider,model:state.config.model,maxRequests:1,maxTokens:state.config.maxTokens,maxInputBytes:state.config.maxInputBytes,
  pricing:state.config.pricing??null,artifactRoot:state.config.artifactRoot}
}

export function priceUsage(usage,pricing) {
 const keys=['inputTokens','cacheReadTokens','outputTokens','totalTokens'],m=moneyFields(pricing)
 if(!usage||!keys.every(k=>Number.isSafeInteger(usage[k])&&usage[k]>=0)||usage.cacheWriteTokens>0||
    usage.inputTokens+usage.cacheReadTokens+usage.outputTokens!==usage.totalTokens||
    !pricing||typeof pricing.id!=='string'||![m.input,m.cache,m.output].every(k=>Number.isFinite(pricing[k])&&pricing[k]>=0))return null
 // DSH's DeepSeek adapter emits disjoint uncached input, cache read, and output.
 // Reasoning tokens are included in output and must not be charged a second time.
 // Interpret the frozen decimal tariffs exactly, then ceil the total once.
 // Binary multiplication before ceil can add a spurious nanounit at integers.
 const rates=[m.input,m.cache,m.output].map(key=>{
  const [base,exponent='0']=String(pricing[key]).split('e'),[whole,fraction='']=base.split('.')
  return {value:BigInt(whole+fraction),power:Number(exponent)-fraction.length}
 })
 const power=Math.min(0,...rates.map(rate=>rate.power))
 const total=rates.reduce((sum,rate,i)=>sum+BigInt(usage[keys[i]])*rate.value*10n**BigInt(rate.power-power),0n)
 // Million-token rates to ledger nanounits multiply by 10^(9-6).
 const shift=power+3,divisor=shift<0?10n**BigInt(-shift):1n
 const numerator=shift>=0?total*10n**BigInt(shift):total
 const nano=(numerator+divisor-1n)/divisor
 return nano<=BigInt(Number.MAX_SAFE_INTEGER)?Number(nano)/1e9:null
}

export function pricingForInterval(pricing,start,end){
 if(!pricing?.schedule)return pricing
 if(pricing.schedule!=='deepseek-weekday-utc-v1')return null
 const a=Date.parse(start),b=Date.parse(end),m=moneyFields(pricing)
 if(!Number.isFinite(a)||!Number.isFinite(b)||b<a||b-a>86400000)return null
 const day=86400000,weekday=ms=>{const d=new Date(ms).getUTCDay();return d>=1&&d<=5}
 // A boundary inside the request makes the provider's billing instant ambiguous.
 for(let d=Math.floor(a/day)*day;d<=b;d+=day)if(weekday(d))for(const hour of [1,4,6,10]){
  const boundary=d+hour*3600000;if(boundary>a&&boundary<=b)return null
 }
 const h=new Date(a).getUTCHours(),peak=weekday(a)&&(h>=1&&h<4||h>=6&&h<10),factor=peak?1:.5
 return {...pricing,rateClass:peak?'peak':'off-peak',[m.input]:pricing[m.input]*factor,[m.cache]:pricing[m.cache]*factor,[m.output]:pricing[m.output]*factor}
}

export async function runModelAgent(ctx,config,{persona,prompt,identity,signal}) {
 if(signal?.aborted)fail('ABORTED','Model operation cancelled before admission')
 const sessionId='duo-'+randomUUID(),startedAt=new Date().toISOString(),start=performance.now()
 const timeout=new AbortController(),timer=setTimeout(()=>timeout.abort(),config.timeoutMs)
 const combined=signal?AbortSignal.any([signal,timeout.signal]):timeout.signal
 let handle,usage=null,finish=null,attempts=0,sessionEvents=[],failure=null,text=''
 const cancel=()=>handle?.agent.cancel({kind:'parent'})
 const refuse=(code,message)=>{failure={code,message,component:identity.operation==='generate'?'duoGenerator':'duoExecutor',retryable:false,nextAction:'Inspect the frozen plan and retained receipt; correct the request configuration before a new authorized run'};fail(code,message)}
 const stop=ctx.on('llm/stream',(options,next)=>{
  if(options.sessionId!==sessionId)return next()
  return (async function*(){
   // This also caps retries introduced by other host plugins.
   if(attempts!==0)refuse('DUO_REQUEST_LIMIT','One model request per reserved operation; inspect receipts before another run')
   if(options.provider!==config.provider||options.model!==config.model||options.maxTokens!==config.maxTokens)
    refuse('DUO_MODEL_ROUTE_CHANGED','Host request differs from the inspected model route or token cap')
   if(Buffer.byteLength(JSON.stringify({system:options.system,messages:options.messages,tools:options.tools}),'utf8')>config.maxInputBytes)
    refuse('DUO_REQUEST_LIMIT','Assembled input exceeds the byte envelope reserved for this operation')
   if(config.pricing?.schedule&&(config.pricing.verifiedDate!==new Date().toISOString().slice(0,10)||!pricingForInterval(config.pricing,startedAt,startedAt)))
    refuse('DUO_PRICING_STALE','Refresh the published tariff and inspect a new plan before a model request')
   attempts++
   for await(const chunk of next()){
    if(chunk.type==='usage')usage=structuredClone(chunk.usage)
    if(chunk.type==='finish')finish=structuredClone(chunk.reason)
    if(chunk.type==='text-delta')text+=chunk.text
    yield chunk
   }
  })()
 })
 try {
  handle=await ctx.agents.create({sessionId,signal:combined,agentOptions:{provider:config.provider,model:config.model,maxTokens:config.maxTokens},
   setup(agentCtx){
    agentCtx.systemPrompt.section({name:PERSONA_SECTION,order:0,text:persona})
    agentCtx.systemPrompt.variable('model',()=>config.model)
    agentCtx.systemPrompt.variable('cwd',()=>process.cwd())
    agentCtx.tools.restrict({allow:[]})
    agentCtx.on('agent/pre-step',(event,next)=>event.step>1?Promise.resolve({kind:'reject'}):next())
   }})
  // agents.create signal owns construction only. Bind cancellation after publication.
  combined.addEventListener('abort',cancel,{once:true})
  combined.throwIfAborted()
  handle.agent.followup(createUserMessage({source:{kind:'plugin',plugin:'@dual-loop/dsh-plugin'},content:[{type:'text',text:prompt}]}))
  await handle.agent.whenIdle()
 } catch(error) { failure??={code:error?.code??'DUO_MODEL_FAILED',message:'The owned DSH model operation failed; inspect its retained session receipt'} }
 finally {
  try {
   if(handle){try{await handle.dispose()}catch{failure={code:'DUO_AGENT_DISPOSE_FAILED',message:'Owned Agent disposal failed; inspect the retained receipt before reuse'}}
    sessionEvents=structuredClone(handle.agent.session.ownEvents())}
  } finally {combined.removeEventListener('abort',cancel);stop();clearTimeout(timer)}
 }
 const terminal=sessionEvents.filter(e=>e.type==='turn/end').at(-1)?.data?.reason
 const assembled=sessionEvents.filter(e=>e.type==='assistant/message').at(-1)?.data?.message
 if(assembled)text=assembled.content.filter(b=>b.type==='text').map(b=>b.text).join('\n')
 const status=combined.aborted?'cancelled':!failure&&['stop','completed'].includes(finish?.kind)&&terminal?.kind==='completed'?'completed':'failed'
 const settledAt=new Date().toISOString(),effectivePricing=pricingForInterval(config.pricing,startedAt,settledAt)
 const m=moneyFields(config),cost=attempts===0?0:priceUsage(usage,effectivePricing),amount={currency:m.currency,[m.cost]:cost}
 const receiptPath=join(config.artifactRoot,sessionId+'.json')
 const costEvidence={currency:m.currency,kind:config.evidenceKind,method:'usage_times_frozen_prices',complete:cost!==null,
  usage,pricing:effectivePricing??null,frozenPricing:config.pricing??null,startedAt,settledAt,provider:config.provider,model:config.model,attempts,receiptPath}
 const artifact={...identity,sessionId,receiptPath,status,text,finish,terminal:terminal??null,failure,
  startedAt,wallTimeMs:performance.now()-start,hostPid:process.pid}
 // A receipt write failure must not drop the settled amount or escape as a raw fs error.
 let writeFailure=null
 try {
  mkdirSync(config.artifactRoot,{recursive:true})
  writeFileSync(receiptPath,JSON.stringify({...artifact,...amount,costEvidence,sessionEvents},null,2)+'\n',{flag:'wx'})
 } catch {
  writeFailure={code:'DUO_RECEIPT_WRITE_FAILED',message:'The session receipt could not be persisted; the settled amount in this result remains authoritative',component:identity.operation==='generate'?'duoGenerator':'duoExecutor',retryable:false,nextAction:'Check artifactRoot permissions and free space; reconcile the settled cost from this result before any new authorized run'}
  artifact.receiptPath=null;artifact.status='failed';artifact.failure=writeFailure;costEvidence.receiptPath=null
 }
 const outcome=writeFailure?'failed':status
 return {artifact,...amount,costEvidence,...outcome==='completed'?{}:{error:writeFailure??failure??{code:outcome==='cancelled'?'ABORTED':'DUO_MODEL_FAILED',message:'Model turn did not complete; inspect its retained session receipt',component:identity.operation==='generate'?'duoGenerator':'duoExecutor',retryable:false,nextAction:'Inspect model output, terminal reason and remaining budget before preparing another authorized run'}}}
}
