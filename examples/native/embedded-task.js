// Caller-owned composition example: no private DUO service access, model calls,
// separate scheduler, retries or adoption. Load alongside the native DUO tools.
import {defineTool} from '@deepseek-ai/dsh-tools'
import {HarnessError} from '@deepseek-ai/dsh-llm'
export const name='duo-embedded-task-example'
export const inject=['tools']
export function apply(ctx){
 ctx.tools.register(defineTool({name:'duo_task',description:'Use an already inspected DUO plan as a task in this Agent flow, then return its structured run outcome and report. This does not grant permission or extra budget.',
  parameters:{planDigest:{type:'string',required:true,description:'Exact current digest already inspected through dualloop_plan; all work must be within current authorization.'}},
  output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
  isConcurrencySafe:()=>false,
  async execute(args,exec){
   let sequence=0
   const nested=async(name,arguments_)=>{
    const result=await ctx.tools.execute({callId:exec.callId+':duo:'+ ++sequence,rootCallId:exec.rootCallId,parent:exec.token,...exec.agent?{agent:exec.agent}:{},name,arguments:arguments_,signal:exec.signal})
    for(const context of result.additionalContexts??[])exec.deferContext(context)
    if(!result.isError&&result.concludesTurn)exec.concludeTurn()
    return result
   }
   const executed=await nested('dualloop_run',{planDigest:args.planDigest})
   if(executed.isError)throw new HarnessError(executed.error.message,executed.error.info?.code??'DUO_SUBTASK_FAILED')
   const run=executed.value
   if(run?.apiVersion!==2||run.runtime!=='dsh-native'||typeof run.runId!=='string'||!['completed','failed','cancelled'].includes(run.status))throw new HarnessError('DUO returned an invalid run identity; inspect retained state before new work','DUO_SUBTASK_RESULT_INVALID')
   if(executed.concludesTurn)return {kind:'duo_task_outcome',deliveryState:'TERMINAL_CHILD',run,report:null}
   const reported=await nested('dualloop_report',{runId:run.runId})
   // A report failure does not erase completed or failed work. The caller can
   // inspect this run ID without resubmitting an execution or assuming success.
   return {kind:'duo_task_outcome',deliveryState:reported.isError?'REPORT_UNAVAILABLE':'COMPLETE',run,report:reported.isError?null:reported.value,
    ...(reported.isError?{reportError:{code:reported.error.info?.code??'DUO_REPORT_FAILED',message:reported.error.message,nextAction:'Read the retained run ID and report; do not repeat work to repair delivery.'}}:{})}
  }
 }))
}
