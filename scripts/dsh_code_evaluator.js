// Caller-supplied evaluator: native protocol stays in Cordis, task execution in
// its declared, bounded Python namespace adapter. No model requests or retries.
import {readFileSync,mkdirSync} from 'node:fs'
import {createHash,randomUUID} from 'node:crypto'
import {execFile} from 'node:child_process'
import {join,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import FunctionEvaluators,{createControlEvaluation} from '@dual-loop/dsh-plugin/function-evaluators'
export const name='duo-code-unittest-evaluator'
const sha=b=>createHash('sha256').update(b).digest('hex')
export function apply(ctx,config){
 const datasetBytes=readFileSync(join(config.pack,'dataset.json')),dataset=JSON.parse(datasetBytes)
 const keyBytes=readFileSync(join(config.pack,'answer-key.json')),key=JSON.parse(keyBytes)
 if(key.datasetSha256!==sha(datasetBytes))throw new Error('Code dataset/key identity mismatch')
 const script=join(dirname(fileURLToPath(import.meta.url)),'code_evaluation.py')
 const sources=['dsh_code_evaluator.js','code_evaluation.py','code_worker.py'].map(f=>fileURLToPath(new URL(f,import.meta.url)))
 const boundFiles=[...sources,join(config.pack,'dataset.json'),join(config.pack,'answer-key.json')]
 const hashes=boundFiles.map(f=>sha(readFileSync(f)))
 mkdirSync(config.artifactRoot,{recursive:true})
 const evaluate=async({artifact,tier,signal,candidate})=>{
  if(signal?.aborted)return {ok:false,metrics:{},currency:'CNY',costCny:0,evidence:[{kind:'cancelled_before_local_execution'}]}
  if(boundFiles.some((f,i)=>sha(readFileSync(f))!==hashes[i])||artifact?.candidateId!==undefined&&artifact.candidateId!==candidate?.id)
   return {ok:false,metrics:{},currency:'CNY',costCny:0,evidence:[{kind:'frozen_input_identity_mismatch'}]}
  const output=join(config.artifactRoot,randomUUID())
  return new Promise(resolve=>{
   const child=execFile('/usr/bin/python3',['-I','-S',script,'--pack',config.pack,'--tier',tier,'--output',output],
    {env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},timeout:Math.min(180000,8000*dataset[tier].tasks.length),maxBuffer:2*1024*1024,signal},
    (error,stdout,stderr)=>{
     try{const value=JSON.parse(stdout);if(!error)return resolve(value)}catch{}
     resolve({ok:false,metrics:{},currency:'CNY',costCny:0,evidence:[{kind:'local_execution_failed',output,code:error?.code??null,stderr:String(stderr).slice(0,2000)}]})
    })
   child.stdin.on('error',()=>{})
   child.stdin.end(JSON.stringify(artifact))
  })
 }
 const controls=config.controlsPath?JSON.parse(readFileSync(config.controlsPath)):null
 const control=controls?createControlEvaluation({evaluate,controls,discriminationMetric:'task_pass_rate',reservationCnyPerCase:0}):null
 const metrics=control?['control_match_rate','controls_distinguish','sample_size']:['task_pass_rate','test_pass_rate','syntax_valid_rate','timeout_rate','format_valid','sample_size']
 const descriptors=Object.entries(dataset).filter(([tier])=>['fast','slow','final'].includes(tier)).map(([tier,split])=>({
  id:(control?'code-controls-':'code-unittest-')+tier,version:key.evaluatorVersion??'3',tier,dataId:split.id,metrics,currency:'CNY',reservationCny:0,
  permissions:{paid:false,network:false,externalSideEffects:false},evidenceKind:'programmatic_measurement',evidenceFamily:key.evaluatorVersion?key.version:'bigcodebench-original-unittest-v1',
  fidelityRationale:control?'Known-output discrimination only; no optimization-benefit evidence':key.measurementKind==='bounded-properties-v1'&&tier==='slow'?'Two development contracts with bounded index-subset, translation and Unicode NFC checks; incremental discrimination calibrated, not all-input proof':`${split.tasks.length} disjoint ${tier} tasks; custom stdlib unittest runner; not an official leaderboard score`,
  ...control?{}:{metricDefinitions:{task_pass_rate:{meaning:key.measurementKind==='bounded-properties-v1'||['7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24'].includes(key.evaluatorVersion)?'Fraction of planned tasks passing all registered tests in this version':'Fraction of planned tasks passing every original test'+(['4','5','6'].includes(key.evaluatorVersion)?' and applicable registered development assertions':''),direction:'maximize',unit:'fraction',purpose:tier==='final'?'final_confirmation':'ranking',construct:'task_result',lowerBound:0,upperBound:1},
   test_pass_rate:{meaning:'Mean within-task fraction of passing tests; diagnostic only, excluded from objective weights',direction:'maximize',unit:'fraction',construct:'task_result',lowerBound:0,upperBound:1}}}
 }))
 return ctx.plugin(FunctionEvaluators,{descriptors,dataDigest:sha(Buffer.concat([datasetBytes,keyBytes,Buffer.from(JSON.stringify(controls))])),
  implementationDigest:sha(Buffer.concat(sources.map(f=>readFileSync(f)))),
  evaluate:control?args=>control.evaluate(args):evaluate})
}
