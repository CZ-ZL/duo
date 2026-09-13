// Existing control wrapper + native reviewer. No extra controller or loop.
import {readFileSync} from 'node:fs'
import FunctionEvaluators,{createControlEvaluation} from '@dual-loop/dsh-plugin/function-evaluators'
import {digest} from '@dual-loop/dsh-plugin/contract'
import CodeContractReview from './code-contract-review.js'
import * as Fixtures from './fixture-provider.js'
export const name='duo-code-review-controls'
export const inject=['agents','llm','systemPrompt','tools']
export async function apply(ctx,config){
 const model=JSON.parse(readFileSync(config.modelConfigPath,'utf8'))
 const controls=JSON.parse(readFileSync(config.controlsPath,'utf8'))
 const scope=ctx.isolate('duoEvaluators')
 await scope.plugin(CodeContractReview,model)
 await ctx.plugin(Fixtures,{currency:'CNY',generator:false,evaluators:false})
 // Loader-owned plugins require declared access even to an isolated child
 // provider. The outer evaluator keeps the parent context and public name.
 await scope.inject(['duoEvaluators'],async scoped=>{
 const descriptor=scoped.duoEvaluators.describe().find(d=>d.tier==='fast')
 if(!descriptor)throw new Error('Control reviewer must declare the isolated control Fast split')
 const measure=args=>scoped.duoEvaluators.evaluate({...args,artifact:{...args.artifact,status:'completed',candidateId:args.candidate.id,
   candidateVersion:args.candidate.version,tier:'fast',dataId:descriptor.dataId,datasetDigest:descriptor.datasetDigest,
   sourceKind:'PREDECLARED_CALIBRATION_SPECIMEN_NOT_TARGET_EXECUTION'}})
 const wrap=evaluate=>createControlEvaluation({controls,discriminationMetric:'contract_pass_rate',reservationCnyPerCase:descriptor.reservationCny,evaluate})
 const checked=wrap(measure)
 const composed=await ctx.plugin(FunctionEvaluators,{implementationDigest:digest({reviewer:descriptor,adapter:readFileSync(new URL(import.meta.url),'utf8')}),
  dataDigest:checked.controlsDigest,evaluate:async args=>{
   // Each evaluation owns its diagnostics, including concurrent callers. The
   // existing wrapper still controls order, fees and stopping without retries.
   const diagnostics=[];let index=0
   const result=await wrap(async input=>{
    const controlId=controls[index++].id,value=await measure(input)
    if(value.error)diagnostics.push({controlId,reviewerVersion:value.version,error:value.error,
     judgmentPath:value.evidence?.[0]?.judgmentPath??null})
    return value
   }).evaluate(args)
   return {...result,evidence:[...result.evidence,...diagnostics.length?[{kind:'code_review_diagnostics',rows:diagnostics}]:[]]}
  },
  descriptors:[{id:'code-review-controls',version:'3',tier:'fast',dataId:descriptor.dataId,
   metrics:['control_match_rate','controls_distinguish','sample_size'],currency:'CNY',reservationCny:checked.reservationCny,maxRequests:checked.maxInvocations,
   permissions:descriptor.permissions,evidenceKind:descriptor.evidenceKind,
   evidenceFamily:'model_public_contract_review_controls',fidelityRationale:'Known legal and wrong programs calibrate a public-contract reviewer. No optimization, independent Caller or all-input fidelity claim.',
   controlsDigest:checked.controlsDigest,reviewer:descriptor,
   metricDefinitions:{control_match_rate:{meaning:'Fraction of declared control batches matching all frozen expected facts',direction:'maximize',unit:'fraction',purpose:'diagnostic',construct:'measurement_control',lowerBound:0,upperBound:1}}}]})
 scoped.effect(()=>()=>composed.dispose())
 })
}
