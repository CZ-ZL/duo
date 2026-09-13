// Offline external-model boundary only. The Agent loop/host/providers are real.
import {LlmAdapter} from '@deepseek-ai/dsh-llm'
import {readFileSync} from 'node:fs'
export const name='duo-model-fixture'
export const inject=['llm']
export function apply(ctx,config={}){
 const gold=config.scenario==='improve'?Object.fromEntries(Object.values(JSON.parse(readFileSync(config.datasetPath,'utf8'))).filter(s=>s?.tasks).flatMap(s=>s.tasks.map(t=>[t.id,t.expected]))):null
 class Adapter extends LlmAdapter {
  async *stream(options){
   const input=JSON.parse(options.messages.filter(m=>m.role==='user').at(-1).content[0].text)
   const answer=input.quotas?{candidates:Object.entries(input.quotas).flatMap(([mode,n])=>Array.from({length:n},()=>({mode,family:mode,hypothesis:'Fixture only: exercise two complete generations',persona:input.champion.persona+'\nUse supplied sources and cite them.'})))}:Object.fromEntries((input.tasks??[]).map(t=>{
    const e=gold&&options.system.includes('Use supplied sources and cite them.')?gold[t.id]:null
    return [t.id,e?{answer:e.type==='abstention'?'This feature does not exist.':e.answerKeys.join(' '),citations:e.goldFiles}:{answer:'fixture answer',citations:[]}]
   }))
   yield {type:'text-delta',index:0,text:JSON.stringify(answer)}
   if(config.scenario!=='missing-usage')yield {type:'usage',usage:{inputTokens:80,cacheReadTokens:20,outputTokens:10,totalTokens:110}}
   if(config.scenario==='cancel'){
    if(!options.signal.aborted)await new Promise(r=>options.signal.addEventListener('abort',r,{once:true}))
    yield {type:'finish',reason:{kind:'aborted'}}
   }else yield {type:'finish',reason:{kind:'stop'}}
  }
 }
 ctx.llm.registerAdapter(['duo-offline'],new Adapter())
}
