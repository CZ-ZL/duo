// Synthetic task construction and deterministic measurement. No provider calls.
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {digest as hash} from '@dual-loop/dsh-plugin/contract'
const strings=value=>Array.isArray(value)&&value.length>0&&value.every(x=>typeof x==='string'&&x.length>0)
const sameSet=(a,b)=>new Set(a).size===new Set(b).size&&a.every(x=>b.includes(x))
const span=e=>e.source+':'+e.line
export const FACT_MEASUREMENT_VERSION='2'
export function judgeFactAnswer(expected,response){
 const formatValid=!!response&&!Array.isArray(response)&&typeof response.answer==='string'&&response.answer.trim().length>0&&response.answer.length<=2048&&
  typeof response.abstain==='boolean'&&(response.unit===null||typeof response.unit==='string')&&strings(response.citations)&&
  Array.isArray(response.evidence)&&response.evidence.length>0&&response.evidence.every(e=>e&&typeof e.source==='string'&&e.source&&Number.isSafeInteger(e.line)&&e.line>0)
 if(!formatValid)return {formatValid:false,correct:false,supported:false,reasons:['INVALID_ANSWER_SHAPE']}
 let correct=response.abstain===expected.abstain
 if(expected.kind==='quantity'){
  const factors={kg:1,t:1000,g:.001},match=/^(-?\d+(?:\.\d+)?)\s*(kg|t|g)?$/.exec(response.answer.trim())
  // The task permits a quantity with its unit. A repeated suffix must agree
  // with the separate unit field; conflicting magnitudes/units still fail.
  correct=correct&&!!match&&(!match[2]||match[2]===response.unit)&&Object.hasOwn(factors,response.unit)&&
   Number.isFinite(Number(match[1]))&&Math.abs(Number(match[1])*factors[response.unit]-expected.answer)<=1e-8
 }else correct=correct&&response.answer.trim()===expected.answer&&response.unit===expected.unit
 const support=expected.support.map(span),observed=response.evidence.map(span)
 const evidenceMatches=sameSet(observed,support)&&sameSet(response.citations,expected.support.map(e=>e.source))&&
  response.citations.every(s=>expected.allowedSources.includes(s))
 return {formatValid:true,correct,supported:correct&&evidenceMatches,
  reasons:[...correct?[]:['INCORRECT_FACT_OR_ABSTENTION'],...evidenceMatches?[]:['UNSUPPORTED_EVIDENCE']]}
}

