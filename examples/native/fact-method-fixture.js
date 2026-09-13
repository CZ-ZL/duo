// Explicit offline transport control: real native measurement, synthetic outputs.
import {LlmAdapter} from '@deepseek-ai/dsh-llm'
import {readFileSync} from 'node:fs'
export const name='fact-method-offline-transport'
export const inject=['llm']
export function apply(ctx,config){
 const key=JSON.parse(readFileSync(config.answerKeyPath,'utf8')),answers=Object.assign({},...Object.values(key.splits))
 class Adapter extends LlmAdapter{
  async *stream(options){
   const input=JSON.parse(options.messages.filter(m=>m.role==='user').at(-1).content[0].text)
   const value=input.quotas?{candidates:Object.entries(input.quotas).flatMap(([mode,n])=>Array.from({length:n},(_,i)=>({mode,family:mode,
    hypothesis:'Offline operation control, no efficacy inference',persona:input.champion.persona+'\nDistinct offline generation '+input.generation+' '+i})))}:
    Object.fromEntries(input.tasks.map(({id})=>{const k=answers[id];return [id,{answer:String(k.answer),unit:k.unit,abstain:k.abstain,citations:k.support.map(x=>x.source),evidence:k.support}]}))
   yield {type:'text-delta',index:0,text:JSON.stringify(value)}
   yield {type:'usage',usage:{inputTokens:80,cacheReadTokens:20,outputTokens:10,totalTokens:110}}
   yield {type:'finish',reason:{kind:'stop'}}
  }
 }
 ctx.llm.registerAdapter(['duo-offline'],new Adapter())
}
