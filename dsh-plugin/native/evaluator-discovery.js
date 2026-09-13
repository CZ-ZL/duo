import {moneyFields} from './money.js'
import {searchTiersOf,evaluationTiersOf} from './stages.js'

// The same declaration checks are used by preparation and execution binding.
// They do not establish evaluator correctness or grant host permissions.
export function matchEvaluator(descriptors,objective,tier,spec){
 const matches=descriptors.filter(d=>d&&d.id===objective.evaluatorId&&d.version===objective.version&&d.dataId===objective.dataId&&d.tier===tier)
 if(matches.length!==1)return {status:'INCOMPATIBLE',issues:[matches.length?'ambiguous_identity':'no_matching_identity'],selected:null}
 const selected=matches[0],issues=[],required=[...Object.keys(objective.weights??{}),...(spec.constraints??[]).map(c=>c.metric),'sample_size']
 if(!Array.isArray(selected.metrics)||required.some(m=>!selected.metrics.includes(m)))issues.push('metric_coverage')
 const direction=selected.metricDefinitions?.[objective.metric]?.direction
 if(direction!==undefined&&direction!==objective.direction)issues.push('metric_direction:'+objective.metric)
 if(selected.dependencies!==undefined){
  if(!Array.isArray(selected.dependencies))issues.push('dependencies_invalid')
  else for(const dependency of selected.dependencies)if(typeof dependency?.name!=='string'||dependency.available!==true)issues.push('dependency:'+(dependency?.name??'unknown'))
 }
 const permissions=spec.permissions??{paid:false,network:false,externalSideEffects:false}
 for(const key of ['paid','network','externalSideEffects']){
  if(typeof selected.permissions?.[key]!=='boolean')issues.push('permission_unknown:'+key)
  else if(selected.permissions[key]&&!permissions[key])issues.push('permission:'+key)
 }
 try{
  const m=moneyFields(selected)
  if(spec.budget&&m.currency!==moneyFields(spec.budget).currency)issues.push('currency')
  if(!Number.isFinite(selected[m.reservation])||selected[m.reservation]<0)issues.push('reservation_unknown')
  if(selected.permissions?.paid===false&&selected[m.reservation]!==0)issues.push('unpaid_reservation')
 }catch{issues.push('currency')}
 return {status:issues.length?'INCOMPATIBLE':'COMPATIBLE_BY_DECLARATION',issues,selected}
}
const publicFields=['id','version','tier','dataId','metrics','currency','reservationCny','reservationUsd','evidenceKind','evidenceFamily','fidelityRationale','qualification','implementationDigest','dataDigest','configDigest','maxRequests','dependencies','inputDescription','outputDescription','sampleScope','independentData','realTools']
function publicDescriptor(d){
 const result=Object.fromEntries(publicFields.filter(k=>d[k]!==undefined).map(k=>[k,structuredClone(d[k])]))
 result.permissions=Object.fromEntries(['paid','network','externalSideEffects'].map(k=>[k,typeof d.permissions?.[k]==='boolean'?d.permissions[k]:null]))
 result.metricDefinitions=Object.fromEntries((d.metrics??[]).map(metric=>[metric,Object.fromEntries(['meaning','direction','unit'].map(k=>[k,typeof d.metricDefinitions?.[metric]?.[k]==='string'?d.metricDefinitions[metric][k]:null]))]))
 for(const metric of d.metrics??[]){
  const definition=d.metricDefinitions?.[metric],visible=result.metricDefinitions[metric]
  for(const [key,allowed] of Object.entries({purpose:['format','hard_constraint','ranking','final_confirmation'],construct:['format','task_result','cost']}))
   visible[key]=allowed.includes(definition?.[key])?definition[key]:null
  for(const key of ['lowerBound','upperBound'])visible[key]=Number.isFinite(definition?.[key])?definition[key]:null
  if(visible.lowerBound!==null&&visible.upperBound!==null&&visible.lowerBound>visible.upperBound)visible.lowerBound=visible.upperBound=null
 }
 result.unknownFields=['dependencies','inputDescription','outputDescription','sampleScope','independentData','realTools','evidenceFamily'].filter(k=>d[k]===undefined)
 for(const metric of d.metrics??[])for(const key of ['meaning','direction','unit'])if(result.metricDefinitions[metric][key]===null)result.unknownFields.push('metricDefinitions.'+metric+'.'+key)
 return result
}

