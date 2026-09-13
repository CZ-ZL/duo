// Supplied public measurement resource; the Calling Agent attaches the bridge.
// Private task/key data stay in the existing evaluator's isolated plugin scope.
import * as FactEvaluator from './fact-evaluator.js'
export const bridgeCode="return {name:'caller-fact-measurement-adapter',inject:['factMeasurement'],apply(ctx){ctx.provide('duoEvaluators',{describe:()=>ctx.factMeasurement.describe(),evaluate:args=>ctx.factMeasurement.evaluate(args)})}}"
export const name='caller-owned-fact-measurement-resource'
export const inject=['cordisInspect']
export function apply(ctx,config){
 const isolated=ctx.isolate('duoEvaluators')
 isolated.plugin(FactEvaluator,config)
 isolated.inject(['duoEvaluators'],scoped=>{
  const measurement={describe:()=>scoped.duoEvaluators.describe(),evaluate:args=>scoped.duoEvaluators.evaluate(args)}
  const release=ctx.provide('factMeasurement',measurement)
  scoped.effect(()=>release)
  scoped.effect(()=>ctx.cordisInspect.register({manifest:{id:'FactMeasurement',description:'Supplied deterministic fact and evidence support evaluator; no DUO binding until Caller attaches the supplied bridge.',methods:[{name:'describe',description:'Read service contract, metric limits and authorized adapter source. No data/key contents or evaluation.',inputSchema:{type:'object',additionalProperties:false},outputSchema:{type:'object',additionalProperties:true}}]},query:()=>({service:'factMeasurement',methods:{describe:'() => EvaluatorDescriptor[]',evaluate:'({candidate,artifact,tier,signal?}) => Promise<EvalResult>'},
   discovery:{runtimeService:'factMeasurement',runtimeBound:ctx.factMeasurement===measurement,codingCatalogRequired:false,
    meaning:'Service.listService is a coding-contract catalog, not a complete live binding registry. This supplied plugin publishes its own contract here; a missing catalog item does not negate this runtime binding.'},
   descriptors:measurement.describe(),bridgeCode,authorityGranted:false})}))
 })
}
