// Payload controls reuse retained program receipts; no model execution or gain.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import MethodFeedback from '../examples/native/method-feedback.js'
import {compileProposal} from '../dsh-plugin/native/structured-generator.js'
import {setup} from '../dsh-plugin/native/test-fixtures.js'

test('property feedback keeps every candidate and task count while bounding test detail in the actual proposal',async t=>{
 const h=await setup(t),file=join(h.root,'data.json')
 const source=JSON.parse(readFileSync(new URL('../runs/c1-deterministic-slow-20260913/pack/dataset.json',import.meta.url)))
 const dataset={...source,fast:{id:'property-b1-payload-control',tasks:[...source.fast.tasks,...source.slow.tasks]}}
 delete dataset.slow;writeFileSync(file,JSON.stringify(dataset))
 const qualification=JSON.parse(readFileSync(new URL('../runs/c1-deterministic-slow-20260913/qualification/qualification.json',import.meta.url)))
 const measured=qualification.groups.find(g=>g.id==='known-bad').new.rows
 const entries=Array.from({length:7},(_,i)=>({candidateId:i?'control-'+i:'baseline',candidateVersion:'v'+i,generation:i?Math.ceil(i/3):0,
  family:'payload-control',mode:'exploit',delta:{kind:'cordis-overlay',target:'system-prompt',persona:'Preserved original persona with a bounded instruction.'},
  fast:{candidateId:i?'control-'+i:'baseline',evaluatorId:'code-unittest-fast',version:'25-properties-v1',dataId:dataset.fast.id,tier:'fast',ok:true,
   metrics:{task_pass_rate:0,sample_size:2},evidence:[{kind:'executed_python_unittest',tier:'fast',rows:structuredClone(measured)}]}}))
 await h.fibers[4].dispose();const fiber=await h.ctx.plugin(MethodFeedback,{method:'B1',contextMode:'history',datasetPath:file,maxTestDetails:2});t.after(()=>fiber.dispose())
 const quotas={exploit:1,explore:1,innovate:1},feedback=h.ctx.duoFeedback.summarize(entries,quotas,{fastMetrics:['task_pass_rate']})
 const proposal=compileProposal({champion:{id:'baseline',version:'v0',persona:'Original Python persona.'},feedback,quotas,generation:3,dataset})
 const bytes=Buffer.byteLength(JSON.stringify(proposal))
 if(process.env.DUO_PROPERTY_PAYLOAD_EVIDENCE)writeFileSync(process.env.DUO_PROPERTY_PAYLOAD_EVIDENCE,JSON.stringify({bytes,cap:65536,candidates:proposal.feedback.history.length,modelRequests:0,meaning:'Retained program results in synthetic generation3 history; payload functionality only'},null,2)+'\n')
 assert.ok(bytes<65536,`Actual compiled proposal ${bytes}bytes exceeds65536`)
 assert.equal(proposal.feedback.history.length,7)
 assert.equal(proposal.feedback.developmentMeasurements.length,7)
 for(const row of proposal.feedback.developmentMeasurements){
  assert.equal(row.rowAvailability,'PROVIDED_BOUNDED_FAILED_TEST_DETAILS')
  assert.equal(row.rows.length,2)
  for(const [index,value]of row.rows.entries()){
   assert.equal(value.planned,measured[index].planned);assert.equal(value.passed,measured[index].passed)
   assert.ok(value.tests.length<=2);assert.ok(value.tests.every(x=>x.status!=='passed'&&(!x.error||x.error.length<=160)))
  }
 }
 assert.doesNotMatch(JSON.stringify(proposal),/receiptPath|canonical_solution|testSha256|codeSha256/)
})
