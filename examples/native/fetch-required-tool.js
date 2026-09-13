// Opt-in for a NEW inspected diagnostic profile. Not loaded by the frozen v1 run.
// The model still supplies tool arguments; existing URL and one-read guards apply.
export const name='fetch-required-tool-v1'
export const inject=['deepseekLlmApiExtensions']
export function requiredFetchField(request){
 if(!request.sessionId?.startsWith('duo-'))return
 const tools=request.body?.tools??[]
 if(!tools.some(t=>t.function?.name==='web_fetch'))return
 if(tools.length!==1||request.body.thinking?.type!=='disabled')
  throw new Error('Required fetch is limited to one named tool in non-thinking mode')
 return {value:{type:'function',function:{name:'web_fetch'}}}
}
export function apply(ctx){
 ctx.deepseekLlmApiExtensions.register('tool_choice',{prepare:requiredFetchField})
}
