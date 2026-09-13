import test from 'node:test'
import assert from 'node:assert/strict'
import {resolveNativeContract} from './contract.js'
import {setup} from './test-fixtures.js'
import {readFileSync,writeFileSync} from 'node:fs'
import FetchConfigTarget,{fetchPlugin} from './config-target.js'
import {decodeConfigProposal} from './config-generator.js'
import {TargetService} from './definitions.js'
import {digest} from './store.js'

test('public JSON contract accepts an explicitly configured plugin target',async t=>{
 const {contract,experiment}=await setup(t)
 const result=resolveNativeContract({...contract,target:{kind:'dsh-plugin-config',path:'fetch.json'}},experiment)
 assert.equal(result.spec.target.kind,'dsh-plugin-config')
})

test('real fetch adapter preserves the input file and rejects permission, parent and type changes',async t=>{
 const {ctx,target,fibers}=await setup(t)
 await fibers[1].dispose()
 const config={maxBodyChars:100000,maxResponseBytes:5000000,maxRedirects:5,timeoutMs:30000,userAgent:'deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)'}
 writeFileSync(target,JSON.stringify({persona:'Fixed persona.',plugin:fetchPlugin,config}))
 const before=readFileSync(target,'utf8'),fiber=await ctx.plugin(FetchConfigTarget),adapter=ctx.duoTarget,parent=adapter.snapshot(target)
 t.after(()=>fiber.dispose())
 const proposal={slots:[{slot:'exploit-1',mode:'exploit'}]}
 const [candidate]=decodeConfigProposal('{"candidates":[{"slot":"exploit-1","hypothesis":"Retain more source evidence","maxBodyChars":160000}]}',proposal,parent,()=> 'dl-0001')
 const applied=adapter.apply(candidate,parent)
 assert.equal(applied.config.maxBodyChars,160000);assert.equal(applied.persona,parent.persona);assert.notEqual(applied.version,parent.version)
 assert.equal(readFileSync(target,'utf8'),before)
 for(const value of [49999,200001,NaN,'150000',true])assert.throws(()=>adapter.apply({...candidate,delta:{...candidate.delta,config:{...config,maxBodyChars:value}}},parent))
 assert.throws(()=>adapter.apply({...candidate,parentVersion:'wrong'},parent))
 assert.throws(()=>adapter.apply({...candidate,delta:{...candidate.delta,config:{...config,timeoutMs:60000}}},parent))
 assert.throws(()=>decodeConfigProposal('{"candidates":[],"candidates":[]}',proposal,parent,()=> 'x'))
})

test('configuration changes are evaluated even with an unchanged persona; exact repeats are skipped',async t=>{
 const {ctx,fibers}=await setup(t,{generations:1,quotas:{exploit:1,explore:1,innovate:0},slow:undefined,final:undefined})
 await fibers[1].dispose()
 class ConfigFixture extends TargetService {
  describe(){return {id:'config-fixture',version:'1',deterministic:true}}
  snapshot(){return {id:'baseline',persona:'unchanged',config:{maxBodyChars:100000},version:digest({maxBodyChars:100000})}}
  apply(c,p){return {...c,persona:p.persona,config:{maxBodyChars:200000},version:digest({maxBodyChars:200000})}}
 }
 const fiber=await ctx.plugin(ConfigFixture);t.after(()=>fiber.dispose())
 const plan=ctx.duoController.plan(),result=await ctx.duoController.run({planDigest:plan.planDigest})
 assert.equal(result.status,'completed')
 const events=ctx.duoController.status(plan.runId).events
 assert.ok(events.some(e=>e.kind==='candidate'&&e.candidateId==='dl-0001'&&e.status==='fast_evaluated'))
 assert.ok(events.some(e=>e.kind==='candidate'&&e.candidateId==='dl-0002'&&e.status==='duplicate_skipped'&&e.duplicateOf==='dl-0001'))
})
