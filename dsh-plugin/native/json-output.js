import {mkdirSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import Schema from '@deepseek-ai/schemastery'

export const name='duo-json-output'
export const inject=['deepseekLlmApiExtensions']
export const Config=Schema.object({artifactRoot:Schema.string().required(),includeCallerSessions:Schema.boolean().default(false)})
export function apply(ctx,config){
 const root=resolve(config.artifactRoot),callerRequests=new Map()
 ctx.deepseekLlmApiExtensions.register('response_format',{
  prepare(request){
   if(request.purpose)return
   const caller=config.includeCallerSessions&&/^duo-caller-[a-f0-9-]{36}$/.test(request.sessionId??'')
   if(!caller&&!/^duo-[a-f0-9-]{36}$/.test(request.sessionId??''))return
   const requestIndex=caller?(callerRequests.get(request.sessionId)??0)+1:null
   if(caller)callerRequests.set(request.sessionId,requestIndex)
   const filename=caller?request.sessionId+'-'+requestIndex+'.json':request.sessionId+'.json'
   const value={type:'json_object'}
   return {value,accept(){
    mkdirSync(root,{recursive:true})
    writeFileSync(join(root,filename),JSON.stringify({sessionId:request.sessionId,...caller?{requestIndex}:{},field:'response_format',value,accepted:true,acceptedAt:new Date().toISOString(),meaning:'HTTP 2xx accepted; this is not proof of valid JSON or completed output.'},null,2)+'\n',{flag:'wx'})
   }}
  }
 })
}
