// Runnable local text-hygiene example. Measures the supplied text itself; it
// does not simulate model answers or establish Agent task-quality improvement.
import {GeneratorService,ExecutorService} from '@dual-loop/dsh-plugin/definitions'
import FunctionEvaluators from '@dual-loop/dsh-plugin/function-evaluators'
export const name='duo-local-text-example'
export const cost={currency:'CNY',costCny:0}
export const descriptor=id=>({id,version:'1',currency:'CNY',reservationCny:0,
 permissions:{paid:false,network:false,externalSideEffects:false},evidenceKind:'local_text_measurement'})
export function evaluateText({artifact}){
 const lines=artifact.text.split('\n'),clean=lines.filter(line=>!/\s+$/.test(line)).length
 return {ok:true,metrics:{quality:clean/lines.length,safe:artifact.text.trim().length>0,sample_size:lines.length},...cost,
  evidence:[{kind:'local_trailing_whitespace_check',lines:lines.length,cleanLines:clean,hostPid:process.pid}]}
}
export const descriptors=()=>['fast','slow','final'].map(tier=>({...descriptor('local-'+tier),tier,dataId:'local-text-'+tier,metrics:['quality','safe','sample_size'],
 configDigest:'local-text-v1',evidenceFamily:'text_hygiene',qualification:'LOCAL_FORMAT_MEASUREMENT_ONLY',independentData:false,
 fidelityRationale:'Repeated text checks do not establish higher fidelity or independent generalization.',
 metricDefinitions:{quality:{meaning:'Fraction of lines without trailing whitespace',direction:'maximize',unit:'fraction',purpose:'format',construct:'format',lowerBound:0,upperBound:1}}}))
export async function apply(ctx,config={}){
 class Generator extends GeneratorService {
  describe(){return {...descriptor('local-trim-generator'),configDigest:'trim-line-ends-v1'}}
  async propose({champion,quotas,nextId,feedback}){
   // Historical ideas reach this deterministic generator and are recorded;
   // it has one documented transformation, not a research search algorithm.
   const sources=(feedback.warmStart?.records??[]).map(r=>r.source.candidateId)
   return {...cost,candidates:Object.entries(quotas).flatMap(([mode,n])=>Array.from({length:n},()=>({id:nextId(),parentId:champion.id,parentVersion:champion.version,
    mode,family:'trim-line-ends',hypothesis:'Remove trailing whitespace while preserving text and placeholders.'+(sources.length?' Historical ideas received: '+sources.join(', ')+'.':''),
    delta:{kind:'cordis-overlay',target:'system-prompt',persona:champion.persona.split('\n').map(line=>line.trimEnd()).join('\n')}}))),
    artifact:{kind:'deterministic_transformation',historyCandidateIds:sources}}
  }
 }
 class Executor extends ExecutorService {
  describe(){return {...descriptor('local-text-executor'),configDigest:'text-pass-through-v1'}}
  async execute({applied,signal}){signal?.throwIfAborted();return {...cost,artifact:{text:applied.persona}}}
 }
 if(config.generator!==false)await ctx.plugin(Generator)
 await ctx.plugin(Executor)
 if(config.evaluators!==false)await ctx.plugin(FunctionEvaluators,{evaluate:evaluateText,descriptors:descriptors(),implementationDigest:'local-text-check-v1',dataDigest:'target-text-local-only-v1'})
}
