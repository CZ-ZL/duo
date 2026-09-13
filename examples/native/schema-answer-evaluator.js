// Existing external Schema validation, applied to generated task answers.
// This caller-owned resource does NOT register duoEvaluators. A Caller attaches
// the supplied bridge through the native Cordis tools after inspecting it.
import Schema from '@deepseek-ai/schemastery'
import schemaPackage from '@deepseek-ai/schemastery/package.json' with {type:'json'}
import {readDataset} from '@dual-loop/dsh-plugin/model-accounting'
import {createHash,randomUUID} from 'node:crypto'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
const canonical=v=>v&&typeof v==='object'?Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v
const sha=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(canonical(v))).digest('hex')
const schema=Schema.object({answer:Schema.string().required(),citations:Schema.array(Schema.string()).required()})
export const bridgeCode="return {name:'caller-answer-schema-adapter',inject:['answerSchemaMeasurement'],apply(ctx){ctx.provide('duoEvaluators',{describe:()=>ctx.answerSchemaMeasurement.describe(),evaluate:args=>ctx.answerSchemaMeasurement.evaluate(args)})}}"
export function createSchemaMeasurement(config){
 if(!['fixture','model'].includes(config.evidenceKind))throw new Error('Explicit fixture or model evidence kind required')
 const dataset=readDataset(config.datasetPath),datasetDigest=sha(dataset),root=resolve(config.artifactRoot),implementationDigest=sha(readFileSync(new URL(import.meta.url),'utf8')+schemaPackage.version)
 const configDigest=sha({datasetDigest,implementationDigest,root,evidenceKind:config.evidenceKind})
 const descriptors=['fast','slow','final'].map(tier=>({id:'answer-schema-'+tier,version:'1',tier,dataId:dataset[tier].id,datasetDigest,configDigest,implementationDigest,
  metrics:['quality','grounded','format_valid','sample_size'],metricDefinitions:{quality:{meaning:'Fraction of task answers with required task ID, nonempty answer and nonempty source citations drawn from that supplied task',direction:'maximize',unit:'fraction'},grounded:{meaning:'All supplied answer objects cite only paths present in their task; not factual truth',direction:'constraint',unit:'boolean'},format_valid:{meaning:'Fraction of task outputs passing required answer/citation types',direction:'maximize',unit:'fraction'},sample_size:{meaning:'Fixed planned task count',direction:'minimum',unit:'tasks'}},
  currency:'CNY',reservationCny:0,permissions:{paid:false,network:false,externalSideEffects:false},maxRequests:0,
  dependencies:[{name:schemaPackage.name,version:schemaPackage.version,license:schemaPackage.license,available:true}],
  evidenceKind:config.evidenceKind,evidenceFamily:'external_output_schema_check',independentData:false,qualification:'OUTPUT_PROTOCOL_ONLY',
  fidelityRationale:'Same deterministic output check on disjoint task inputs. Slow adds task coverage, not established greater semantic reliability. Existing final tasks are not claimed unseen.'}))
 // Keep the callable service facade configurable: DSH's dynamic service proxy
 // wraps methods, which is incompatible with frozen own function properties.
 // Dataset/config identity remains in this private closure and returns copies.
 return {describe:()=>structuredClone(descriptors),async evaluate({candidate,artifact,tier,signal}){
  const d=descriptors.find(d=>d.tier===tier);if(!d)throw new Error('Unknown measurement tier')
  const identity={candidateId:candidate?.id,evaluatorId:d.id,version:d.version,dataId:d.dataId,tier}
  if(signal?.aborted||artifact?.status!=='completed'||artifact.candidateId!==candidate?.id||artifact.candidateVersion!==candidate?.version||artifact.tier!==tier||artifact.dataId!==d.dataId||artifact.datasetDigest!==datasetDigest)return {...identity,ok:false,metrics:{},currency:'CNY',costCny:0,evidence:[]}
  let answers;try{answers=JSON.parse(artifact.text)}catch{}
  const tasks=dataset[tier].tasks,exactKeys=answers&&typeof answers==='object'&&!Array.isArray(answers)&&Object.keys(answers).sort().join(',')===tasks.map(t=>t.id).sort().join(','),rows=[]
  for(const task of tasks){
   const answer=exactKeys?answers[task.id]:null,validated=await schema['~standard'].validate(answer),format=!!validated&&!validated.issues
   const allowed=[...task.input.matchAll(/^SOURCE: (.+?) \(lines /gm)].map(m=>m[1])
   const grounded=!!format&&answer.citations.length>0&&answer.citations.every(ref=>allowed.includes(ref))
   rows.push({taskId:task.id,format:!!format,grounded,passed:!!format&&grounded&&!!answer.answer.trim()})
  }
  const judgmentPath=join(root,'answer-schema-'+randomUUID()+'.json')
  const result={...identity,ok:true,metrics:{quality:rows.filter(r=>r.passed).length/tasks.length,grounded:rows.every(r=>r.grounded),format_valid:rows.filter(r=>r.format).length/tasks.length,sample_size:tasks.length},currency:'CNY',costCny:0,
   evidence:[{kind:config.evidenceKind==='model'?'actual_model_output_schema_measurement':'fixture_output_schema_measurement',qualification:'OUTPUT_PROTOCOL_ONLY',dependency:schemaPackage.name,dependencyVersion:schemaPackage.version,independentData:false,judgmentPath,sourceSessionReceipt:artifact.receiptPath??null,datasetDigest,implementationDigest,limitation:'Structure and supplied source membership only; semantic correctness and unseen final data are not qualified.'}]}
  mkdirSync(root,{recursive:true});writeFileSync(judgmentPath,JSON.stringify({...result,rows},null,2)+'\n',{flag:'wx'});return result
 }}
}
export const name='caller-owned-answer-schema-resource'
export const inject=['cordisInspect']
export function apply(ctx,config){
 const measurement=createSchemaMeasurement(config)
 ctx.provide('answerSchemaMeasurement',measurement)
 ctx.effect(()=>ctx.cordisInspect.register({manifest:{id:'AnswerSchemaMeasurement',description:'Authorized existing external output-schema measurement resource; no DUO binding until Caller activates the supplied bridge.',methods:[{name:'describe',description:'Read its service contract, measurement limits and approved bridge source; no evaluation.',inputSchema:{type:'object',additionalProperties:false},outputSchema:{type:'object',additionalProperties:true}}]},query:()=>({service:'answerSchemaMeasurement',methods:{describe:'() => EvaluatorDescriptor[]',evaluate:'({candidate,artifact,tier,signal?}) => Promise<EvalResult>'},descriptors:measurement.describe(),bridgeCode,authorityGranted:false})}))
}
