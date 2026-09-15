// Known transport replies, not real model quality or billing evidence.
import {LlmAdapter} from '@deepseek-ai/dsh-llm'
import {readFileSync} from 'node:fs'
export const name='duo-code-model-fixture'
export const inject=['llm']
export function apply(ctx,config){
 const answers=JSON.parse(readFileSync(config.answersPath,'utf8'))
 class Adapter extends LlmAdapter {
  async *stream(options){
   const prompt=JSON.parse(options.messages.filter(m=>m.role==='user').at(-1).content[0].text)
   const result=Object.fromEntries(prompt.tasks.map(t=>{
    if(typeof answers[t.id]!=='string')throw new Error('No predeclared reply for this task')
    return [t.id,answers[t.id]]
   }))
   yield {type:'text-delta',index:0,text:JSON.stringify(result)}
   yield {type:'usage',usage:{inputTokens:80,cacheReadTokens:20,outputTokens:10,totalTokens:110}}
   yield {type:'finish',reason:{kind:'stop'}}
  }
 }
 ctx.llm.registerAdapter(['duo-offline'],new Adapter())
}
