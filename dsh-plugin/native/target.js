import {readFileSync} from 'node:fs'
import {TargetService,fail} from './definitions.js'
import {digest} from './store.js'
import {targetCapability} from './capabilities.js'
export function projectPersonaDelta(delta){
 if(!delta||delta.kind!=='cordis-overlay'||delta.target!=='system-prompt'||typeof delta.persona!=='string'||!delta.persona.trim())fail('DUO_HISTORY_INVALID','Expected a historical persona overlay')
 return {kind:delta.kind,target:delta.target,persona:delta.persona}
}
export const personaHistory={
 identity:snapshot=>digest(snapshot.persona),
 validateSnapshot:snapshot=>!!(snapshot&&typeof snapshot.id==='string'&&typeof snapshot.persona==='string'&&snapshot.persona.trim()&&snapshot.version===digest(snapshot.persona)),
 projectDelta:projectPersonaDelta,
 apply:(candidate,parent)=>PersonaTarget.prototype.apply(candidate,parent)
}
export default class PersonaTarget extends TargetService {
 describe(){return {id:'persona_overlay_v1',version:'1',deterministic:true,targetKinds:['dsh-persona'],capability:targetCapability('dsh-persona')}}
 snapshot(path){let persona;try{persona=readFileSync(path,'utf8')}catch{fail('DUO_TARGET_MISSING','The baseline persona snapshot is unreadable')};if(!persona.trim())fail('DUO_TARGET_MISSING','The baseline persona is empty');return {id:'baseline',persona,version:digest(persona),path}}
 identity(snapshot){return personaHistory.identity(snapshot)}
 validateSnapshot(snapshot){return personaHistory.validateSnapshot(snapshot)}
 projectDelta(delta){return projectPersonaDelta(delta)}
 apply(candidate,parent){
  const d=candidate?.delta
  if(!candidate||typeof candidate.id!=='string'||!candidate.id||candidate.parentId!==parent.id||candidate.parentVersion!==parent.version||!['exploit','explore','innovate'].includes(candidate.mode)||typeof candidate.family!=='string'||!candidate.family||typeof candidate.hypothesis!=='string'||!candidate.hypothesis.trim()||!d||Object.keys(d).sort().join(',')!=='kind,persona,target'||d.kind!=='cordis-overlay'||d.target!=='system-prompt'||typeof d.persona!=='string'||!d.persona.trim())fail('DUO_DELTA_INVALID','Candidate must bind its parent and change only a complete persona overlay')
  for(const token of ['{{model}}','{{cwd}}'])if(parent.persona.includes(token)&&!d.persona.includes(token))fail('DUO_DELTA_INVALID','Candidate removed a required persona placeholder')
  return {...candidate,persona:d.persona,version:digest(d.persona)}
 }
}
