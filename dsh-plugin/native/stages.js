import {fail} from './definitions.js'

// Legacy flat contracts keep their fixed names; explicit searchStages contracts
// declare their own ordered credibility ladder (first = cheapest pool, last =
// terminal validation; array order is increasing fidelity and cost).
export const LEGACY_SEARCH_TIERS=Object.freeze(['fast','review','slow'])
export const tierNamePattern=/^[a-z][a-z0-9_]{0,31}$/
export const reservedTierNames=Object.freeze(['final','baseline'])
export const objectiveIdentityKeys=Object.freeze(['evaluatorId','version','dataId','metric'])
export const objectiveDirections=Object.freeze(['maximize','minimize'])
export const objectiveKeys=Object.freeze([...objectiveIdentityKeys,'direction','weights'])
export const stagePurposes=Object.freeze(['screen','rank','confirm'])
export const stageKeys=Object.freeze([...objectiveKeys,'tier','purpose','informationGain','maxEvaluations','topK'])
export function searchTiersOf(spec){return Array.isArray(spec.searchStages)?spec.searchStages.map(s=>s?.tier).filter(t=>typeof t==='string'):LEGACY_SEARCH_TIERS.filter(t=>spec[t])}
export function evaluationTiersOf(spec){return [...searchTiersOf(spec),'final']}
// Fresh schema objects share the runtime's finite field/enum definitions.
// Cross-field, byte-envelope and trust-boundary checks still run in the resolver.
export function objectiveSchema(){return {type:'object',properties:{...Object.fromEntries(objectiveIdentityKeys.map(k=>[k,{type:'string'}])),
 direction:{type:'string',enum:[...objectiveDirections]},weights:{type:'object',additionalProperties:{type:'number'}}},required:[...objectiveKeys]}}
export function searchStagesSchema(){return {type:'array',minItems:1,
 description:'Ordered credibility ladder of one or more stages (uncapped depth; two is the common default) with unique caller-chosen tier names (cheapest first, terminal validation last). Final stays separate. Each topK is bounded by the global topK; the last is zero. The first stage consumes the Fast budget; every deeper stage consumes the shared Slow budget.',
 items:{type:'object',additionalProperties:false,properties:{...objectiveSchema().properties,
 tier:{type:'string',pattern:tierNamePattern.source},purpose:{type:'string',enum:[...stagePurposes]},informationGain:{type:'string',minLength:1,maxLength:2048},
 maxEvaluations:{type:'integer',minimum:0},topK:{type:'integer',minimum:0}},required:[...stageKeys]}}}
export function normalizeSearchStages(contract){
 const stages=contract.searchStages
 if(stages===undefined){
  if(contract.review!==undefined)fail('DUO_CONTRACT_INVALID','The review tier requires an explicit ordered searchStages configuration')
  return contract
 }
 const invalid=()=>fail('DUO_CONTRACT_INVALID','searchStages requires one or more ordered stages with unique tier names ('+tierNamePattern.source+', never final/baseline), each with objective, purpose, informationGain, finite maxEvaluations and bounded topK; do not mix flat search objectives')
 if(!Array.isArray(stages)||!stages.length||LEGACY_SEARCH_TIERS.some(t=>contract[t]!==undefined))invalid()
 const names=stages.map(s=>s?.tier)
 if(names.some(n=>typeof n!=='string'||!tierNamePattern.test(n)||reservedTierNames.includes(n))||new Set(names).size!==names.length)invalid()
 for(const [i,s]of stages.entries()){
  if(Object.keys(s).some(k=>!stageKeys.includes(k))||
   !stagePurposes.includes(s.purpose)||typeof s.informationGain!=='string'||!s.informationGain.trim()||Buffer.byteLength(s.informationGain)>2048||
   !Number.isSafeInteger(s.maxEvaluations)||s.maxEvaluations<0||!Number.isSafeInteger(s.topK)||s.topK<0||s.topK>contract.topK||i===stages.length-1&&s.topK!==0)invalid()
 }
 return {...contract,...Object.fromEntries(stages.map(s=>[s.tier,Object.fromEntries(objectiveKeys.map(k=>[k,s[k]]))]))}
}
// Legacy and explicit contracts enter the same execution skeleton. Legacy
// callers retain their global limits; missing purpose information stays visible.
export function searchStages(spec){
 return spec.searchStages??LEGACY_SEARCH_TIERS.filter(t=>spec[t]).map((tier,i,tiers)=>({...spec[tier],tier,
  purpose:i===0?'screen':'confirm',informationGain:'Not explicitly declared in this legacy contract; inspect evaluator fidelityRationale.',
  maxEvaluations:tier==='fast'?spec.budget.maxFastEvals:spec.budget.maxSlowEvals,topK:i===tiers.length-1?0:spec.topK}))
}
