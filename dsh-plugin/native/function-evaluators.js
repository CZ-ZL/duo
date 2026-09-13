import {EvaluatorsService,fail} from './definitions.js'
import {freeze} from './contract.js'
import {digest,units} from './store.js'
import {finite} from './policies.js'
import {assertMoneyEvidence} from './money.js'
import {tierNamePattern} from './stages.js'

// Caller-owned, frozen control outputs exercise an existing measurement. This
// wrapper makes no model calls of its own and never retries its callback.
export function createControlEvaluation({evaluate,controls,discriminationMetric,reservationCnyPerCase}){
 const invalid=()=>fail('DUO_PROVIDER_INVALID','Controls require 2–32 unique control-only cases, fixed numeric/boolean expectations with differing discrimination outcomes, and a finite per-case CNY reservation')
 if(typeof evaluate!=='function'||typeof discriminationMetric!=='string'||!discriminationMetric||!finite(reservationCnyPerCase)||reservationCnyPerCase<0||
  !Array.isArray(controls)||controls.length<2||controls.length>32)invalid()
 let frozen
 try{frozen=JSON.parse(JSON.stringify(controls))}catch{invalid()}
 if(Buffer.byteLength(JSON.stringify(controls))>65536||new Set(controls.map(c=>c?.id)).size!==controls.length||controls.some(c=>
  !c||typeof c.id!=='string'||!c.id||c.purpose!=='control'||!c.artifact||typeof c.artifact!=='object'||Array.isArray(c.artifact)||
  !c.expectedMetrics||typeof c.expectedMetrics!=='object'||Array.isArray(c.expectedMetrics)||
  !Object.values(c.expectedMetrics).every(v=>finite(v)||typeof v==='boolean')||
  !(finite(c.expectedMetrics[discriminationMetric])||typeof c.expectedMetrics[discriminationMetric]==='boolean'))||
  new Set(controls.map(c=>c.expectedMetrics[discriminationMetric])).size<2)invalid()
 freeze(frozen)
 const cap=units(reservationCnyPerCase,true),totalCap=cap*frozen.length
 if(!Number.isSafeInteger(totalCap))invalid()
 const controlsDigest=digest(frozen)
 return Object.freeze({controlsDigest,maxInvocations:frozen.length,reservationCny:totalCap/1e9,
  async evaluate(args){
   const rows=[],nestedReceipts=[];let spent=0,unknown=false,stopReason=null
   for(const control of frozen){
    if(args.signal?.aborted){stopReason='ABORTED';break}
    let value
    try{value=await evaluate({...args,artifact:structuredClone(control.artifact)})}catch{stopReason='CALLBACK_FAILED'}
    let fee=null
    try{assertMoneyEvidence(value,'CNY');if(value?.currency==='CNY'&&finite(value.costCny)&&value.costCny>=0)fee=units(value.costCny)}catch{}
    const valid=value?.ok===true&&value.metrics&&typeof value.metrics==='object'&&!Array.isArray(value.metrics)&&
     Object.values(value.metrics).every(v=>finite(v)||typeof v==='boolean')&&!value.error
    const measured=valid?structuredClone(value.metrics):null
    const matched=!!valid&&Object.entries(control.expectedMetrics).every(([k,v])=>measured[k]===v)
    rows.push({id:control.id,purpose:'control',expectedMetrics:control.expectedMetrics,actualMetrics:measured,matched,costCny:fee===null?null:fee/1e9})
    nestedReceipts.push({controlId:control.id,currency:'CNY',costCny:fee===null?null:fee/1e9,costEvidence:value?.costEvidence??null})
    if(fee===null){unknown=true;stopReason??='DUO_COST_UNKNOWN';break}
    spent+=fee
    if(!Number.isSafeInteger(spent)){unknown=true;stopReason='DUO_COST_UNKNOWN';break}
    if(fee>cap){stopReason='DUO_BUDGET_OVERRUN';break}
    if(!valid){stopReason='DUO_EVIDENCE_INVALID';break}
   }
   const complete=rows.length===frozen.length&&!stopReason
   const outcomes=rows.map(r=>r.actualMetrics?.[discriminationMetric])
   return {ok:complete,metrics:{control_match_rate:rows.filter(r=>r.matched).length/frozen.length,
    controls_distinguish:complete&&outcomes.every(v=>v!==undefined)&&new Set(outcomes).size>1,sample_size:rows.length},
    currency:'CNY',costCny:unknown?null:spent/1e9,
    evidence:[{kind:'evaluator_control_check',qualification:'SUPPLIED_CONTROLS_ONLY',controlsDigest,discriminationMetric,
     plannedCases:frozen.length,completedCases:rows.length,stopReason,rows}],
    costEvidence:{currency:'CNY',knownCostCny:spent/1e9,nestedReceipts,unknownCost:unknown,
     controlProgress:{controlsDigest,plannedCases:frozen.length,completedCases:rows.length,stopReason,rows}}}
  }})
}
export default class FunctionEvaluators extends EvaluatorsService {
 constructor(ctx,config){
  super(ctx)
  if(typeof config?.evaluate!=='function'||!['implementationDigest','dataDigest'].every(k=>typeof config[k]==='string'&&config[k]))fail('DUO_PROVIDER_INVALID','An existing evaluator function and explicit implementation/data identities are required')
  const descriptors=structuredClone(config.descriptors),tiers=new Set()
  if(!Array.isArray(descriptors)||!descriptors.length)fail('DUO_PROVIDER_INVALID','Evaluator descriptors are required')
  for(const d of descriptors){
   if(!d||!['id','version','dataId','evidenceFamily','fidelityRationale'].every(k=>typeof d[k]==='string'&&d[k])||!(d.tier==='final'||tierNamePattern.test(d.tier))||tiers.has(d.tier)||
    d.currency!=='CNY'||!finite(d.reservationCny)||d.reservationCny<0||!Array.isArray(d.metrics)||!d.metrics.includes('sample_size')||!d.metrics.every(k=>typeof k==='string')||
    !d.permissions||!['paid','network','externalSideEffects'].every(k=>typeof d.permissions[k]==='boolean')||!d.permissions.paid&&d.reservationCny!==0)
    fail('DUO_PROVIDER_INVALID','Unique tier descriptors require CNY reservations, metric coverage, permissions and explicit evidence-family limits')
   tiers.add(d.tier)
   d.implementationDigest=config.implementationDigest;d.dataDigest=config.dataDigest;d.qualification='CALLER_DECLARED_NOT_VERIFIED_BY_DUO'
  }
  const configDigest=digest(descriptors)
  this.descriptors=freeze(descriptors.map(d=>({...d,configDigest})));this.evaluateFunction=config.evaluate
 }
 describe(){return structuredClone(this.descriptors)}
 async evaluate(args){
  const d=this.descriptors.find(d=>d.tier===args.tier)
  const identity={candidateId:args.candidate?.id??null,evaluatorId:d?.id??null,version:d?.version??null,dataId:d?.dataId??null,tier:args.tier}
  const refused=(costCny,code,message)=>({...identity,ok:false,metrics:{},currency:'CNY',costCny,evidence:[],error:{code,message,component:'duoEvaluators',retryable:false,nextAction:'Inspect the evaluator inputs and its retained cost evidence; do not retry unknown work.'}})
  if(!d)return refused(0,'DUO_DATA_INVALID','Unconfigured evaluation tier')
  if(args.signal?.aborted)return refused(0,'ABORTED','Evaluation cancelled before invoking the function')
  let value
  try{value=await this.evaluateFunction(args)}catch{return refused(null,'DUO_COST_UNKNOWN','Evaluator function threw without a settled usage receipt')}
  let costCny=null
  try{assertMoneyEvidence(value,'CNY');if(value?.currency==='CNY'&&finite(value.costCny)&&value.costCny>=0)costCny=value.costCny}catch{}
  if(costCny===null)return {...refused(null,'DUO_COST_UNKNOWN','Evaluator returned no complete CNY accounting'),costEvidence:value?.costEvidence??null}
  const valid=value&&typeof value.ok==='boolean'&&value.metrics&&typeof value.metrics==='object'&&!Array.isArray(value.metrics)&&
   Object.values(value.metrics).every(v=>finite(v)||typeof v==='boolean')&&(!value.ok||d.metrics.every(k=>Object.hasOwn(value.metrics,k)))&&
   Object.entries(identity).every(([k,v])=>value[k]===undefined||value[k]===v)&&Array.isArray(value.evidence??[])&&!value.error
  if(!valid)return {...refused(costCny,'DUO_EVIDENCE_INVALID','Evaluator facts or identity differ from its declared contract'),costEvidence:value?.costEvidence??null}
  return {...identity,ok:value.ok,metrics:structuredClone(value.metrics),currency:'CNY',costCny,evidence:structuredClone(value.evidence??[]),costEvidence:value.costEvidence??null}
 }
}
