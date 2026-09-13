// Caller-owned read-only delivery helpers. No DUO private API, writes, execution
// or authorization. Actual file changes use the host's existing guarded tools.
import {createHash} from 'node:crypto'
const sha=text=>createHash('sha256').update(text).digest('hex')
const invalid=message=>{throw new Error('DUO_DELIVERY_INVALID: '+message)}
function snapshot(value){
 if(!value||typeof value.id!=='string'||!value.id||typeof value.persona!=='string'||!value.persona.trim()||Buffer.byteLength(value.persona)>65536||sha(value.persona)!==value.version)invalid('Missing, oversized or changed persona snapshot')
 return {id:value.id,version:value.version,persona:value.persona}
}
export function preparePersonaDelivery(status,candidateId){
 if(status?.apiVersion!==2||status.runtime!=='dsh-native'||typeof status.runId!=='string'||status.result?.runId!==status.runId||status.result.status!=='completed'||!Array.isArray(status.events)||status.events.length>4096)invalid('Expected a bounded completed public native status')
 const plans=status.events.filter(e=>e.kind==='plan'),plan=plans[0]?.plan
 if(plans.length!==1||plan?.runId!==status.runId||plan.spec?.target?.kind!=='dsh-persona'||typeof plan.planDigest!=='string')invalid('Missing or mismatched recorded plan')
 const original=snapshot(plan.baseline),nodes=new Map([[original.id,plan.baseline]])
 for(const e of status.events){
  if(e.kind!=='candidate')continue
  const c=e.candidate
  // Unapplied/invalid candidates may appear in a Journal; only verify the
  // explicitly requested candidate and its ancestry below.
  if(!c||typeof c.id!=='string')continue
  const prior=nodes.get(c.id)
  if(prior&&(prior.version!==c.version||prior.persona!==c.persona||prior.parentId!==c.parentId||prior.parentVersion!==c.parentVersion))invalid('Conflicting candidate identity')
  nodes.set(c.id,c)
 }
 if(candidateId===original.id||!nodes.has(candidateId))invalid('Choose an explicit candidate artifact')
 const lineage=[],seen=new Set();let current=nodes.get(candidateId)
 while(current.id!==original.id){
  if(seen.has(current.id))invalid('Cyclic lineage');seen.add(current.id)
  const value=snapshot(current),d=current.delta,parent=nodes.get(current.parentId)
  if(!d||Object.keys(d).sort().join(',')!=='kind,persona,target'||d.kind!=='cordis-overlay'||d.target!=='system-prompt'||d.persona!==value.persona||!parent||current.parentVersion!==parent.version)invalid('Incomplete or changed parent/overlay')
  snapshot(parent)
  for(const token of ['{{model}}','{{cwd}}'])if(parent.persona.includes(token)&&!value.persona.includes(token))invalid('Required parent placeholder removed')
  lineage.unshift({id:current.id,version:current.version,parentId:parent.id,parentVersion:parent.version});current=parent
 }
 lineage.unshift({id:original.id,version:original.version,parentId:null,parentVersion:null})
 return {format:'duo-persona-delivery-v1',runId:status.runId,planDigest:plan.planDigest,sourceTarget:plan.spec.target.path,original,candidate:snapshot(nodes.get(candidateId)),lineage,conclusion:status.result.conclusion,improvementProven:false,authorityGranted:false,limitations:['Content identity and lineage are not authenticity, permission or quality qualification.','Explicitly selecting an artifact does not make it the recommended or adopted version.','Host file operations and active profile loading require their own authority.']}
}
export function personaReplacement(delivery,currentPersona,direction){
 if(delivery?.format!=='duo-persona-delivery-v1'||!['adopt','rollback'].includes(direction))invalid('Expected a delivery and adopt or rollback')
 const original=snapshot(delivery.original),candidate=snapshot(delivery.candidate)
 const [expected,next]=direction==='adopt'?[original,candidate]:[candidate,original]
 if(typeof currentPersona!=='string'||sha(currentPersona)!==expected.version)throw new Error('DUO_COPY_CHANGED: Current file differs from the expected version; inspect it before requesting a new action')
 return {direction,expectedVersion:expected.version,resultingVersion:next.version,content:next.persona,authorityGranted:false,requires:'Current explicit host write authorization and same-session read/version guard; no automatic retry or deployment.'}
}
