import {readFileSync} from 'node:fs'
import {TargetService,fail} from './definitions.js'
import {digest} from './store.js'
import {targetCapability} from './capabilities.js'

export const fetchPlugin='@deepseek-ai/dsh-web-fetch-http'
export const fetchBounds=Object.freeze({minimum:50000,maximum:200000})
export function validateFetchConfig(config){
 const keys=['maxBodyChars','maxRedirects','maxResponseBytes','timeoutMs','userAgent']
 if(!config||Object.keys(config).sort().join(',')!==keys.sort().join(',')||
  !Number.isSafeInteger(config.maxBodyChars)||config.maxBodyChars<fetchBounds.minimum||config.maxBodyChars>fetchBounds.maximum||
  config.maxResponseBytes!==5000000||config.maxRedirects!==5||config.timeoutMs!==30000||
  config.userAgent!=='deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)')
  fail('DUO_DELTA_INVALID','Only maxBodyChars in [50000,200000] may change; all other fetch defaults remain fixed')
 return structuredClone(config)
}
export function projectConfigDelta(delta){
 if(!delta||delta.kind!=='plugin-config-replace-v1'||delta.target!==fetchPlugin)fail('DUO_HISTORY_INVALID','Expected a historical fetch configuration Delta')
 return {kind:delta.kind,target:delta.target,config:validateFetchConfig(delta.config)}
}
export default class FetchConfigTarget extends TargetService {
 describe(){return {id:'fetch-config-target',version:'1',deterministic:true,targetKinds:['dsh-plugin-config'],capability:targetCapability('dsh-plugin-config'),plugin:fetchPlugin,mutableFields:['maxBodyChars'],bounds:fetchBounds,adoption:false}}
 snapshot(path){
  let input;try{input=JSON.parse(readFileSync(path,'utf8'))}catch{fail('DUO_TARGET_MISSING','Unreadable fetch configuration snapshot')}
  if(Object.keys(input).sort().join(',')!=='config,persona,plugin'||input.plugin!==fetchPlugin||typeof input.persona!=='string'||!input.persona.trim())fail('DUO_DELTA_INVALID','Fetch target requires exactly plugin, persona and config')
  const config=validateFetchConfig(input.config)
  return {id:'baseline',path,persona:input.persona,config,version:digest({persona:input.persona,config})}
 }
 identity(snapshot){return digest({persona:snapshot.persona,config:snapshot.config})}
 validateSnapshot(snapshot){
  try{return !!(snapshot&&typeof snapshot.id==='string'&&typeof snapshot.persona==='string'&&snapshot.persona.trim()&&validateFetchConfig(snapshot.config)&&snapshot.version===this.identity(snapshot))}catch{return false}
 }
 projectDelta(delta){return projectConfigDelta(delta)}
 apply(candidate,parent){
  const d=candidate?.delta
  if(typeof candidate?.id!=='string'||!candidate.id||candidate.parentId!==parent.id||candidate.parentVersion!==parent.version||
   !['exploit','explore','innovate'].includes(candidate.mode)||typeof candidate.family!=='string'||!candidate.family||
   typeof candidate.hypothesis!=='string'||!candidate.hypothesis.trim()||!d||Object.keys(d).sort().join(',')!=='config,kind,target'||
   d.kind!=='plugin-config-replace-v1'||d.target!==fetchPlugin)fail('DUO_DELTA_INVALID','Configuration Delta must bind its parent and exact plugin identity')
  validateFetchConfig(parent.config)
  const config=validateFetchConfig(d.config)
  return {...candidate,persona:parent.persona,config,version:digest({persona:parent.persona,config})}
 }
}
