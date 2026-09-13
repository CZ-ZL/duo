import assert from 'node:assert/strict'
import {writeFileSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import childProcess from 'node:child_process'
import {syncBuiltinESMExports} from 'node:module'
export const name='duo-model-executor-host-check'
export const inject=['duoExecutor','duoJournal','duoBudget','agents','appReady','appExit','llm']
export function apply(ctx,config){
 const save=(file,x)=>writeFileSync(join(config.output,file),JSON.stringify(x,null,2)+'\n')
 const checks=[],requests=[];let childProcessAttempts=0
 const check=(name,value)=>{assert.ok(value,name);checks.push(name)}
 ctx.on('llm/stream',(options,next)=>{requests.push({system:options.system,messages:options.messages,tools:options.tools,sessionId:options.sessionId});return next()})
 async function run(){
  const keys=['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'],original=Object.fromEntries(keys.map(k=>[k,childProcess[k]]))
  for(const k of keys)childProcess[k]=()=>{childProcessAttempts++;throw new Error('Native Executor must not start a child process')}
  syncBuiltinESMExports()
  try{
   const abort=new AbortController(),candidate={id:'host-persona',version:'v1',persona:'ISOLATED_HOST_PERSONA {{model}} {{cwd}}'}
   const journal=ctx.duoJournal.open('executor-host',{create:true});journal.claim('executor-host-plan')
   const ledger=ctx.duoBudget.open('executor-host',{maxCostUsd:0.01,maxSessions:1,maxFastEvals:1,maxSlowEvals:0})
   ledger.reserve('executor-1',{phase:'evaluation',tier:'fast',maxCostUsd:ctx.duoExecutor.describe().reservationUsd,request:{candidateId:candidate.id}})
   let timer;if(config.scenario==='cancel')timer=setTimeout(()=>abort.abort(),100)
   const output=await ctx.duoExecutor.execute({candidate,applied:candidate,tier:'fast',signal:abort.signal});clearTimeout(timer)
   ledger.settle('executor-1',output.costUsd,'executor-1:completed',{provider:ctx.duoExecutor.describe().id,costEvidence:output.costEvidence})
   const budget=ctx.duoBudget.inspect('executor-host'),receipts=ledger.receipts()
   save('budget.json',budget);save('budget-receipts.json',receipts)
   check('real SQLite budget settles actual Executor return',budget.costUsd===output.costUsd&&budget.operations===1)
   check('native receipt retains the Agent usage reference',receipts.length===1&&receipts[0].evidence.costEvidence.receiptPath===output.artifact.receiptPath)
   check('unknown usage blocks subsequent admission',config.scenario!=='missing-usage'||budget.blockedReason==='DUO_COST_UNKNOWN')
   journal.complete({status:'completed',evidenceKind:'fixture',costUsd:budget.costUsd})
   save('executor-output.json',output);save('requests.json',requests)
   check('one real DSH Agent request',requests.length===1)
   check('agent scoped persona assembled by DSH',requests[0].system.includes('ISOLATED_HOST_PERSONA')&&!requests[0].system.includes('{{model}}'))
   check('no tools offered to candidate',!requests[0].tools?.length)
   check('only public fast inputs reach model',!JSON.stringify(requests).includes('SECRET_KEY')&&!JSON.stringify(requests).includes('FINAL_HELD_OUT'))
   check('owned Agent disposed',ctx.agents.list().length===0)
   check('correct terminal status',output.artifact.status===(config.scenario==='cancel'?'cancelled':'completed'))
   if(config.scenario==='cancel')check('DSH typed cancellation cause retained',output.artifact.terminal?.reason?.kind==='parent')
   check('missing usage stays unknown',output.costUsd===(config.scenario==='missing-usage'?null:0.000102))
   check('fixture usage cannot claim real expense',output.costEvidence.kind==='fixture')
   const receipt=JSON.parse(readFileSync(output.artifact.receiptPath,'utf8'))
   check('native Session events retained',receipt.sessionEvents.some(e=>e.type==='turn/end'))
   check('no child process during executor',childProcessAttempts===0)
   save('receipt.json',{status:'PASS',checks,hostPid:process.pid,modelSessions:requests.length,paidCalls:0,childProcessAttempts,evidenceKind:'fixture'})
  }finally{for(const k of keys)childProcess[k]=original[k];syncBuiltinESMExports()}
 }
 ctx.effect(()=>ctx.appReady.onReady(()=>{void run().then(()=>ctx.appExit(0),error=>{save('receipt.json',{status:'FAIL',checks,error:{code:error.code,message:error.message}});ctx.appExit(1)})}))
}
