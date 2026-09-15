import assert from 'node:assert/strict'
import {writeFileSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {ExecutorService} from '@dual-loop/dsh-plugin/definitions'
export const name='duo-code-controls-host'
export const inject=['tools','appReady','appExit']
export async function apply(ctx,config){
 class ControlSource extends ExecutorService {
  describe(){return {id:'code-control-source',version:'1',currency:'CNY',reservationCny:0,
   permissions:{paid:false,network:false,externalSideEffects:false},evidenceKind:'fixture'}}
  async execute(){return {artifact:{text:'{}'},currency:'CNY',costCny:0}}
 }
 await ctx.plugin(ControlSource)
 const calls=[]
 const save=(file,value)=>writeFileSync(join(config.output,file),JSON.stringify(value,null,2)+'\n')
 async function call(name,args={}){
  const result=await ctx.tools.execute({name,arguments:args,callId:'code-control-'+calls.length,signal:new AbortController().signal})
  calls.push({name,args,result});save('calls.json',calls)
  assert.equal(result.isError,false,JSON.stringify(result.error));return result.value
 }
 async function run(){
  try{
   const before=readFileSync(config.persona)
   const discovery=await call('dualloop_discover'),plan=await call('dualloop_plan')
   const result=await call('dualloop_run',{planDigest:plan.planDigest})
   const status=await call('dualloop_status',{runId:plan.runId}),budget=await call('dualloop_budget_status',{runId:plan.runId})
   const report=await call('dualloop_report',{runId:plan.runId})
   save('discovery.json',discovery);save('plan.json',plan);save('result.json',result);save('journal.json',status);save('budget.json',budget);save('report.json',report)
   const verifiedTiers=config.expectedTiers??['fast']
   assert.equal(result.status,'completed');assert.deepEqual(result.evaluations.map(e=>e.tier),verifiedTiers)
   for(const evaluation of result.evaluations){
    assert.equal(evaluation.metrics.control_match_rate,1)
    assert.equal(evaluation.metrics.controls_distinguish,true)
    assert.equal(evaluation.metrics.sample_size,6)
   }
   assert.equal(result.generationsRun,0);assert.ok(before.equals(readFileSync(config.persona)))
   const repeated=await call('dualloop_run',{planDigest:plan.planDigest});assert.equal(repeated.reusedArtifacts,true)
   save('receipt.json',{status:'PASS',host:'actual named DSH profile',publicTools:calls.map(c=>c.name),modelRequests:0,costCny:0,
    verifiedTiers,controls:result.evaluations[0].metrics,qualification:'KNOWN_OUTPUT_CONTROLS_ONLY',realAgentUse:'NOT_RUN',optimizationBenefit:'NOT_RUN'})
   ctx.appExit(0)
  }catch(error){save('failure.json',{message:error.message,stack:error.stack});ctx.appExit(1)}
 }
 ctx.effect(()=>ctx.appReady.onReady(()=>{void run()}))
}
