// BYO example: actual deterministic measurement, not a fixed-score fixture.
import {readFileSync} from 'node:fs'
import FunctionEvaluators from '@dual-loop/dsh-plugin/function-evaluators'
import {measureFactBatch,FACT_MEASUREMENT_VERSION} from './fact-task.js'
import {digest} from '@dual-loop/dsh-plugin/contract'

export const name='duo-fact-support-evaluator'
export function apply(ctx,config){
 const dataset=JSON.parse(readFileSync(config.datasetPath,'utf8')),answerKey=JSON.parse(readFileSync(config.answerKeyPath,'utf8'))
 if(answerKey.version!=='fact-support-v1'||digest(dataset)!==answerKey.datasetDigest)throw new Error('Frozen fact task/key identity mismatch')
 const descriptors=['fast','slow','final'].filter(tier=>dataset[tier]).map(tier=>({id:'fact-support-'+tier,version:FACT_MEASUREMENT_VERSION,tier,dataId:dataset[tier].id,
  metrics:['supported_accuracy','fact_accuracy','format_valid','sample_size'],currency:'CNY',reservationCny:0,permissions:{paid:false,network:false,externalSideEffects:false},
  evidenceKind:'programmatic_measurement',evidenceFamily:'synthetic-keyed-facts-v1',fidelityRationale:dataset[tier].tasks.length+(tier==='final'?' held-out cases; actual independence still requires run/input audit':tier==='slow'?' distinct development cases for broader confirmation':' development cases; inspect the frozen manifest for coverage'),
  metricDefinitions:{supported_accuracy:{meaning:'Fraction of planned answers both correct and supported by keyed evidence spans',direction:'maximize',unit:'fraction',purpose:tier==='final'?'final_confirmation':'ranking',construct:'task_result',lowerBound:0,upperBound:1},
   fact_accuracy:{meaning:'Fraction of planned answers with correct fact/abstention',direction:'maximize',unit:'fraction',purpose:'ranking',construct:'task_result',lowerBound:0,upperBound:1},
   format_valid:{meaning:'All planned task IDs and required answer fields valid',direction:'maximize',unit:'boolean',purpose:'hard_constraint',construct:'format'}}}))
 return ctx.plugin(FunctionEvaluators,{descriptors,implementationDigest:digest([readFileSync(new URL('./fact-task.js',import.meta.url),'utf8'),readFileSync(new URL('./fact-evaluator.js',import.meta.url),'utf8')]),
  dataDigest:digest({dataset,answerKey}),evaluate:args=>measureFactBatch(dataset,answerKey,args)})
}