const responseInstructions='Return ONLY one JSON object keyed by every task id. Each answer has answer (nonempty string), unit (string or null), abstain (boolean), citations (source id array), evidence (array of {source,line} with exact positive source line numbers). For evidence insufficient or unresolved conflict answer INSUFFICIENT_EVIDENCE with abstain=true and unit=null, citing the relevant material. Other answers use abstain=false. Dates use YYYY-MM-DD; quantities state their unit; nonquantity unit is null. Sources are synthetic. Do not invent absent facts.'
function makeTask(group,index,kind){
 const entity=['Aster','Birch','Cobalt','Dahlia','Elm'][index%5]+'-'+group
 const source=(tag,lines)=>({id:group+'/'+tag,lines})
 const year=2020+index,amount=1250+index*250
 let docs,question,expected
 if(kind==='version'){
  docs=[source('approved',['Entity '+entity,'Approved statement published '+year+'-06-01: active sites = '+(17+index)]),
   source('older',['Entity '+entity,'Approved statement published '+(year-1)+'-06-01: active sites = '+(13+index)]),
   source('draft',['Entity '+entity,'Unapproved draft published '+year+'-08-01: active sites = '+(20+index)])]
  question='For '+entity+', as of '+year+'-07-01, how many active sites does the most recent approved statement report? Ignore unpublished or unapproved proposals.'
  expected={kind:'text',answer:String(17+index),unit:null,abstain:false,support:[{source:docs[0].id,line:2}]}
 }else if(kind==='unit'){
  docs=[source('shipment',['Entity '+entity,'Accepted shipment mass = '+(amount/1000)+' t. Rejected material is not included.']),source('plan',['Entity '+entity,'Planned shipment mass = '+(amount+500)+' kg; this is not the acceptance record.'])]
  question='What accepted shipment mass is documented for '+entity+'? Give the quantity in kg, t, or g with the correct unit.'
  expected={kind:'quantity',answer:amount,unit:'kg',abstain:false,support:[{source:docs[0].id,line:2}]}
 }else if(kind==='date'){
  docs=[source('minutes',['Entity '+entity,'Operating permit became effective '+year+'-06-30.','Signing ceremony occurred '+year+'-05-12.']),source('calendar',['Entity '+entity,'Tentative operational launch '+year+'-07-09; do not treat as the permit effective date.'])]
  question='On what date did the operating permit for '+entity+' become effective?'
  expected={kind:'text',answer:year+'-06-30',unit:null,abstain:false,support:[{source:docs[0].id,line:2}]}
 }else if(kind==='conflict'){
  docs=[source('record-a',['Entity '+entity,'Signed record '+year+'-09-01 reports active staff = '+(30+index)+'.']),source('record-b',['Entity '+entity,'Signed record '+year+'-09-01 reports active staff = '+(32+index)+'.'])]
  question='How many active staff did '+entity+' have on '+year+'-09-01? The two records have equal authority; neither supersedes the other. Abstain if a unique answer is unsupported.'
  expected={kind:'abstention',answer:'INSUFFICIENT_EVIDENCE',unit:null,abstain:true,support:docs.map(d=>({source:d.id,line:2}))}
 }else{
  docs=[source('inventory',['Entity '+entity,'Inventory report: warehouse count = '+(4+index)+'. No financial amount is stated.'])]
  question='What is the documented annual revenue of '+entity+'? Use only the supplied inventory report.'
  expected={kind:'abstention',answer:'INSUFFICIENT_EVIDENCE',unit:null,abstain:true,support:[{source:docs[0].id,line:2}]}
 }
 expected.allowedSources=docs.map(d=>d.id)
 return {task:{id:group+'-'+kind,input:'QUESTION: '+question+'\n\n'+docs.map(d=>'SOURCE: '+d.id+' (lines 1-'+d.lines.length+')\n'+d.lines.map((line,i)=>(i+1)+': '+line).join('\n')).join('\n\n')},key:expected,group,docs}
}
export function buildFactTask(){
 const dataset={version:1,responseInstructions},answerKey={version:'fact-support-v1',splits:{}},groups={},kindNames=['version','unit','date','conflict','missing']
 for(const [tier,count,offset] of [['fast',5,0],['slow',10,10],['final',10,30]]){
  const rows=Array.from({length:count},(_,i)=>makeTask(tier+'-group-'+i,offset+i,kindNames[i%kindNames.length]))
  dataset[tier]={id:'synthetic-facts-v1-'+tier,tasks:rows.map(r=>r.task)}
  answerKey.splits[tier]=Object.fromEntries(rows.map(r=>[r.task.id,r.key]));groups[tier]=rows.map(r=>r.group)
 }
 answerKey.datasetDigest=hash(dataset)
 return {dataset,answerKey,manifest:{version:1,id:'synthetic-facts-v1',evidenceKind:'SYNTHETIC_TASK_NOT_BUSINESS_VALIDATION',groups,
  datasetDigest:answerKey.datasetDigest,answerKeyDigest:hash(answerKey),primaryMetric:'supported_accuracy',
  scoring:'Each planned task contributes one binary supported-correct result. Wrong, missing or malformed answers contribute zero. Fact accuracy and format validity are separate; no fitted aggregate weights.',
  development:'Fast:5 cases, one per error class. Slow:10 other document groups, two per class; broader coverage, same deterministic measurement, no judge model.',
  final:'10 held-out document groups; keys and feedback excluded from search. No independence claim before a frozen real run and leakage audit.',
  limitations:['All source facts are invented and programmatically keyed.','Task construction rules and error classes are shared across splits; this tests within-family transfer, not novel business domains.','Task suitability and baseline headroom require real development outputs.']}}
}
export function measureFactBatch(dataset,answerKey,{candidate,artifact,tier}){
 const tasks=dataset[tier]?.tasks,keys=answerKey.splits[tier]
 if(!tasks||!keys||answerKey.datasetDigest!==hash(dataset))throw new Error('Frozen dataset/key mismatch')
 const identityValid=artifact?.status==='completed'&&artifact.candidateId===candidate?.id&&artifact.candidateVersion===candidate?.version&&artifact.tier===tier&&
  artifact.dataId===dataset[tier].id&&artifact.datasetDigest===answerKey.datasetDigest
 let answers=null
 if(identityValid)try{answers=JSON.parse(artifact.text)}catch{}
 const object=answers&&typeof answers==='object'&&!Array.isArray(answers),shape=!!object&&sameSet(Object.keys(answers),tasks.map(t=>t.id))
 const rows=tasks.map(task=>({taskId:task.id,...judgeFactAnswer(keys[task.id],object?answers[task.id]:null)}))
 return {ok:identityValid,metrics:{supported_accuracy:rows.filter(r=>r.supported).length/tasks.length,fact_accuracy:rows.filter(r=>r.correct).length/tasks.length,
  format_valid:shape&&rows.every(r=>r.formatValid),sample_size:tasks.length},currency:'CNY',costCny:0,
  evidence:[{kind:'deterministic_fact_support_measurement',taskKind:'synthetic',version:answerKey.version,measurementVersion:FACT_MEASUREMENT_VERSION,datasetDigest:answerKey.datasetDigest,answerKeyDigest:hash(answerKey),
   identityValid,outputShapeValid:shape,plannedTasks:tasks.length,rows}],costEvidence:{currency:'CNY',kind:'deterministic',complete:true,modelRequests:0}}
}
export function writeFactTask(directory){
 const result=buildFactTask();mkdirSync(directory,{recursive:true})
 for(const [name,data] of Object.entries(result))writeFileSync(resolve(directory,name+'.json'),JSON.stringify(data,null,2)+'\n',{flag:'wx'})
 return result.manifest
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==4||process.argv[2]!=='--output')throw new Error('Usage: node fact-task.js --output NEW_DIRECTORY')
 console.log(JSON.stringify(writeFactTask(process.argv[3]),null,2))
}
