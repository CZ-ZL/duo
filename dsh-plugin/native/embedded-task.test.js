import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import Tools,{defineTool} from '@deepseek-ai/dsh-tools'
import Agents from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import {HarnessError,createUserMessage} from '@deepseek-ai/dsh-llm'
import * as Consumer from '../../examples/native/embedded-task.js'

const outcome={apiVersion:2,runtime:'dsh-native',runId:'fixture-run',status:'completed',conclusion:'retain_baseline',mode:'evaluation_only',improvementProven:false,evidenceKind:'fixture',budget:{currency:'CNY',costCny:0,operations:2}}
async function host(t,options={}){
 const ctx=new Context(),fibers=[],calls=[];let runs=0,reports=0
 const output={schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]}
 const fixture={name:'embedded-boundary-fixture',inject:['tools'],apply(c){
  c.tools.register(defineTool({name:'dualloop_run',description:'Offline protocol boundary fixture',parameters:{planDigest:{type:'string',required:true}},output,execute:async(args,exec)=>{
   runs++;assert.equal(args.planDigest,'inspected')
   if(options.waitForAbort)await new Promise((resolve,reject)=>{if(exec.signal.aborted)reject(new HarnessError('Cancelled','ABORTED'));else exec.signal.addEventListener('abort',()=>reject(new HarnessError('Cancelled','ABORTED')),{once:true})})
   if(options.context)exec.deferContext(options.context)
   if(options.conclude)exec.concludeTurn()
   return structuredClone(outcome)
  }}))
  c.tools.register(defineTool({name:'dualloop_report',description:'Offline report fixture',parameters:{runId:{type:'string',required:true}},output,execute:args=>{reports++;assert.equal(args.runId,'fixture-run');if(options.reportError)throw new HarnessError('Report unavailable','REPORT_CONTROL_FAILURE');return {apiVersion:2,runId:'fixture-run',budget:outcome.budget,candidates:[],replayedOperations:0}}}))
 }}
 for(const P of [Agents,SystemPrompt,Tools,fixture,Consumer])fibers.push(await ctx.plugin(P))
 ctx.on('tools/result',(exec,result)=>calls.push({exec,result}))
 t.after(async()=>{for(const f of fibers.reverse())await f.dispose()})
 return {ctx,calls,count:()=>({runs,reports}),call:(signal=new AbortController().signal)=>ctx.tools.execute({name:'duo_task',arguments:{planDigest:'inspected'},callId:'outer',signal}),fiber:fibers.at(-1)}
}
test('embedded consumer returns structured native outcome and report using exactly two public nested calls',async t=>{
 const h=await host(t),result=await h.call()
 assert.equal(result.isError,false,JSON.stringify(result.error));assert.equal(result.value.deliveryState,'COMPLETE');assert.deepEqual(result.value.run,outcome);assert.equal(result.value.report.replayedOperations,0)
 assert.deepEqual(h.count(),{runs:1,reports:1})
 const outer=h.calls.find(c=>c.exec.name==='duo_task'),nested=h.calls.filter(c=>c.exec.parent)
 assert.equal(nested.length,2);assert.ok(nested.every(c=>c.exec.parent===outer.exec.token&&c.exec.rootCallId===outer.exec.rootCallId))
 assert.ok(nested.every(c=>c.exec.signal===outer.exec.signal))
 await h.fiber.dispose();assert.ok(!h.ctx.tools.schemas().some(s=>s.name==='duo_task'))
})
test('embedded dispatch preserves a native guard denial and never reaches the work provider',async t=>{
 const h=await host(t);h.ctx.tools.guard(exec=>exec.name==='dualloop_run'?'Not authorized for this nested run':undefined)
 const result=await h.call(),inner=h.calls.find(c=>c.exec.name==='dualloop_run')
 assert.equal(result.isError,true);assert.equal(result.error.info?.code,inner.result.error.info?.code??'DUO_SUBTASK_FAILED');assert.match(result.error.message,/Not authorized/);assert.deepEqual(h.count(),{runs:0,reports:0})
})
test('embedded cancellation reaches the in-flight nested call without report or retry',async t=>{
 const h=await host(t,{waitForAbort:true}),abort=new AbortController(),pending=h.call(abort.signal);setTimeout(()=>abort.abort(),15)
 const result=await pending;assert.equal(result.isError,true);assert.deepEqual(h.count(),{runs:1,reports:0})
})
test('report delivery failure preserves the completed run instead of repeating or discarding it',async t=>{
 const h=await host(t,{reportError:true}),result=await h.call()
 assert.equal(result.isError,false);assert.equal(result.value.deliveryState,'REPORT_UNAVAILABLE');assert.deepEqual(result.value.run,outcome);assert.equal(result.value.report,null);assert.equal(result.value.reportError.code,'REPORT_CONTROL_FAILURE');assert.deepEqual(h.count(),{runs:1,reports:1})
})
test('nested terminal context is forwarded through DSH and does not trigger another child operation',async t=>{
 const context=createUserMessage({source:{kind:'plugin',plugin:'offline-fixture'},content:[{type:'text',text:'A fixed context control, not authority.'}]})
 const h=await host(t,{context,conclude:true}),result=await h.call()
 assert.equal(result.isError,false);assert.equal(result.concludesTurn,true);assert.deepEqual(result.additionalContexts,[context]);assert.equal(result.value.deliveryState,'TERMINAL_CHILD');assert.deepEqual(h.count(),{runs:1,reports:0})
})
