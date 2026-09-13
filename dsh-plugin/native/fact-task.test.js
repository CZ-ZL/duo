import test from 'node:test'
import assert from 'node:assert/strict'
import {judgeFactAnswer,buildFactTask,measureFactBatch} from '../../examples/native/fact-task.js'
import {digest} from './store.js'

const expected={kind:'text',answer:'2024-06-30',unit:null,abstain:false,support:[{source:'release',line:2}],allowedSources:['release','draft']}
const answer={answer:'2024-06-30',unit:null,abstain:false,citations:['release'],evidence:[{source:'release',line:2}]}
test('same-shaped controls distinguish wrong facts and allowed but unsupported citations',()=>{
 const good=judgeFactAnswer(expected,answer)
 const wrongYear=judgeFactAnswer(expected,{...answer,answer:'2023-06-30'})
 const wrongSource=judgeFactAnswer(expected,{...answer,citations:['draft'],evidence:[{source:'draft',line:2}]})
 assert.equal(good?.correct,true);assert.equal(good.supported,true)
 assert.equal(wrongYear.formatValid,true);assert.equal(wrongYear.correct,false);assert.equal(wrongYear.supported,false)
 assert.equal(wrongSource.formatValid,true);assert.equal(wrongSource.correct,true);assert.equal(wrongSource.supported,false)
 assert.ok(wrongSource.reasons.includes('UNSUPPORTED_EVIDENCE'))
})
test('normalization accepts equivalent units but not wrong magnitudes or missing conflict evidence',()=>{
 const quantity={...expected,kind:'quantity',answer:1250,unit:'kg'}
 assert.equal(judgeFactAnswer(quantity,{...answer,answer:'1.25',unit:'t'})?.supported,true)
 for(const [value,unit] of [['1.25 t','t'],['1250kg','kg'],['1250000 g','g']])
  assert.equal(judgeFactAnswer(quantity,{...answer,answer:value,unit}).supported,true)
 for(const [value,unit] of [['1.25 kg','t'],['1250 kg t','kg'],['1250kg','g'],['12.5t','t']])
  assert.equal(judgeFactAnswer(quantity,{...answer,answer:value,unit}).correct,false)
 assert.equal(judgeFactAnswer(quantity,{...answer,answer:'1.25',unit:'kg'}).correct,false)
 const conflict={...expected,kind:'abstention',answer:'INSUFFICIENT_EVIDENCE',abstain:true,support:[...expected.support,{source:'draft',line:2}]}
 const abstention={...answer,answer:'INSUFFICIENT_EVIDENCE',abstain:true,citations:['release','draft'],evidence:conflict.support}
 assert.equal(judgeFactAnswer(conflict,abstention).supported,true)
 assert.equal(judgeFactAnswer(conflict,{...abstention,evidence:expected.support,citations:['release']}).supported,false)
 assert.equal(judgeFactAnswer(expected,abstention).correct,false)
})
test('malformed output and unbounded or invented values do not pass validity',()=>{
 for(const bad of [null,[],{...answer,answer:''},{...answer,evidence:[{source:'release',line:-1}]},{...answer,citations:'release'}])
  assert.equal(judgeFactAnswer(expected,bad)?.formatValid,false)
})

test('synthetic task binds native receipt identity and keeps answer keys outside execution inputs',()=>{
 const {dataset,answerKey,manifest}=buildFactTask()
 assert.equal(answerKey.datasetDigest,digest(dataset))
 assert.equal(manifest.answerKeyDigest,digest(answerKey))
 assert.deepEqual(['fast','slow','final'].map(t=>dataset[t].tasks.length),[5,10,10])
 const groups=Object.values(manifest.groups).flat();assert.equal(new Set(groups).size,groups.length)
 const sources=new Set()
 for(const tier of ['fast','slow','final'])for(const task of dataset[tier].tasks){
  assert.equal(task.expected,undefined)
  const key=answerKey.splits[tier][task.id]
  const supplied=[...task.input.matchAll(/^SOURCE: (.+?) \(lines /gm)].map(m=>m[1])
  for(const source of supplied){assert.ok(!sources.has(source));sources.add(source)}
  assert.deepEqual(supplied,key.allowedSources)
  for(const e of key.support)assert.ok(supplied.includes(e.source))
 }
 // Independent concrete source/key checks, not scores manufactured by a fixture.
 const unit=dataset.fast.tasks[1],date=dataset.fast.tasks[2]
 assert.match(unit.input,/Accepted shipment mass = 1.5 t/)
 assert.equal(answerKey.splits.fast[unit.id].answer,1500)
 assert.match(date.input,/became effective 2022-06-30/)
 assert.equal(answerKey.splits.fast[date.id].answer,'2022-06-30')
})

test('batch measurement retains planned denominator for bad or missing answers and refuses crossed receipts',()=>{
 const {dataset,answerKey}=buildFactTask(),candidate={id:'baseline',version:'unchanged'}
 const answers=Object.fromEntries(Object.entries(answerKey.splits.fast).map(([id,k])=>[id,{answer:String(k.answer),unit:k.unit,abstain:k.abstain,citations:[...new Set(k.support.map(e=>e.source))],evidence:k.support}]))
 const artifact={candidateId:candidate.id,candidateVersion:candidate.version,tier:'fast',dataId:dataset.fast.id,datasetDigest:answerKey.datasetDigest,status:'completed',text:JSON.stringify(answers)}
 const measure=a=>measureFactBatch(dataset,answerKey,{candidate,artifact:a,tier:'fast'})
 assert.deepEqual(measure(artifact).metrics,{supported_accuracy:1,fact_accuracy:1,format_valid:true,sample_size:5})
 delete answers[dataset.fast.tasks[0].id]
 const missing=measure({...artifact,text:JSON.stringify(answers)})
 assert.equal(missing.ok,true);assert.equal(missing.metrics.supported_accuracy,.8);assert.equal(missing.metrics.sample_size,5);assert.equal(missing.metrics.format_valid,false)
 const malformed=measure({...artifact,text:'not json'})
 assert.equal(malformed.metrics.supported_accuracy,0);assert.equal(malformed.metrics.sample_size,5)
 assert.equal(measure({...artifact,candidateVersion:'other'}).ok,false)
 assert.equal(measure({...artifact,tier:'final'}).ok,false)
 const tampered=structuredClone(answerKey);tampered.datasetDigest='other'
 assert.throws(()=>measureFactBatch(dataset,tampered,{candidate,artifact,tier:'fast'}),/mismatch/)
})
