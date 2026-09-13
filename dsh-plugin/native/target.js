import {readFileSync} from 'node:fs'
import {TargetService,fail} from './definitions.js'
import {digest} from './store.js'
export default class PersonaTarget extends TargetService {
 describe(){return {id:'persona_overlay_v1',version:'1',deterministic:true}}
 snapshot(path){let persona;try{persona=readFileSync(path,'utf8')}catch{fail('DUO_TARGET_MISSING','The baseline persona snapshot is unreadable')};if(!persona.trim())fail('DUO_TARGET_MISSING','The baseline persona is empty');return {id:'baseline',persona,version:digest(persona),path}}
 apply(candidate,parent){
  const d=candidate?.delta
  if(!candidate||typeof candidate.id!=='string'||!candidate.id||candidate.parentId!==parent.id||candidate.parentVersion!==parent.version||!['exploit','explore','innovate'].includes(candidate.mode)||typeof candidate.family!=='string'||!candidate.family||typeof candidate.hypothesis!=='string'||!candidate.hypothesis.trim()||!d||Object.keys(d).sort().join(',')!=='kind,persona,target'||d.kind!=='cordis-overlay'||d.target!=='system-prompt'||typeof d.persona!=='string'||!d.persona.trim())fail('DUO_DELTA_INVALID','Candidate must bind its parent and change only a complete persona overlay')
  for(const token of ['{{model}}','{{cwd}}'])if(parent.persona.includes(token)&&!d.persona.includes(token))fail('DUO_DELTA_INVALID','Candidate removed a required persona placeholder')
  return {...candidate,persona:d.persona,version:digest(d.persona)}
 }
}
