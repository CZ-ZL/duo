import {readFileSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import {ContractService,fail} from './definitions.js'
import {digest} from './store.js'
import {finite} from './policies.js'
import {moneyFields} from './money.js'
import {normalizeWarmStart} from './warm-start.js'
import {normalizeSearchStages,searchTiersOf,evaluationTiersOf,objectiveIdentityKeys,objectiveDirections} from './stages.js'
export const freeze=value=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value)}return value}
const integer=(v,min=0)=>Number.isSafeInteger(v)&&v>=min
export default class JsonContract extends ContractService {
 static Config=Schema.object({experiment:Schema.string().required()})
 constructor(ctx,config){super(ctx);this.path=resolve(config.experiment)}
 resolve(){
  let c;try{c=JSON.parse(readFileSync(this.path,'utf8'))}catch{fail('DUO_CONTRACT_INVALID','Native experiment must be a readable JSON contract')}
  return resolveNativeContract(c,this.path)
 }
}
// Shared by read-only drafting and execution. No file access or provider binding.
export function resolveNativeContract(c,contractPath){
  if(!c||c.version!==1||typeof c.id!=='string'||!c.id||c.target?.kind!=='dsh-persona'||typeof c.target.path!=='string')fail('DUO_CONTRACT_INVALID','Native v1 contract requires an id and a DSH persona target')
  const authored=c;c=normalizeSearchStages(c)
  const b=c.budget,m=moneyFields(b)
  if(!b||!finite(b[m.cap])||b[m.cap]<0||!['maxSessions','maxFastEvals','maxSlowEvals'].every(k=>integer(b[k]))||!integer(b.maxWallTimeMs,1))fail('DUO_CONTRACT_INVALID','Explicit finite cost, operation, evaluation and time caps are required')
  // Optional cross-run paid safety cap; the per-run cap alone is renewed by any
  // one-byte contract change. Currency must match the budget's own fields.
  const suffix=m.cap.slice('maxCost'.length),cumulative='maxCumulativeCost'+suffix
  if(b[cumulative]!==undefined&&(!finite(b[cumulative])||b[cumulative]<=0))fail('DUO_CONTRACT_INVALID','The optional cumulative cross-run cost cap must be an explicit positive finite amount')
  if(b['maxCumulativeCost'+(m.currency==='CNY'?'Usd':'Cny')]!==undefined)fail('DUO_CURRENCY_MISMATCH','The cumulative cross-run cost cap must use the budget currency')
  if(!integer(c.generations)||!integer(c.topK)||!finite(c.epsilon)||c.epsilon<0||!integer(c.minSamples,1)||!c.quotas||Object.keys(c.quotas).sort().join(',')!=='exploit,explore,innovate'||!Object.values(c.quotas).every(v=>integer(v)))fail('DUO_CONTRACT_INVALID','Invalid generation, quota or comparison limits')
  if(c.operation!==undefined&&!['optimize','evaluate'].includes(c.operation))fail('DUO_CONTRACT_INVALID','Operation must be optimize or evaluate')
  if(c.allowNoiseRepeats!==undefined&&typeof c.allowNoiseRepeats!=='boolean')fail('DUO_CONTRACT_INVALID','allowNoiseRepeats must be an explicit boolean; it never grants additional budget or permissions')
  if(c.stopping!==undefined){
    if(!c.stopping||typeof c.stopping!=='object'||Array.isArray(c.stopping)||Object.entries(c.stopping).some(([k,v])=>!['maxConsecutiveEvaluationFailures','maxNoProgressGenerations'].includes(k)||!integer(v,1)))fail('DUO_CONTRACT_INVALID','stopping accepts only positive consecutive evaluation failure and no-progress generation limits')
    if(c.stopping.maxNoProgressGenerations!==undefined&&(c.operation==='evaluate'||!searchTiersOf(c).length))fail('DUO_CONTRACT_INVALID','No-progress stopping requires candidate search with a Fast measurement objective')
  }
  if(c.operation==='evaluate'&&(c.generations!==0||Object.values(c.quotas).some(n=>n!==0)||!evaluationTiersOf(c).some(t=>c[t])))fail('DUO_CONTRACT_INVALID','Evaluation-only requires a measurement objective, zero generations and zero search quotas')
  if(c.warmStart!==undefined){
    if(c.operation==='evaluate')fail('DUO_CONTRACT_INVALID','warmStart supplies search context; evaluation-only has no generation to consume it')
    c={...c,warmStart:normalizeWarmStart(c.warmStart)}
  }
  for(const tier of evaluationTiersOf(c)){
    const d=c[tier];if(!d)continue
    if(!objectiveIdentityKeys.every(k=>typeof d[k]==='string'&&d[k])||!objectiveDirections.includes(d.direction)||!d.weights||!Object.keys(d.weights).length||!Object.values(d.weights).every(finite)||!finite(d.weights[d.metric])||Math.sign(d.weights[d.metric])!==(d.direction==='maximize'?1:-1))fail('DUO_CONTRACT_INVALID','Each objective needs evaluator/version/data identity and explicit compatible comparison weights')
  }
  if(!c.searchStages&&c.slow&&!c.fast)fail('DUO_CONTRACT_INVALID','Slow validation needs a fast measurement objective')
  if(c.final&&searchTiersOf(c).some(t=>c[t]?.dataId===c.final.dataId))fail('DUO_FINAL_DATA_INVALID','Final data identity must be distinct from search data')
  if(!Array.isArray(c.constraints)||c.constraints.some(x=>!x||typeof x.metric!=='string'||!['==','!=','>','>=','<','<='].includes(x.op)||!(typeof x.value==='boolean'||finite(x.value))))fail('DUO_CONTRACT_INVALID','Invalid hard constraints')
  const permissions=c.permissions??{paid:false,network:false,externalSideEffects:false}
  if(Object.keys(permissions).sort().join(',')!=='externalSideEffects,network,paid'||!Object.values(permissions).every(v=>typeof v==='boolean')||!permissions.paid&&b[m.cap]!==0)fail('DUO_CONTRACT_INVALID','Paid allowance requires an explicit contract permission')
  const targetPath=resolve(dirname(contractPath),c.target.path)
  const tiers=searchTiersOf(c)
  const spec={...c,permissions,target:{...c.target,path:targetPath},mode:c.operation==='evaluate'?'evaluation_only':tiers.length>1?'optimize':tiers.length===1?'fast_only':'explore'}
  return freeze({spec,contractPath,contractDigest:digest(c.searchStages?authored:c)})
}
// Public provider examples must use the same canonical content identity as plans
// and model receipts, without importing private storage implementation paths.
export {digest}