// Preparation facts only. A declared construct match is neither calibration nor
// proof of task headroom. This does not change comparison or execution policy.
export function inspectMeasurement(spec,evaluators,goal){
 const stages=Array.isArray(spec.searchStages)?spec.searchStages:[]
 const primaryTier=stages.length?searchTiersOf(spec).at(-1)??null:spec.slow?'slow':spec.fast?'fast':spec.final?'final':null
 const objective=spec[primaryTier]??stages.find(s=>s?.tier===primaryTier)??null,match=evaluators.matches[primaryTier]
 const provider=evaluators.items.find(d=>d.tier===primaryTier&&d.id===objective?.evaluatorId&&d.version===objective?.version&&d.dataId===objective?.dataId)
 const definition=provider?.metricDefinitions?.[objective?.metric]
 const status=!goal||match?.status!=='COMPATIBLE_BY_DECLARATION'||!definition?.construct?'UNKNOWN':definition.construct===goal?'DECLARED_MATCH':'GOAL_MISMATCH'
 const reasons=status==='UNKNOWN'?['MEASUREMENT_PURPOSE_OR_COMPATIBILITY_UNKNOWN']:status==='GOAL_MISMATCH'?['PRIMARY_METRIC_MEASURES_'+definition.construct.toUpperCase()]:['DECLARED_CONSTRUCT_MATCHES_GOAL']
 return {version:'1',status,goal:goal??null,primaryTier,metric:objective?.metric??null,definition:definition??null,reasons,
  qualification:'NOT_VERIFIED_BY_DISCOVERY',headroom:'NOT_MEASURED',executedEvaluations:0,
  nextAction:status==='GOAL_MISMATCH'?'Use a metric measuring the requested outcome; format checks may remain constraints.':status==='UNKNOWN'?'Declare the intended measurement and inspect compatible metric definitions.':'Check frozen positive/negative controls and baseline development errors before interpreting optimization.',
  limitations:['Provider declarations do not establish answer-key correctness or evaluator discrimination.','A score tie alone is not evidence that measurement is broken.','Bounds describe this metric only; no general quality ceiling is inferred.']}
}
export function inspectEvaluators(ctx,spec={}){
 const result={status:'UNAVAILABLE',scope:'Only the active EvaluatorsService visible in this DSH context; unloaded packages are not searched.',items:[],matches:{},executedEvaluations:0,
  limitations:['Descriptors are provider declarations, not qualification or authority.','Unknown dependency and metric semantics are explicit; inspect the provider contract before adoption.']}
 try{
  const provider=ctx.get('duoEvaluators');if(!provider)return result
  const descriptions=provider.describe()
  if(!Array.isArray(descriptions)||descriptions.some(d=>!d||typeof d.id!=='string'||!Array.isArray(d.metrics)||!d.metrics.every(m=>typeof m==='string')))return {...result,status:'INVALID_DESCRIPTOR',nextAction:'Repair the configured provider descriptor; no evaluator has been executed.'}
  result.items=descriptions.map(publicDescriptor);result.status='AVAILABLE'
  const stages=Array.isArray(spec.searchStages)?spec.searchStages:[]
  for(const tier of evaluationTiersOf(spec)){const objective=spec[tier]??stages.find(s=>s?.tier===tier);if(objective){const {selected,...match}=matchEvaluator(descriptions,objective,tier,spec);result.matches[tier]={...match,providerId:selected?.id??null}}}
  return result
 }catch{return {...result,status:'PROVIDER_UNAVAILABLE',nextAction:'Inspect the active evaluator service and its dependencies in the host; discovery cannot execute or repair it.'}}
}
