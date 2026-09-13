import {ExecutorService,fail} from './definitions.js'
import {modelSettings,modelDescriptor,runModelAgent} from './model-call.js'

export default class ModelExecutor extends ExecutorService {
 static inject=['agents','llm','systemPrompt','tools']
 constructor(ctx,config){
  super(ctx);this.state=modelSettings(config)
  if(!['docs-citations-v1','python-code-v1'].includes(this.state.dataset.responseMode??'docs-citations-v1'))
   fail('DUO_DATA_INVALID','Unknown dataset responseMode; use docs-citations-v1 or python-code-v1')
 }
 describe(){return modelDescriptor('dsh-agent-executor',this.state)}
 async execute({candidate,applied,tier,signal}){
  if(typeof tier!=='string'||!this.state.dataset[tier]?.tasks)fail('DUO_DATA_INVALID','Executor tier must name a configured data split')
  if(!applied||applied.id!==candidate?.id||typeof applied.persona!=='string'||!applied.persona.trim())fail('DUO_DELTA_INVALID','Executor requires an applied persona candidate')
  const split=this.state.dataset[tier]
  if(this.state.dataset.responseMode==='python-code-v1'){
   const instruction=(this.state.dataset.responseInstructions??'Implement each task independently.')+
    ' Return ONLY one JSON object mapping every task id to a Python source code string containing a complete implementation, including imports. Do not include Markdown fences or explanations.'
   const prompt=JSON.stringify({instruction,tasks:split.tasks.map(({id,input})=>({id,input}))})
   return runModelAgent(this.ctx,this.state.config,{persona:applied.persona,prompt,signal,
    identity:{operation:'execute',candidateId:candidate.id,candidateVersion:applied.version,tier,dataId:split.id,datasetDigest:this.state.datasetDigest}})
  }
  const instruction=(this.state.dataset.responseInstructions??'Answer each task independently. Return ONLY one JSON object mapping each task id to its answer. Do not omit any task.')+' For citations, copy only the exact path strings in sourcePaths; never append line numbers, parentheses, snapshot hashes, or commentary. Return citations as a JSON array of those path strings.'
  // These are public SOURCE marker paths, never private gold citations/keys.
  const prompt=JSON.stringify({instruction,tasks:split.tasks.map(({id,input})=>({id,input,sourcePaths:[...new Set([...input.matchAll(/^SOURCE: (.+?) \(lines /gm)].map(m=>m[1]))]}))})
  return runModelAgent(this.ctx,this.state.config,{persona:applied.persona,prompt,signal,
   identity:{operation:'execute',candidateId:candidate.id,candidateVersion:applied.version,tier,dataId:split.id,datasetDigest:this.state.datasetDigest}})
 }
}
