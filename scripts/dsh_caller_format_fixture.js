// Actual official DSH adapter with a wholly local synthetic HTTP transport.
// Deliberately different arm outputs exercise reporting, not model causality.
import {DeepSeekAdapter} from '@deepseek-ai/dsh-llm-deepseek'
export const name='duo-format-probe-fixture'
export const inject=['llm','deepseekLlmApiExtensions']
export function apply(ctx,config){
 const oldFetch=globalThis.fetch;let requests=0
 ctx.effect(()=>{
  globalThis.fetch=async(url,options)=>{
   if(url!=='https://offline.invalid/chat/completions'||++requests>2)throw new Error('Offline control forbids external or excess HTTP work')
   const body=JSON.parse(options.body),json=body.response_format?.type==='json_object'
   const delta=json?{content:'<｜｜DSML｜｜tool_calls>synthetic text control</｜｜DSML｜｜tool_calls>'}:{tool_calls:[{index:0,id:'probe-call',type:'function',function:{name:'cordis_inspect_query',arguments:'{"platform":"host","provider":"Service","method":"listService"}'}}]}
   const events=[{choices:[{delta,finish_reason:json?'stop':'tool_calls'}]}]
   if(!config.missingUsage)events.push({choices:[],usage:{prompt_tokens:100,prompt_cache_hit_tokens:20,completion_tokens:10,total_tokens:110}})
   return new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join('')+'data: [DONE]\n\n',{status:200,headers:{'Content-Type':'text/event-stream'}})
  }
  return ()=>{globalThis.fetch=oldFetch}
 })
 const adapter=new DeepSeekAdapter({options:()=>({baseURL:'https://offline.invalid',defaults:{thinking:'disabled'},models:[],defaultContextWindow:1000000,maxTokens:2048,streamIdleTimeoutMs:5000}),resolveApiKey:async()=>'offline-fake-only',resolveUserId:()=>'offline-format-control',prepareExtensions:r=>ctx.deepseekLlmApiExtensions.prepare(r)})
 ctx.llm.registerAdapter(['duo-format-fixture'],adapter)
}
