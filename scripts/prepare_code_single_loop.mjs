// Derive B1's full development pack; no model, final evaluation or authorization.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {singleLoopCodeData} from '../examples/native/method-feedback.js'

const [packPath,outputPath,...extra]=process.argv.slice(2)
if(!packPath||!outputPath||extra.length)throw new Error('Supply source benchmark pack and new output directory')
const source=resolve(packPath),out=resolve(outputPath),sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const original=JSON.parse(readFileSync(join(source,'manifest.json'),'utf8'))
for(const name of ['dataset.json','answer-key.json','control-task.json']){
 if(original.files?.[name]!==sha(readFileSync(join(source,name))))throw new Error('Source pack identity mismatch: '+name)
}
const derived=singleLoopCodeData(readFileSync(join(source,'dataset.json')),JSON.parse(readFileSync(join(source,'answer-key.json'),'utf8')))
mkdirSync(out,{recursive:false})
const save=(name,value)=>writeFileSync(join(out,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'})
writeFileSync(join(out,'dataset.json'),derived.datasetBytes,{flag:'wx'})
save('answer-key.json',derived.answerKey)
copyFileSync(join(source,'control-task.json'),join(out,'control-task.json'))
save('derivation.json',{...derived.derivation,sourcePack:source,
 sourceManifestSha256:sha(readFileSync(join(source,'manifest.json'))),
 limitation:'Input derivation only; same tests, no model measurement or optimization evidence'})
save('manifest.json',{...original,version:original.version+'-full-development',
 splits:Object.fromEntries(['fast','final'].map(t=>[t,derived.dataset[t].tasks.map(r=>r.id)])),
 derivation:derived.derivation,
 files:Object.fromEntries(['dataset.json','answer-key.json','control-task.json','derivation.json'].map(name=>[name,sha(readFileSync(join(out,name)))]))})
console.log(JSON.stringify({status:'DERIVED_NO_MODEL_CALLS',output:out,developmentTasks:derived.dataset.fast.tasks.length,
 finalTasks:derived.dataset.final.tasks.length,finalEvaluation:'NOT_RUN',evaluatorVersion:derived.answerKey.evaluatorVersion??'3',modelRequests:0,apiCostCny:0}))
