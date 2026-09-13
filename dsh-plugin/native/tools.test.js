import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import Tools from '@deepseek-ai/dsh-tools'
import Agents from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import {ControllerService,BudgetService,fail} from './definitions.js'
import * as DuoTools from './tools.js'

async function host(t,plan){
 const ctx=new Context(),fibers=[];let executions=0
 class Controller extends ControllerService {
  plan(){return plan??{planDigest:'current',runId:'current',spec:{mode:'optimize'},providers:{}}}
  run({planDigest}){if(planDigest!=='current')fail('DUO_PLAN_CHANGED','Inspect current plan');executions++;return {status:'completed'}}
 }
 class Budget extends BudgetService {}
 for(const P of [Agents,SystemPrompt,Tools,Controller,Budget,DuoTools])fibers.push(await ctx.plugin(P))
 t.after(async()=>{for(const f of fibers.reverse())await f.dispose()})
 const call=(args,signal=new AbortController().signal)=>ctx.tools.execute({name:'dualloop_run',callId:'case',arguments:args,signal})
 return {ctx,call,executions:()=>executions,toolFiber:fibers.at(-1)}
}
function details(result){
 assert.equal(result.isError,true)
 const body=JSON.parse(result.content[0].text)
 assert.equal(body.apiVersion,2);assert.equal(body.error.code,result.error.info?.code??'DUO_TOOL_FAILED')
 for(const key of ['component','recoveryCondition','nextAction'])assert.ok(body.error[key]?.length,key)
 assert.equal(typeof body.error.retryable,'boolean')
 return body.error
}
test('DUO argument and stale-plan errors carry actionable JSON through actual ToolRuntime',async t=>{
 const h=await host(t)
 for(const [args,code] of [[{},'INVALID_ARGS'],[{planDigest:123},'INVALID_ARGS'],[{planDigest:'old'},'DUO_PLAN_CHANGED']]){
  const r=await h.call(args),e=details(r);assert.equal(e.code,code);assert.equal(e.retryable,true)
 }
 assert.equal(h.executions(),0)
 const good=await h.call({planDigest:'current'});assert.equal(good.isError,false);assert.deepEqual(good.value,{status:'completed'})
 assert.deepEqual(JSON.parse(good.content[0].text),good.value)
})
test('DUO finalizer preserves guard denial and cancellation without executing or inviting bypass',async t=>{
 const h=await host(t),remove=h.ctx.tools.guard(()=> 'Not authorized')
 const denied=await h.call({planDigest:'current'}),d=details(denied)
 assert.equal(d.retryable,false);assert.match(d.nextAction,/authoriz|permission/i)
 remove()
 const abort=new AbortController();abort.abort()
 const cancelled=details(await h.call({planDigest:'current'},abort.signal))
 assert.equal(cancelled.retryable,false);assert.match(cancelled.nextAction,/inspect|reconcil/i)
 assert.equal(h.executions(),0)
})
test('DUO error finalization is definition-scoped and disposed with its tools',async t=>{
 const h=await host(t)
 await h.toolFiber.dispose()
 assert.ok(!h.ctx.tools.schemas().some(s=>s.name==='dualloop_run'))
 const missing=await h.call({planDigest:'current'});assert.equal(missing.isError,true)
 assert.equal(missing.error.info.code,'UNKNOWN_TOOL')
 assert.ok(!missing.content[0].text.includes('recoveryCondition'))
})

test('compact public plan rendering preserves authoritative decisions and full structured evidence',async t=>{
 const plan={apiVersion:2,runtime:'dsh-native',planDigest:'current',runId:'current',contractPath:'/allowed/experiment.json',contractDigest:'contract-id',
  spec:{operation:'evaluate',mode:'evaluation_only',target:{kind:'dsh-persona',path:'/allowed/persona.txt'},fast:{evaluatorId:'eval',version:'2',dataId:'development'},permissions:{paid:true,network:true,externalSideEffects:false},budget:{currency:'CNY',maxCostCny:.1}},
  baseline:{id:'baseline',version:'original-version',persona:'Original persona'},providers:{generator:null,executor:{id:'exec',version:'1',configDigest:'exec-cfg',currency:'CNY',reservationCny:.1,permissions:{paid:true,network:true,externalSideEffects:false},provider:'authorized-route',model:'chosen-model',maxRequests:1,maxInputBytes:32768,pricing:{id:'tariff',sourceReceipt:{raw:'repeated receipt context'.repeat(200)}}},evaluators:[{id:'eval',version:'2',configDigest:'eval-cfg',tier:'fast',dataId:'development',dataDigest:'data-hash',implementationDigest:'code-hash',currency:'CNY',reservationCny:0,permissions:{paid:false,network:false,externalSideEffects:false},evidenceKind:'programmatic_measurement',qualification:'CALLER_DECLARED_NOT_VERIFIED_BY_DUO',metricDefinitions:{quality:{meaning:'already supplied semantics '.repeat(100)}}}],policies:{duoGate:{id:'strict',version:'1'}}},
  recovery:{deadlinePolicy:'original_wall_deadline_includes_pause'},warmStart:{mode:'warm_start',contextDigest:'history-id',sources:[{runId:'old',reasons:['version_changed'],selected:1}],context:{records:[{hypothesis:'Long historical variant'.repeat(200)}]},finalDataReview:{independence:'NOT_ESTABLISHED'}}}
 const before=structuredClone(plan),h=await host(t,plan)
 const call=args=>h.ctx.tools.execute({name:'dualloop_plan',arguments:args,callId:'compact-plan',signal:new AbortController().signal})
 const full=await call({}),compact=await call({view:'summary'})
 assert.equal(compact.isError,false);const rendered=JSON.parse(compact.content[0].text)
 assert.equal(rendered.view,'summary');assert.equal(rendered.planDigest,plan.planDigest);assert.equal(rendered.runId,plan.runId)
 assert.deepEqual(rendered.spec,plan.spec);assert.deepEqual(rendered.baseline,plan.baseline);assert.deepEqual(rendered.recovery,plan.recovery)
 assert.equal(rendered.providers.executor.reservationCny,.1);assert.deepEqual(rendered.providers.executor.permissions,plan.providers.executor.permissions)
 assert.equal(rendered.providers.executor.model,'chosen-model');assert.equal(rendered.providers.evaluators[0].dataDigest,'data-hash');assert.equal(rendered.providers.evaluators[0].implementationDigest,'code-hash')
 assert.deepEqual(rendered.providers.policies,plan.providers.policies);assert.deepEqual(rendered.warmStart.sources,plan.warmStart.sources)
 assert.equal(rendered.warmStart.context,undefined);assert.equal(rendered.warmStart.contextDigest,'history-id');assert.equal(rendered.warmStart.finalDataReview.independence,'NOT_ESTABLISHED')
 assert.deepEqual(compact.value,full.value);assert.deepEqual(plan,before);assert.equal(h.executions(),0)
 assert.match(rendered.fullPlan,/dualloop_plan/);assert.ok(compact.content[0].text.length<full.content[0].text.length)
 assert.equal((await call({view:'unknown'})).isError,true)
 const run=await h.call({planDigest:rendered.planDigest});assert.equal(run.isError,false);assert.equal(h.executions(),1)
})
