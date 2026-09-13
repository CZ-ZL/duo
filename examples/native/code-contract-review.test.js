import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import LlmRuntime,{LlmAdapter} from '@deepseek-ai/dsh-llm'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Sessions from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {digest} from '@dual-loop/dsh-plugin/contract'
import Reviewer from './code-contract-review.js'

const good={verdict:'pass',reason:'Returns the required sum.',contractQuote:'Return the sum of a and b.',codeQuote:'return a + b',counterexample:''}
async function host(t,{grade=good,missingUsage=false,invalidJson=false,duplicate=false,replay=null,reply=null}={}){
 const root=mkdtempSync(join(tmpdir(),'duo-code-review-')),ctx=new Context(),fibers=[],requests=[]
 const dataset={version:1,responseMode:'python-code-v1',...Object.fromEntries(['fast','slow','final'].map(tier=>[tier,{id:tier+'-code-review',tasks:[{id:tier+'-1',input:'# '+tier+' task\ndef task_func(a, b):\n    """Return the sum of a and b."""',expected:{secret:'PRIVATE_KEY_'+tier}}]}]))}
 if(replay)dataset.slow.tasks=replay.tasks.map(t=>({id:t.id,input:t.contract}))
 const datasetPath=join(root,'dataset.json');writeFileSync(datasetPath,JSON.stringify(dataset))
 const config={provider:'test',model:'independent-review-control',datasetPath,artifactRoot:join(root,'sessions'),judgmentRoot:join(root,'judgments'),policyPath:resolve('examples/native/code-contract-review-policy.json'),tiers:['slow'],maxTokens:2048,maxInputBytes:16384,timeoutMs:3000,currency:'CNY',reservationCny:.3,evidenceKind:'fixture',pricing:{id:'synthetic',currency:'CNY',inputCnyPerMillion:3,cacheReadCnyPerMillion:.1,outputCnyPerMillion:9}}
 t.after(async()=>{for(const f of fibers.reverse())await f.dispose()})
 for(const P of [AgentRegistry,Sessions,Projections,LlmRuntime,Tools])fibers.push(await ctx.plugin(P))
 fibers.push(await ctx.plugin(SystemPrompt,{includeHarnessIdentity:false,includeRuntimeContext:false}))
 class Adapter extends LlmAdapter{async *stream(options){
  requests.push(options)
  yield {type:'text-delta',index:0,text:reply??(invalidJson?'broken JSON':duplicate?'{"slow-1":'+JSON.stringify(grade)+',"slow-1":'+JSON.stringify(grade)+'}':JSON.stringify({'slow-1':grade}))}
  if(!missingUsage)yield {type:'usage',usage:{inputTokens:80,cacheReadTokens:20,outputTokens:10,totalTokens:110}}
  yield {type:'finish',reason:{kind:'stop'}}
 }}
 fibers.push(await ctx.plugin({name:'code-review-fixture',inject:['llm'],apply(c){c.llm.registerAdapter(['test'],new Adapter())}}))
 fibers.push(await ctx.plugin(AgentLoop,{agents:[]}));fibers.push(await ctx.plugin(Reviewer,config))
 const candidate={id:'candidate-private',version:'version-private',persona:'PRIVATE_PERSONA'}
 const artifact={candidateId:candidate.id,candidateVersion:candidate.version,tier:'slow',dataId:dataset.slow.id,datasetDigest:digest(dataset),status:'completed',receiptPath:join(root,'executor.json'),text:JSON.stringify({'slow-1':'def task_func(a, b):\n    return a + b'})}
 if(replay)artifact.text=JSON.stringify(Object.fromEntries(replay.tasks.map(t=>[t.id,t.code])))
 return {ctx,root,config,requests,dataset,candidate,artifact}
}
test('code contract reviewer uses actual Agent lifecycle and only selected public contract/code',async t=>{
 const h=await host(t),r=await h.ctx.duoEvaluators.evaluate({candidate:h.candidate,artifact:h.artifact,tier:'slow'})
 assert.equal(r.ok,true);assert.equal(r.metrics.contract_pass_rate,1);assert.equal(r.metrics.review_complete,true)
 assert.equal(r.costCny,.000332);assert.equal(r.costEvidence.attempts,1);assert.equal(h.requests.length,1)
 assert.equal(h.ctx.agents.list().length,0);assert.equal(h.requests[0].tools?.length??0,0)
 assert.doesNotMatch(JSON.stringify(h.requests[0]),/PRIVATE_|fast-1|final-1|candidate-private|version-private/)
 const saved=JSON.parse(readFileSync(r.evidence[0].judgmentPath));assert.equal(saved.rows[0].verdict,'pass');assert.equal(saved.sourceArtifactDigest,digest(h.artifact))
 const d=h.ctx.duoEvaluators.describe()[0];assert.equal(d.evidenceFamily,'model_public_contract_review');assert.equal(d.qualification,'NOT_QUALIFIED_BY_DUO');assert.equal(d.maxRequests,1)
})
test('retained real reply remains invalid and identifies every rejected contract quote',async t=>{
 const replay=JSON.parse(readFileSync('tests/fixtures/code-review-retained-response.json','utf8'))
 const h=await host(t,{replay,reply:replay.reply}),r=await h.ctx.duoEvaluators.evaluate({candidate:h.candidate,artifact:h.artifact,tier:'slow'})
 assert.equal(r.ok,false);assert.equal(r.metrics.sample_size,0);assert.equal(r.costCny,.000332)
 assert.deepEqual(r.error.details,replay.tasks.map(t=>({taskId:t.id,field:'contractQuote',code:'QUOTE_NOT_CONTIGUOUS',expected:'One verbatim contiguous excerpt; whitespace may be normalized.'})))
 const saved=JSON.parse(readFileSync(r.evidence[0].judgmentPath,'utf8'));assert.deepEqual(saved.error.details,r.error.details)
 assert.equal(h.requests.length,1);assert.equal(r.error.retryable,false)
})
test('changing only the three quotes in an offline counterfactual passes the same strict checks',async t=>{
 const replay=JSON.parse(readFileSync('tests/fixtures/code-review-retained-response.json','utf8')),grades=JSON.parse(replay.reply)
 for(const task of replay.tasks)grades[task.id].contractQuote=replay.validContractQuotes[task.id]
 const h=await host(t,{replay,reply:JSON.stringify(grades)}),r=await h.ctx.duoEvaluators.evaluate({candidate:h.candidate,artifact:h.artifact,tier:'slow'})
 assert.equal(r.ok,true);assert.equal(r.metrics.sample_size,3);assert.equal(r.metrics.contract_pass_rate,1)
 assert.equal(r.costEvidence.kind,'fixture');assert.equal(h.requests.length,1)
})
test('the actual outgoing v3 request asks for short contiguous quotes and separates explanation',async t=>{
 const h=await host(t);await h.ctx.duoEvaluators.evaluate({candidate:h.candidate,artifact:h.artifact,tier:'slow'})
 const body=JSON.parse(h.requests[0].messages.filter(m=>m.role==='user').at(-1).content[0].text)
 assert.match(body.instruction,/one short, contiguous verbatim excerpt/)
 assert.match(body.instruction,/Do not join fragments/);assert.match(body.instruction,/explanation only in reason/)
 assert.equal(h.ctx.duoEvaluators.describe()[0].version,'3');assert.equal(body.policy.id,'python-public-contract-review-v3')
})
test('actual reviewer request declares the exact field limits enforced on returned text',async t=>{
 const h=await host(t);await h.ctx.duoEvaluators.evaluate({candidate:h.candidate,artifact:h.artifact,tier:'slow'})
 const body=JSON.parse(h.requests[0].messages.filter(m=>m.role==='user').at(-1).content[0].text)
 assert.deepEqual(body.outputContract.fields,['verdict','reason','contractQuote','codeQuote','counterexample'])
 assert.deepEqual(body.outputContract.verdicts,['pass','fail','uncertain'])
 assert.deepEqual(body.outputContract.maxLength,{reason:600,contractQuote:600,codeQuote:600,counterexample:1000})
 assert.equal(body.outputContract.lengthUnit,'UTF-16 code units after JSON decoding')
 assert.match(body.outputContract.counterexample,/nonempty for fail.*empty for pass or uncertain/)
 assert.match(body.outputContract.quotes,/contiguous.*whitespace/)
})
test('retained v2 real reply still reports the overlong reason and paraphrased quote independently',async t=>{
 const replay=JSON.parse(readFileSync('tests/fixtures/code-review-retained-v2-response.json','utf8'))
 const variations=[
  {name:'original',change:()=>{},fields:['reason','contractQuote']},
  {name:'quote corrected only',change:g=>g.contractQuote='A list of tuples, each tuple representing a combination.',fields:['reason']},
  {name:'reason corrected only',change:g=>g.reason='Uses itertools.combinations on the decoded number_list.',fields:['contractQuote']},
 ]
 for(const v of variations){
  const grades=JSON.parse(replay.reply);v.change(grades['BigCodeBench/358'])
  const h=await host(t,{replay,reply:v.name==='original'?replay.reply:JSON.stringify(grades)})
  const r=await h.ctx.duoEvaluators.evaluate({candidate:h.candidate,artifact:h.artifact,tier:'slow'})
  assert.equal(r.ok,false,v.name);assert.equal(r.metrics.sample_size,0);assert.equal(r.costCny,.000332)
  assert.deepEqual(r.error.details.map(d=>[d.taskId,d.field]),v.fields.map(f=>['BigCodeBench/358',f]),v.name)
  assert.equal(r.error.retryable,false);assert.equal(h.requests.length,1)
 }
})
test('existing decoded-text limits accept their boundary and reject longer UTF16 strings',async t=>{
 for(const [reason,accepted] of [['x'.repeat(600),true],['x'.repeat(601),false],['😀'.repeat(300),true],['😀'.repeat(301),false],[' ',false]]){
  const h=await host(t,{grade:{...good,reason}}),r=await h.ctx.duoEvaluators.evaluate({candidate:h.candidate,artifact:h.artifact,tier:'slow'})
  assert.equal(r.ok,accepted);if(!accepted)assert.equal(r.error.details[0].field,'reason')
 }
 for(const [counterexample,accepted] of [['x'.repeat(1000),true],['x'.repeat(1001),false],[' ',false]]){
  const h=await host(t,{grade:{...good,verdict:'fail',counterexample}})
  const r=await h.ctx.duoEvaluators.evaluate({candidate:h.candidate,artifact:h.artifact,tier:'slow'})
  assert.equal(r.ok,accepted);if(!accepted)assert.equal(r.error.details[0].field,'counterexample')
 }
})
test('retained v3 wrong-code reply is rejected; filling missing empty fields does not fix its verdicts',async t=>{
 const replay=JSON.parse(readFileSync('tests/fixtures/code-review-retained-v3-wrong-response.json','utf8'))
 const h=await host(t,{replay,reply:replay.reply}),bad=await h.ctx.duoEvaluators.evaluate({candidate:h.candidate,artifact:h.artifact,tier:'slow'})
 assert.equal(bad.ok,false);assert.equal(bad.metrics.sample_size,0)
 assert.deepEqual(bad.error.details.map(d=>[d.taskId,d.code]),[['BigCodeBench/358','ROW_SCHEMA_MISMATCH'],['BigCodeBench/412','ROW_SCHEMA_MISMATCH']])
 const grades=JSON.parse(replay.reply)
 for(const id of ['BigCodeBench/358','BigCodeBench/412']){
  assert.equal(Object.hasOwn(grades[id],'counterexample'),false)
  grades[id].counterexample=''
 }
 const c=await host(t,{replay,reply:JSON.stringify(grades)}),fixed=await c.ctx.duoEvaluators.evaluate({candidate:c.candidate,artifact:c.artifact,tier:'slow'})
 assert.equal(fixed.ok,true);assert.equal(fixed.metrics.sample_size,3)
 assert.equal(fixed.metrics.contract_pass_rate,2/3);assert.equal(fixed.metrics.contract_fail_rate,1/3)
 assert.notEqual(fixed.metrics.contract_pass_rate,0,'Known-wrong control still fails its predeclared all-fail expectation')
 assert.equal(fixed.costEvidence.kind,'fixture');assert.equal(c.requests.length,1)
})
test('explicit wrong verdict remains separate from unknown semantic judgment',async t=>{
 for(const verdict of ['fail','uncertain']){
  const h=await host(t,{grade:{...good,verdict,reason:verdict==='fail'?'Always zero, contradicting requested sum.':'Cannot resolve this implementation.',codeQuote:'return 0',counterexample:verdict==='fail'?'a=1,b=2 should return3 but returns0':''}})
  const r=await h.ctx.duoEvaluators.evaluate({candidate:h.candidate,artifact:{...h.artifact,text:JSON.stringify({'slow-1':'def task_func(a,b): return 0'})},tier:'slow'})
  assert.equal(r.ok,verdict==='fail');assert.equal(r.metrics.contract_pass_rate,0);assert.equal(r.metrics.uncertain_rate,verdict==='uncertain'?1:0)
  assert.equal(r.metrics.review_complete,verdict==='fail');assert.equal(r.costCny,.000332)
  if(verdict==='uncertain')assert.equal(r.error.code,'DUO_REVIEW_UNCERTAIN')
 }
})
test('identity, task set, final tier and abort refuse before any judge request',async t=>{
 const h=await host(t)
 for(const change of [{candidateId:'foreign'},{candidateVersion:'foreign'},{tier:'fast'},{dataId:'foreign'},{datasetDigest:'foreign'},{status:'failed'},{text:'{}'}]){
  const r=await h.ctx.duoEvaluators.evaluate({candidate:h.candidate,artifact:{...h.artifact,...change},tier:'slow'})
  assert.equal(r.ok,false);assert.equal(r.costCny,0)
 }
 const missing=await h.ctx.duoEvaluators.evaluate({candidate:{},artifact:{...h.artifact,candidateId:undefined,candidateVersion:undefined},tier:'slow'})
 assert.equal(missing.ok,false);assert.equal(missing.costCny,0)
 const denied=await h.ctx.duoEvaluators.evaluate({candidate:h.candidate,artifact:h.artifact,tier:'final'});assert.equal(denied.ok,false)
 const signal=AbortSignal.abort();const aborted=await h.ctx.duoEvaluators.evaluate({candidate:h.candidate,artifact:h.artifact,tier:'slow',signal});assert.equal(aborted.error.code,'ABORTED')
 assert.equal(h.requests.length,0)
})
test('invalid quotes, malformed reply and missing usage preserve costs without retries',async t=>{
 for(const option of [{grade:{...good,contractQuote:'An invented requirement'}},{grade:{...good,codeQuote:'return 42'}},{invalidJson:true},{missingUsage:true},{duplicate:true}]){
  const h=await host(t,option),r=await h.ctx.duoEvaluators.evaluate({candidate:h.candidate,artifact:h.artifact,tier:'slow'})
  assert.equal(r.ok,false);assert.equal(h.requests.length,1);assert.equal(r.costCny,option.missingUsage?null:.000332);assert.equal(r.error.retryable,false)
 }
})
