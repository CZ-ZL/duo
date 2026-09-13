// Explicitly synthetic example providers. No model, network or subprocess calls.
import {GeneratorService,ExecutorService,EvaluatorsService} from '@dual-loop/dsh-plugin/definitions'
export const name='duo-example-fixture-providers'
export async function apply(ctx,config={}){
 const money=config.currency==='CNY'?{currency:'CNY',costCny:0}:{costUsd:0}
 const descriptor=(id,extra={})=>({id,version:'1',...config.currency==='CNY'?{currency:'CNY',reservationCny:0}:{reservationUsd:0},permissions:{paid:false,network:false,externalSideEffects:false},evidenceKind:'fixture',...extra})
 class Generator extends GeneratorService{
  describe(){return descriptor(config.empty?'empty-fixture-generator':'fixture-generator',{noiseRepeat:!!config.noiseRepeat,observeWarmStart:!!config.observeWarmStart,distinctCandidates:!!config.distinctCandidates})}
  async propose({champion,quotas,nextId,feedback}){const candidates=[],sources=config.observeWarmStart?[...new Set((feedback?.warmStart?.records??[]).map(r=>r.source.runId))]:[];if(!config.empty)for(const [mode,n]of Object.entries(quotas))for(let i=0;i<n;i++)candidates.push({id:nextId(),parentId:champion.id,parentVersion:champion.version,mode,family:mode,hypothesis:sources.length?'Offline fixture consumed historical input from '+sources.join(', ')+'. No efficacy inference.':'Check the explicitly synthetic instruction predicate.',...(config.noiseRepeat?{repeat:{purpose:'noise_measurement',reason:'Explicit zero-cost functional repeat control; no statistical qualification.'}}:{}),delta:{kind:'cordis-overlay',target:'system-prompt',persona:champion.persona+(config.noiseRepeat?'':'\nanswer clearly')}});if(config.distinctCandidates)for(const c of candidates)c.delta.persona+='\nDistinct offline control '+c.id;return {candidates,...money,hostPid:process.pid}}
 }
 class Executor extends ExecutorService{
  describe(){return descriptor('fixture-executor',{waitForAbort:!!config.waitForAbort})}
  async execute({applied,signal}){if(config.waitForAbort)await new Promise((_,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true})});return {artifact:{text:applied.persona,pid:process.pid},...money}}
 }
 class Evaluators extends EvaluatorsService{
  describe(){return ['fast','slow','final'].map(tier=>descriptor('fixture-'+tier,{tier,dataId:tier,metrics:['quality','safe','sample_size'],tieAll:!!config.tieAll,failCandidates:!!config.failCandidates}))}
  async evaluate({candidate,artifact,tier}){return {candidateId:candidate.id,evaluatorId:'fixture-'+tier,version:'1',dataId:tier,tier,ok:!config.failCandidates||candidate.id==='baseline',metrics:{quality:config.tieAll?.5:artifact.text.includes('answer clearly')?1:0,safe:true,sample_size:2},...money,evidence:[{kind:'static_fixture',hostPid:artifact.pid}]}}
 }
 // Deliberately incomplete negative control used only by the offline verifier.
 if(config.missingGeneratorMethod)Generator.prototype.propose=GeneratorService.prototype.propose
 if(config.generator!==false)await ctx.plugin(Generator);await ctx.plugin(Executor);if(config.evaluators!==false)await ctx.plugin(Evaluators)
}
