// Offline acceptance of existing DSH filesystem capabilities on an owned copy.
// No user profile is changed and no autonomous model decision is simulated.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {LlmAdapter} from '@deepseek-ai/dsh-llm'
import {preparePersonaDelivery,personaReplacement} from './adoption.js'
export const name='duo-adoption-host-verification'
export const inject=['agents','llm','tools','fs','appReady','appExit']
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
export function apply(ctx,config){
 const checks=[],calls=[];let modelAttempts=0,handle
 const signal=new AbortController().signal,copy=join(config.outputDir,'isolated-persona.txt'),artifact=join(config.outputDir,'persona-delivery.json')
 const save=(file,value)=>writeFileSync(join(config.outputDir,file),JSON.stringify(value,null,2)+'\n')
 const check=(label,value)=>{assert.ok(value,label);checks.push(label)}
 const value=result=>{assert.equal(result.isError,false,JSON.stringify(result.error));return result.value}
 const call=async(name,args={},agent)=>{const result=await ctx.tools.execute({name,arguments:args,callId:'adoption-'+(calls.length+1),signal,...agent?{agent}:{} });calls.push({name,args,sessionId:agent?.session.id??null,result});save('calls.json',calls);return result}
 class NoModels extends LlmAdapter{async *stream(){modelAttempts++;throw new Error('No model calls authorized in offline adoption acceptance')}}
 ctx.llm.registerAdapter(['duo-adoption-offline'],new NoModels())
 async function run(){
  const plan=value(await call('dualloop_plan')),original=readFileSync(plan.spec.target.path)
  const result=value(await call('dualloop_run',{planDigest:plan.planDigest})),status=value(await call('dualloop_status',{runId:plan.runId})),report=value(await call('dualloop_report',{runId:plan.runId}))
  save('plan.json',plan);save('public-status.json',status);save('product-report.json',report)
  const candidateId=report.candidates.find(c=>c.id!=='baseline'&&c.delta&&c.version&&c.parentId==='baseline').id
  const delivery=preparePersonaDelivery(status,candidateId);save('persona-delivery.json',delivery)
  check('public native artifacts bind original content, candidate and complete parent lineage',delivery.original.version===sha(original)&&delivery.lineage.at(-1).id===candidateId&&delivery.lineage[0].version===plan.baseline.version)
  check('exporting an artifact does not authorize adoption or certify fixture improvement',delivery.authorityGranted===false&&delivery.improvementProven===false&&result.evidenceKind==='fixture')
  writeFileSync(copy,original,{flag:'wx'})
  handle=await ctx.agents.create({sessionId:'duo-isolated-adoption',signal,agentOptions:{provider:'duo-adoption-offline',model:'no-requests'},setup(c){
   c.tools.restrict({allow:['read','write']})
   c.tools.guard(exec=>{
    if(exec.name==='read')return [copy,artifact].includes(exec.arguments.file_path)?undefined:'Read outside the isolated adoption scope'
    return exec.name==='write'&&exec.arguments.file_path===copy&&[delivery.original.persona,delivery.candidate.persona].includes(exec.arguments.content)?undefined:'Write outside the explicitly authorized isolated copy and two versions'
   })
  }})
  const agent=handle.agent,read=path=>call('read',{file_path:path,limit:2000},agent),write=content=>call('write',{file_path:copy,content},agent)
  const unseen=await write(delivery.candidate.persona)
  check('DSH observation policy refuses overwrite before reading in the same Agent session',unseen.isError&&/read|observ/i.test(unseen.error.message)&&sha(readFileSync(copy))===delivery.original.version)
  const artifactRead=value(await read(artifact)),loaded=JSON.parse(artifactRead.lines.map(l=>l.text).join('\n'))
  check('candidate artifact is actually read through the host public read tool',loaded.candidate.version===delivery.candidate.version&&sha(loaded.candidate.persona)===delivery.candidate.version)
  value(await read(copy))
  const copied=await ctx.fs.readText(await ctx.fs.resolve(copy),signal),adopt=personaReplacement(loaded,copied,'adopt')
  // Deliberate local concurrent-writer control on our copy, never the source.
  const changed=copied+'\nConcurrent writer control.';writeFileSync(copy,changed)
  const stale=await write(adopt.content)
  check('DSH rejects a write whose same-session observation is stale without overwriting concurrent bytes',stale.isError&&/changed|stale/i.test(stale.error.message)&&readFileSync(copy,'utf8')===changed)
  assert.throws(()=>personaReplacement(loaded,changed,'adopt'),/DUO_COPY_CHANGED/)
  check('changed current original also refuses the application-level content check',readFileSync(copy,'utf8')===changed)
  // End of concurrent-writer control. Reset only the explicitly owned fixture;
  // the adoption and rollback themselves below go through native write.
  writeFileSync(copy,original);value(await read(copy))
  const adopted=value(await write(personaReplacement(loaded,await ctx.fs.readText(await ctx.fs.resolve(copy),signal),'adopt').content))
  value(await read(copy));const adoptedBytes=readFileSync(copy)
  check('native guarded write adopts exactly the exported candidate into the isolated copy',adopted.operation==='update'&&sha(adoptedBytes)===delivery.candidate.version)
  save('adopted-snapshot.json',{path:copy,persona:adoptedBytes.toString('utf8'),version:sha(adoptedBytes),hostWrite:adopted})
  const denied=await call('write',{file_path:plan.spec.target.path,content:delivery.candidate.persona},agent)
  check('Agent-scoped authority refuses writing the original Target',denied.isError&&readFileSync(plan.spec.target.path).equals(original))
  const rolledBack=value(await write(personaReplacement(loaded,await ctx.fs.readText(await ctx.fs.resolve(copy),signal),'rollback').content))
  value(await read(copy))
  check('native guarded write restores exact original bytes from the preserved artifact',rolledBack.operation==='update'&&readFileSync(copy).equals(original))
  save('rollback-snapshot.json',{path:copy,version:sha(readFileSync(copy)),hostWrite:rolledBack})
  const after=value(await call('dualloop_status',{runId:plan.runId}))
  check('adoption and rollback do not rerun DUO or change its Journal and settled budget',JSON.stringify(after)===JSON.stringify(status))
  check('original Target remains byte-identical after the full isolated procedure',readFileSync(plan.spec.target.path).equals(original))
  await handle.dispose();handle=null
  check('no model request or retained Agent was created by file adoption',modelAttempts===0&&ctx.agents.list().length===0)
  save('receipt.json',{status:'PASS',host:'actual named DSH profile with fs-local, fs-observation-policy and tool-fs',scenario:'adoption',checks,toolCalls:calls.length,modelSessions:0,paidCalls:0,currency:'CNY',costCny:0,sourceRunId:plan.runId,sourceCandidateId:candidateId,originalVersion:delivery.original.version,candidateVersion:delivery.candidate.version,restoredVersion:sha(readFileSync(copy)),activeUserProfileAdoption:'NOT_RUN',independentCallerVerified:false,improvementProven:false})
 }
 ctx.effect(()=>ctx.appReady.onReady(()=>{void run().then(()=>ctx.appExit(0),async error=>{if(handle)await handle.dispose();save('receipt.json',{status:'FAIL',checks,error:{name:error.name,message:error.message},toolCalls:calls.length,modelAttempts});ctx.appExit(1)})}))
}
