// Offline transport only; fixed answers never establish semantic competence.
import {readFileSync} from 'node:fs'
import {LlmAdapter} from '@deepseek-ai/dsh-llm'
import {digest} from '@dual-loop/dsh-plugin/contract'
export const name='duo-code-review-fixture'
export const inject=['llm']
export function apply(ctx,config){
 const fixtures=JSON.parse(readFileSync(config.gradesPath,'utf8'))
 if(!['normal','constant','uncertain','missing-usage','invalid-quote'].includes(config.scenario??'normal'))throw new Error('Unknown explicit fixture scenario')
 class Adapter extends LlmAdapter{
  async *stream(options){
   const body=JSON.parse(options.messages.filter(m=>m.role==='user').at(-1).content[0].text)
   const codes=Object.fromEntries(body.tasks.map(t=>[t.id,t.code])),frozen=fixtures[digest(codes)]
   if(!frozen)throw new Error('Fixture accepts the exact preregistered code specimens only')
   const grades=structuredClone(frozen)
   if(config.scenario==='invalid-quote')for(const grade of Object.values(grades))grade.contractQuote+=' ... This was not a contiguous source quotation.'
   if(config.scenario==='constant')for(const grade of Object.values(grades)){grade.verdict='pass';grade.counterexample=''}
   if(config.scenario==='uncertain')for(const grade of Object.values(grades)){grade.verdict='uncertain';grade.counterexample=''}
   yield {type:'text-delta',index:0,text:JSON.stringify(grades)}
   if(config.scenario!=='missing-usage')yield {type:'usage',usage:{inputTokens:80,cacheReadTokens:20,outputTokens:10,totalTokens:110}}
   yield {type:'finish',reason:{kind:'stop'}}
  }
 }
 ctx.llm.registerAdapter(['duo-offline'],new Adapter())
}
