// Headless bridge to DSH ToolRuntime, not an optimization engine or Agent.
// The Caller selects each public tool and its arguments; no workflow is scripted here.
import {readFileSync,writeFileSync} from 'node:fs'
import {describeFailure} from '@dual-loop/dsh-plugin/diagnostics'
export const name='duo-public-tool-app'
export const inject=['tools','appReady','appExit']
export function apply(ctx,config){
 ctx.effect(()=>ctx.appReady.onReady(()=>{
  void (async()=>{
   const request=JSON.parse(readFileSync(config.requestPath,'utf8'))
   let result
   if(request.tool==='schemas')result={isError:false,value:ctx.tools.schemas().filter(s=>s.name.startsWith('dualloop_'))}
   else{
    if(typeof request.tool!=='string'||!request.tool.startsWith('dualloop_'))throw new Error('Only public dualloop tools are exposed by this example app')
    const abort=new AbortController()
    if(request.cancelAfterMs===0)abort.abort()
    const timer=request.cancelAfterMs===undefined||request.cancelAfterMs===0?null:setTimeout(()=>abort.abort(),request.cancelAfterMs)
    try{
     const value=await ctx.tools.execute({name:request.tool,arguments:request.args??{},callId:request.id,signal:abort.signal})
     result={isError:value.isError,value:value.value??null,error:value.error?{message:value.error.message,info:value.error.info}:null,content:value.content}
    }finally{if(timer)clearTimeout(timer)}
   }
   writeFileSync(config.responsePath,JSON.stringify(result,null,2)+'\n',{flag:'wx'})
   ctx.appExit(result.isError?1:0)
  })().catch(error=>{writeFileSync(config.responsePath,JSON.stringify({isError:true,error:describeFailure(error,'public-tool-app')})+'\n',{flag:'wx'});ctx.appExit(1)})
 }))
}
