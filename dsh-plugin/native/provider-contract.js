import {fail,assertProviderMethods} from './definitions.js'
import {freeze} from './contract.js'
import {targetKindSchema} from './capabilities.js'
import {moneyFields} from './money.js'
import {matchEvaluator} from './evaluator-discovery.js'
import {evaluationTiersOf} from './stages.js'
const methods=freeze({duoGenerator:['describe','propose'],duoExecutor:['describe','execute'],duoEvaluators:['describe','evaluate'],duoComparator:['describe','compare'],duoGate:['describe','select'],duoFeedback:['describe','summarize'],duoTarget:['describe','snapshot','apply'],duoJournal:['describe','open'],duoBudget:['describe','open','inspect','reconcile']})
export const providerContractDependencies=spec=>Object.keys(methods).filter(key=>key!=='duoGenerator'||spec?.mode!=='evaluation_only')

// Read-only declared binding checks shared by public provider tests and planning.
// Call with resolveNativeContract(...).spec; trusted describe methods must not do work.
export function inspectProviderContracts(ctx,spec){
  for(const key of providerContractDependencies(spec))assertProviderMethods(ctx[key],key,methods[key])
  const target=ctx.duoTarget.describe()
  if(target?.targetKinds!==undefined){
    if(!Array.isArray(target.targetKinds)||!target.targetKinds.length||target.targetKinds.some(kind=>typeof kind!=='string'||!new RegExp(targetKindSchema.pattern).test(kind)))fail('DUO_PROVIDER_INVALID','Target targetKinds must be a nonempty list of valid kind identifiers')
    if(!target.targetKinds.includes(spec.target.kind))fail('DUO_TARGET_INCOMPATIBLE','Configured Target adapter does not support the contract kind; select its advertised adapter before running')
  }
  if('orderHistory' in ctx.duoFeedback)assertProviderMethods(ctx.duoFeedback,'duoFeedback',['orderHistory'])
  const generator=spec.mode==='evaluation_only'?null:ctx.duoGenerator.describe(),executor=ctx.duoExecutor.describe(),evaluators=ctx.duoEvaluators.describe()
  if(!Array.isArray(evaluators))fail('DUO_PROVIDER_INVALID','Evaluator provider must describe its measurements')
  const required=[...(generator?[generator]:[]),executor],selectedEvaluators=[]
  for(const tier of evaluationTiersOf(spec))if(spec[tier]){
    const match=matchEvaluator(evaluators,spec[tier],tier,spec)
    if(!match.selected||match.issues.includes('metric_coverage'))fail('DUO_EVALUATOR_MISSING','A unique compatible evaluator with declared metric coverage is required')
    if(match.issues.includes('currency'))fail('DUO_CURRENCY_MISMATCH','Evaluator currency differs from the frozen budget')
    if(match.issues.some(i=>i.startsWith('metric_direction:')))fail('DUO_EVALUATOR_INCOMPATIBLE','Evaluator metric direction differs from the objective')
    if(match.issues.some(i=>i.startsWith('dependenc')))fail('DUO_EVALUATOR_DEPENDENCY','Declared evaluator dependencies are missing, unknown or invalid; inspect dualloop_design before execution')
    if(match.issues.length)fail('DUO_PROVIDER_INVALID','Evaluator permissions or reservation are invalid or unauthorized')
    required.push(match.selected)
    selectedEvaluators.push(match.selected)
  }
  for(const d of required){
    const m=moneyFields(d)
    if(m.currency!==moneyFields(spec.budget).currency)fail('DUO_CURRENCY_MISMATCH','Provider reservation currency differs from the frozen budget')
    if(!d||typeof d.id!=='string'||!d.id.trim()||typeof d.version!=='string'||!d.version.trim()||typeof d[m.reservation]!=='number'||!Number.isFinite(d[m.reservation])||d[m.reservation]<0||!d.permissions||!['paid','network','externalSideEffects'].every(k=>typeof d.permissions[k]==='boolean'&&(!d.permissions[k]||spec.permissions[k])))fail('DUO_PROVIDER_INVALID','Provider identity, reservation and permissions must be explicit and authorized by the contract')
    if(!d.permissions.paid&&d[m.reservation]!==0)fail('DUO_PROVIDER_INVALID','A free provider cannot declare a paid reservation')
  }
  const policies=Object.fromEntries(['duoComparator','duoGate','duoFeedback','duoTarget','duoJournal','duoBudget'].map(key=>{const d=ctx[key].describe();if(!d||typeof d.id!=='string'||!d.id.trim()||typeof d.version!=='string'||!d.version.trim()||d.deterministic!==true)fail('DUO_PROVIDER_INVALID','Policy and storage providers must declare their deterministic versioned contract');return [key,d]}))
  return freeze(structuredClone({generator,executor,evaluators:selectedEvaluators,policies}))
}
