// Synthetic transport for separate engineering controls, never real efficacy.
import {LlmAdapter} from '@deepseek-ai/dsh-llm'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
export const name='code-method-offline-transport'
export const inject=['llm']
export function apply(ctx,config){
 const key=JSON.parse(readFileSync(join(config.pack,'answer-key.json')))
 // Intentionally restricted to the standalone engineering corpus. The held-out
 // benchmark final is never executed through this fixture.
 if(key.version!=='code-engineering-control-v1'||Object.keys(key.tasks).some(id=>!id.startsWith('engineering-')))throw new Error('Code method fixture only accepts the separate engineering corpus')
 class Adapter extends LlmAdapter{
  async *stream(options){
   const input=JSON.parse(options.messages.filter(m=>m.role==='user').at(-1).content[0].text)
   const value=input.slots?{candidates:input.slots.map(slot=>({slot:slot.slot,hypothesis:'Predeclared structural engineering control, not learned benefit',change:
    slot.mode==='exploit'?{suffix:'ENGINEERING_CANDIDATE generation '+input.generation+' '+slot.slot}:
    slot.mode==='explore'?{persona:'ENGINEERING_CANDIDATE generation '+input.generation+' '+slot.slot+' '+['{{model}}','{{cwd}}'].filter(x=>input.champion.persona.includes(x)).join(' ')}:
    {components:['ENGINEERING_CANDIDATE generation '+input.generation+' '+slot.slot,'Check the requested function interface.']}}))}:
    input.quotas?{candidates:Object.entries(input.quotas).flatMap(([mode,n])=>Array.from({length:n},(_,i)=>({mode,family:mode,
    hypothesis:'Predeclared fixture improvement; no model optimization inference',persona:input.champion.persona+'\nENGINEERING_CANDIDATE generation '+input.generation+' '+i})))}:
    Object.fromEntries(input.tasks.map(({id})=>{const row=key.tasks[id];if(!row)throw new Error('Unknown control task')
     const baseline=!String(options.system).includes('ENGINEERING_CANDIDATE')
     return [id,baseline&&['engineering-slow-0','engineering-final-0'].includes(id)?'def task_func(): return -1':row.code_prompt+row.canonical_solution]}))
   yield {type:'text-delta',index:0,text:JSON.stringify(value)}
   yield {type:'usage',usage:{inputTokens:80,cacheReadTokens:20,outputTokens:10,totalTokens:110}}
   yield {type:'finish',reason:{kind:'stop'}}
  }
 }
 ctx.llm.registerAdapter(['duo-offline'],new Adapter())
}
