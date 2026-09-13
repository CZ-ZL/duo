// Application entry is always the normal DSH CLI with a named profile.
import {writeFileSync,readFileSync} from 'node:fs'
import {join,dirname,isAbsolute} from 'node:path'
import {createHash} from 'node:crypto'
import childProcess from 'node:child_process'
import {syncBuiltinESMExports} from 'node:module'
export const name='duo-model-run-entry'
export const inject=['tools','duoController','duoBudget','agents','appReady','appExit','llm']
// Opt-in for one declared local evaluator, never a general shell capability.
// The normal entry still rejects every child process. Live preparation freezes
// the configured script/helpers and pack along with the entire profile.
export function installProcessGuard(policy,onDenied=()=>{},onAllowed=()=>{}){
 const names=['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']
 const old=Object.fromEntries(names.map(k=>[k,childProcess[k]]));let admitted=0
 const tierCounts={}
 if(policy&&(!['script','pack','artifactRoot'].every(k=>typeof policy[k]==='string'&&isAbsolute(policy[k]))||
  !Array.isArray(policy.tiers)||!policy.tiers.length||new Set(policy.tiers).size!==policy.tiers.length||policy.tiers.some(t=>!['fast','slow','final'].includes(t))||
  !Number.isSafeInteger(policy.maxCalls)||policy.maxCalls<1||
  policy.tiers.includes('final')&&(!policy.maxCallsByTier||![1,2].includes(policy.maxCallsByTier.final))||
  policy.maxCallsByTier&&(Object.keys(policy.maxCallsByTier).sort().join(',')!==[...policy.tiers].sort().join(',')||
   Object.values(policy.maxCallsByTier).some(n=>!Number.isSafeInteger(n)||n<1)||
   Object.values(policy.maxCallsByTier).reduce((a,b)=>a+b,0)>policy.maxCalls)))throw new Error('Invalid declared evaluator process policy')
 const permitted=(file,args,options,callback)=>policy&&admitted<policy.maxCalls&&file==='/usr/bin/python3'&&
  Array.isArray(args)&&args.length===9&&args[0]==='-I'&&args[1]==='-S'&&args[2]===policy.script&&
  args[3]==='--pack'&&args[4]===policy.pack&&args[5]==='--tier'&&policy.tiers.includes(args[6])&&
  (!policy.maxCallsByTier||(tierCounts[args[6]]??0)<policy.maxCallsByTier[args[6]])&&
  args[7]==='--output'&&typeof args[8]==='string'&&dirname(args[8])===policy.artifactRoot&&
  options&&Object.keys(options).every(k=>['env','timeout','maxBuffer','signal'].includes(k))&&
  options.env?.PATH==='/usr/bin:/bin'&&options.env?.LANG==='C.UTF-8'&&Object.keys(options.env).length===2&&
  Number.isSafeInteger(options.timeout)&&options.timeout>0&&options.timeout<=180000&&
  options.maxBuffer===2*1024*1024&&options.signal instanceof AbortSignal&&typeof callback==='function'
 for(const k of names)childProcess[k]=(...args)=>{
  if(k==='execFile'&&permitted(...args)){admitted++;tierCounts[args[1][6]]=(tierCounts[args[1][6]]??0)+1;onAllowed();return old[k](...args)}
  onDenied();throw new Error('Native model optimization cannot start undeclared child processes')
 }
 syncBuiltinESMExports()
 return ()=>{for(const k of names)childProcess[k]=old[k];syncBuiltinESMExports()}
}
export function apply(ctx,config){
 const running=!config.live||process.env.DUO_MODEL_RUN_ENABLED==='1',prefix=running?'run':'prepare'
 const save=(name,x)=>writeFileSync(join(config.output,name),JSON.stringify(x,null,2)+'\n')
 const calls=[],started=performance.now();let modelRequests=0,childProcessAttempts=0,evaluatorProcessCalls=0
 ctx.on('llm/stream',(options,next)=>{
  if(!running)throw new Error('Preparation cannot make a model request')
  if(modelRequests>=(config.maxModelRequests??14))throw new Error('Frozen batch model-request limit reached')
  modelRequests++
  save('model-request-'+modelRequests+'-input.json',{sessionId:options.sessionId,runtimeCwd:process.cwd(),provider:options.provider,model:options.model,maxTokens:options.maxTokens,
   system:options.system,messages:options.messages,tools:options.tools,
   observation:'Assembled host request; actual dispatch and settled usage are established by its matching session receipt.'})
  return next()
 })
 const call=async(name,args={})=>{
  const out=await ctx.tools.execute({name,arguments:args,callId:'duo-model-'+calls.length,signal:new AbortController().signal})
  calls.push({name,args,result:out});save(prefix+'-calls.json',calls)
  if(out.isError)throw Object.assign(new Error(out.error?.message??'DSH tool refused'),out.error)
  return out.value
 }
 async function run(){
  const restoreProcesses=installProcessGuard(config.evaluatorProcess,()=>childProcessAttempts++,()=>evaluatorProcessCalls++)
  const groups=[],settled=new Set();let plan=null,workStarted=false,reportAttempted=false
  const retainReport=async()=>{
   if(!plan||reportAttempted)return
   reportAttempted=true
   if(!ctx.tools.schemas().some(s=>s.name==='dualloop_report')){
    save('delivery-receipt.json',{runId:plan.runId,artifacts:{state:'REPORT_TOOL_UNAVAILABLE'},caller:{state:'NOT_USED_BY_THIS_ENTRY'},reportModelRequests:0});return
   }
   const beforeRequests=modelRequests,report=await call('dualloop_report',{runId:plan.runId})
   save('product-report.json',report);writeFileSync(join(config.output,'product-report.txt'),report.text+'\n')
   const files=['product-report.json','product-report.txt'].map(name=>({name,sha256:createHash('sha256').update(readFileSync(join(config.output,name))).digest('hex')}))
   save('delivery-receipt.json',{version:'1',runId:plan.runId,planDigest:plan.planDigest,execution:{state:report.status},
    artifacts:{state:'FILES_WRITTEN',files},caller:{state:'NOT_USED_BY_THIS_ENTRY',modelRequests:0},
    reportModelRequests:modelRequests-beforeRequests,innerModelRequestsAtExport:beforeRequests,
    accounting:report.delivery?.accounting??null,meaning:'Deterministic standalone host export, not an independent Calling Agent delivery receipt.'})
  }
  const settleGroups=(cost,evidence)=>{
   for(const group of groups)if(!settled.has(group.id)){
    // Never retry a failed settlement automatically: a staged receipt or an
    // overrun may already be durable even when reconciliation throws.
    settled.add(group.id)
    try{group.ledger.settle(plan.runId,cost,plan.runId+':terminal',{currency:'CNY',...evidence})}
    finally{save('group-'+group.id+'-budget.json',group.ledger.snapshot());save('group-'+group.id+'-receipts.json',group.ledger.receipts())}
   }
  }
  try{
   save('tool-schemas.json',ctx.tools.schemas())
   const discovery=await call('dualloop_discover');plan=await call('dualloop_plan')
   save(prefix+'-plan.json',plan);save(prefix+'-discovery.json',discovery)
   if(!running){save('prepare-receipt.json',{status:'PREPARED',planDigest:plan.planDigest,modelRequests,paidCalls:0});return}
   if(config.live){
    const expected=JSON.parse(readFileSync(join(config.output,'prepare-plan.json'),'utf8'))
    if(expected.planDigest!==plan.planDigest)throw new Error('Prepared plan changed; no paid admission')
   }
   if(!Array.isArray(config.budgetGroups??[])||new Set((config.budgetGroups??[]).map(g=>g.id)).size!==(config.budgetGroups??[]).length)throw new Error('Distinct declared budget groups required')
   for(const group of config.budgetGroups??[]){
    if(!/^[a-zA-Z0-9_-]{1,96}$/.test(group.id)||group.id===plan.runId||group.limits?.currency!=='CNY'||plan.spec.budget.currency!=='CNY'||
     !Number.isSafeInteger(group.maxModelRequestsPerRun)||config.maxModelRequests>group.maxModelRequestsPerRun)throw new Error('Budget group does not cover this finite experiment')
    const ledger=ctx.duoBudget.open(group.id,group.limits)
    ledger.reserve(plan.runId,{phase:'evaluation',currency:'CNY',maxCostCny:plan.spec.budget.maxCostCny,request:{planDigest:plan.planDigest,maxModelRequests:config.maxModelRequests,meaning:'Whole-run cost envelope; inner receipts are not charged twice'}})
    groups.push({id:group.id,ledger})
   }
   const before=readFileSync(plan.baseline.path);workStarted=true
   const result=await call('dualloop_run',{planDigest:plan.planDigest})
   const status=await call('dualloop_status',{runId:plan.runId}),budget=await call('dualloop_budget_status',{runId:plan.runId})
   const ledger=ctx.duoBudget.open(plan.runId,plan.spec.budget)
   const candidates=[...new Map(status.events.filter(e=>e.kind==='candidate'&&e.status==='proposed').map(e=>[e.candidateId??e.candidate?.id,e.candidate])).values()]
   save('result.json',result);save('journal.json',status);save('budget.json',budget);save('cost-receipts.json',ledger.receipts());save('candidates.json',candidates)
   // A deterministic public report is available without a final Caller request.
   await retainReport()
   settleGroups(budget.budget.costCny??null,{modelRequests,runId:plan.runId,innerLedger:ledger.receipts().map(r=>r.hash),unknownCost:budget.budget.costCny===null})
   const requestsBeforeRepeat=modelRequests,repeated=await call('dualloop_run',{planDigest:plan.planDigest})
   if(modelRequests!==requestsBeforeRepeat||!repeated.reusedArtifacts)throw new Error('Repeated run made new work')
   if(!before.equals(readFileSync(plan.baseline.path)))throw new Error('Original persona changed')
   if(ctx.agents.list().length!==0)throw new Error('An owned model Agent remained active')
   const currency=plan.spec.budget.currency??'USD',costKey=currency==='CNY'?'costCny':'costUsd',syntheticKey=currency==='CNY'?'syntheticCostCny':'syntheticCostUsd'
   const measurementScope=plan.spec.operation==='evaluate'?'evaluation_only':plan.spec.final?'declared_final':'declared_development_only'
   // A caller may deliberately omit final for a bounded development pilot.
   // Accept only its declared measurements; this supplies no final evidence.
   const measured=measurementScope==='evaluation_only'?result.evaluations?.length>0:
    measurementScope==='declared_final'?result.final.length>0:
    plan.searchStages?.length>0&&plan.searchStages.every(stage=>Number.isSafeInteger(result.stageAttempts?.[stage.tier])&&result.stageAttempts[stage.tier]>0)
   const summary={status:result.status==='completed'&&result.generationsRun>=(config.requiredGenerations??2)&&measured&&budget.budget[costKey]!==null?'PASS':'INCOMPLETE',
    arm:config.arm??'minimum',measurementScope,independentFinal:result.independentFinal??null,
    evidenceKind:config.live?'real_model_usage_priced':'fixture',optimizationProven:false,conclusion:result.conclusion,
    generationsRun:result.generationsRun,runId:plan.runId,planDigest:plan.planDigest,modelRequests,
    paidCalls:config.live?modelRequests:0,candidateCount:candidates.length,wallTimeMs:performance.now()-started,
    currency,[costKey]:config.live?budget.budget[costKey]:0,[syntheticKey]:config.live?null:budget.budget[costKey],
    originalPersonaSha256:createHash('sha256').update(before).digest('hex'),childProcessAttempts,evaluatorProcessCalls,
    limitation:config.live?'Usage priced at frozen published tariffs; not an independently retrieved billing invoice. Data independence and measurement validity require the experiment-specific audit.':'Synthetic model output, usage and prices validate functionality only.'}
   save('run-receipt.json',summary)
   if(summary.status!=='PASS')throw new Error('Run incomplete; inspect result.json and durable budget before any further work')
  }catch(error){
   try{await retainReport()}catch(reportError){save('delivery-error.json',{code:reportError.code??'DUO_REPORT_EXPORT_FAILED',message:reportError.message,modelRequests})}
   const retained=plan&&ctx.duoBudget.inspect(plan.runId)
   // If work might have started, missing accounting stays unknown. A refusal
   // before invoking the native run releases only this process's outer envelope.
   settleGroups(workStarted?(retained?.costCny??null):0,{modelRequests,runId:plan?.runId??null,unknownCost:workStarted&&retained?.costCny==null,entryError:error.code??'DUO_ENTRY_FAILED'})
   throw error
  }finally{restoreProcesses()}
 }
 ctx.effect(()=>ctx.appReady.onReady(()=>{void run().then(()=>ctx.appExit(0),e=>{save(prefix+'-error.json',{code:e.code??'DUO_ENTRY_FAILED',message:e.message,modelRequests,childProcessAttempts});ctx.appExit(1)})}))
}
