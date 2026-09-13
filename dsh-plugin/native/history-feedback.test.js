import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {HistoryFeedback,ExclusionComparator} from './history-feedback.js'
const spec={weights:{quality:1},epsilon:.01,minSamples:2,constraints:[]}
const evaluation=(id,q,tier='fast')=>({candidateId:id,tier,evaluatorId:'eval',version:'1',dataId:tier,ok:true,metrics:{quality:q,sample_size:2},evidence:[{raw:'PRIVATE_DETAIL'}]})
async function service(t,P,config){const ctx=new Context(),f=await ctx.plugin(P,config);t.after(()=>f.dispose());return ctx}
test('history feedback retains every ranked candidate, hypothesis and delta without final or raw Slow evidence',async t=>{
 const ctx=await service(t,HistoryFeedback),entries=Array.from({length:15},(_,i)=>({candidateId:'c'+i,parentId:'baseline',parentVersion:'base',candidateVersion:String(i),generation:i+1,mode:'exploit',family:'family',hypothesis:'change '+i,delta:{kind:'cordis-overlay',persona:'p'+i},fast:evaluation('c'+i,i),fastScore:i,fastVerdict:'better',slow:evaluation('c'+i,1,'slow'),slowDecision:'rejected',final:{secret:'FINAL_SECRET'}}))
 const r=ctx.duoFeedback.summarize(entries,{exploit:2,explore:1,innovate:0})
 assert.equal(r.history.length,15);assert.equal(r.history[0].candidateId,'c14')
 assert.equal(r.history[14].delta.persona,'p0');assert.equal(r.history[0].parentId,'baseline')
 assert.doesNotMatch(JSON.stringify(r.history),/FINAL_SECRET|PRIVATE_DETAIL|evidence/)
 assert.equal(r.penalizedFamilies[0],'family');assert.equal(r.quotas.exploit,1)
 assert.equal(ctx.duoFeedback.describe().version,'4')
})
test('a single slow failure remains insufficient even with rich history',async t=>{
 const ctx=await service(t,HistoryFeedback),r=ctx.duoFeedback.summarize([{candidateId:'one',family:'once',mode:'exploit',fast:evaluation('one',1),slow:evaluation('one',0,'slow'),slowDecision:'rejected'}],{exploit:1,explore:1,innovate:1})
 assert.deepEqual(r.penalizedFamilies,[]);assert.equal(r.evidence,'insufficient_data')
})
const rule={candidateId:'bad',evaluatorId:'eval',version:'1',dataId:'fast',tier:'fast',reason:'Known contaminated source'}
test('frozen exclusions remove contaminated evidence without deleting or relabeling source measurements',async t=>{
 const ctx=await service(t,ExclusionComparator,{exclusions:[rule]}),results=[evaluation('base',1),evaluation('bad',100)],before=structuredClone(results)
 const r=ctx.duoComparator.compare(results,spec,'base')
 assert.equal(r.verdicts.bad,'incomparable');assert.deepEqual(r.ranking,['base'])
 assert.equal(r.exclusions.bad.reason,rule.reason);assert.deepEqual(results,before)
})
test('excluded incumbent cannot justify promotion and exclusion identity is scope-bound',async t=>{
 const ctx=await service(t,ExclusionComparator,{exclusions:[{...rule,candidateId:'base'}]})
 assert.equal(ctx.duoComparator.compare([evaluation('base',1),evaluation('next',2)],spec,'base').verdicts.next,'incomparable')
 assert.equal(ctx.duoComparator.compare([evaluation('base',1,'slow'),evaluation('next',2,'slow')],spec,'base').verdicts.next,'better')
})
test('excluded Slow observations do not become family failure evidence',async t=>{
 const rules=['a','b'].map(candidateId=>({...rule,candidateId,dataId:'slow',tier:'slow'}))
 const ctx=await service(t,HistoryFeedback,{exclusions:rules})
 const entries=['a','b'].map(candidateId=>({candidateId,mode:'exploit',family:'trap',fast:evaluation(candidateId,1),slow:evaluation(candidateId,0,'slow'),slowDecision:'rejected'}))
 const r=ctx.duoFeedback.summarize(entries,{exploit:2,explore:0,innovate:0})
 assert.deepEqual(r.penalizedFamilies,[]);assert.ok(r.history.every(h=>h.slow.excluded===true))
 assert.equal(r.slowFeedback.availability,'UNUSABLE');assert.ok(r.slowFeedback.observations.every(o=>o.status==='EXCLUDED'&&o.slow.ok===false))
})
test('invalid broad exclusions fail configuration and configuration changes alter provider identity',async t=>{
 const a=await service(t,ExclusionComparator,{exclusions:[]}),b=await service(t,ExclusionComparator,{exclusions:[rule]})
 assert.notDeepEqual(a.duoComparator.describe(),b.duoComparator.describe())
 const ctx=new Context();await assert.rejects(async()=>await ctx.plugin(ExclusionComparator,{exclusions:[{reason:'too broad'}]}))
})
