// Actual DSH host verification app. Trusted offline fixtures; control profiles
// additionally run an existing external validator on fixed control outputs.
import assert from 'node:assert/strict'
import {writeFileSync,existsSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import childProcess from 'node:child_process'
import {syncBuiltinESMExports} from 'node:module'
import WeightedComparator from '@dual-loop/dsh-plugin/comparator'
import {inspectProviderContracts,providerContractDependencies} from '@dual-loop/dsh-plugin/provider-contract'
export const name='duo-native-host-verification'
export const inject=['tools','appReady','appExit','loader']
export function apply(ctx,config){
 const exit=ctx.appExit,checks=[],calls=[]
 const save=(file,value)=>writeFileSync(join(config.outputDir,file),JSON.stringify(value,null,2)+'\n')
 const check=(label,value)=>{assert.ok(value,label);checks.push(label)}
 const call=async(name,args={},signal=new AbortController().signal)=>{const result=await ctx.tools.execute({callId:'native-'+(calls.length+1),name,arguments:args,signal});calls.push({name,args,result});save('calls.json',calls);return result}
 const value=result=>{assert.equal(result.isError,false,JSON.stringify(result.error));return result.value}
 async function run(){
  const childMethods=['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'],original=Object.fromEntries(childMethods.map(k=>[k,childProcess[k]]));let attempts=0
  for(const k of childMethods)childProcess[k]=()=>{attempts++;throw new Error('Native DUO must not start a child process')}
  syncBuiltinESMExports()
  try{
   const schemas=ctx.tools.schemas();save('schemas.json',schemas)
   const product=value(await call('dualloop_describe'))
   check('onboarding describes native CNY schema and execution readiness reflects actual provider bindings',product.contractSchema.properties.budget.properties.currency.const==='CNY'&&product.executionReady===['duoGenerator','duoExecutor','duoEvaluators'].every(k=>product.runtimeAvailability?.services?.[k]==='PRESENT'))
   const partial=value(await call('dualloop_design',{draft:{id:'incomplete'},experimentPath:join(config.outputDir,'draft.json')}))
   check('draft helper reports missing inputs without creating run artifacts',partial.status==='needs_input'&&!existsSync(config.runsRoot))
   if(config.scenario==='onboarding'){
    const vague=value(await call('dualloop_design',{draft:{},experimentPath:join(config.outputDir,'draft.json'),context:{intent:'Help me improve this agent'}}));save('vague-preparation.json',vague)
    check('unclear intent gets bounded preparation without fabricated objectives or execution',vague.preparation.startingPoint==='unclear_objective'&&vague.preparation.goalOptions.length===0&&vague.authorityGranted===false&&!existsSync(config.runsRoot))
    const samples=value(await call('dualloop_design',{draft:{target:{kind:'dsh-persona',path:'/project/persona.txt'}},experimentPath:join(config.outputDir,'draft.json'),context:{resources:[{kind:'samples',ref:'/project/examples.json',readAuthorized:true}]}}));save('missing-evaluator-preparation.json',samples)
    check('missing evaluator preparation gives sourced suggestions and executable build conditions',samples.preparation.startingPoint==='missing_evaluator'&&samples.preparation.goalOptions[0].sourceRefs[0]==='/project/examples.json'&&samples.preparation.actions.some(a=>a.requiredChecks?.includes('known_correct_and_incorrect_controls')))
    check('preparation does not repeatedly ask for the supplied target or claim provider qualification',!samples.preparation.questions.some(q=>q.field==='target')&&samples.preparation.providerCompatibility==='NOT_CHECKED')
    check('onboarding survives missing work providers',!schemas.some(s=>s.name==='dualloop_run')&&product.providerContracts.EvaluatorsService.method==='evaluate')
    check('onboarding uses no child processes',attempts===0)
    save('receipt.json',{status:'PASS',host:'actual named DSH profile',scenario:config.scenario,hostPid:process.pid,checks,toolCalls:calls.length,childProcessAttempts:attempts,paidCalls:0,modelSessions:0});return
   }
   check('six native tools registered',['dualloop_discover','dualloop_plan','dualloop_run','dualloop_status','dualloop_budget_status','dualloop_budget_reconcile'].every(n=>schemas.some(s=>s.name===n)))
   if(config.scenario==='missing-interface'){
    const refused=await call('dualloop_plan')
    check('inherited abstract work method is rejected through actual DSH plan tool',refused.isError&&refused.error.info.code==='DUO_PROVIDER_INTERFACE')
    check('interface failure identifies the component and method before creating a run',refused.error.message.includes('duoGenerator')&&refused.error.message.includes('propose')&&!existsSync(config.runsRoot))
    check('interface validation invokes no child work',attempts===0)
    save('receipt.json',{status:'PASS',host:'actual named DSH profile',scenario:config.scenario,expectedOutcome:'PLAN_REJECTED_MISSING_IMPLEMENTATION',hostPid:process.pid,checks,toolCalls:calls.length,childProcessAttempts:attempts,paidCalls:0,modelSessions:0});return
   }
   if(config.scenario==='missing-dependency'){
    const preparation=value(await call('dualloop_design',{draft:JSON.parse(readFileSync(config.experimentPath,'utf8')),experimentPath:config.experimentPath}));save('dependency-preparation.json',preparation)
    check('preparation identifies the declared missing dependency',preparation.evaluators.matches.fast.issues.includes('dependency:duo-intentionally-missing-evaluator-dependency'))
    const rejected=await call('dualloop_plan')
    check('actual plan refuses before invoking external measurement',rejected.isError&&rejected.error.info.code==='DUO_EVALUATOR_DEPENDENCY'&&!existsSync(config.runsRoot))
    check('dependency diagnosis creates no child process',attempts===0)
    save('receipt.json',{status:'PASS',host:'actual named DSH profile',scenario:config.scenario,expectedOutcome:'PLAN_REJECTED_MISSING_DEPENDENCY',hostPid:process.pid,checks,toolCalls:calls.length,childProcessAttempts:attempts,paidCalls:0,modelSessions:0});return
   }
   const discovery=value(await call('dualloop_discover'))
   check('native service composition discovered',discovery.runtime==='dsh-native'&&discovery.services.includes('duoController'))
   const plan=value(await call('dualloop_plan'));save('plan.json',plan)
   const inspection=await ctx.inject(providerContractDependencies(plan.spec),child=>assert.deepEqual(inspectProviderContracts(child,plan.spec),plan.providers))
   await inspection.dispose()
   check('public provider checker shares plan declarations without creating a Journal',!existsSync(config.runsRoot))
   if(config.scenario==='byo')check('history feedback replacement is active before any work',plan.providers.policies.duoFeedback.id==='conservative_history_feedback')
   check('plan reads without creating artifacts',!existsSync(config.runsRoot))
   const missing=await call('dualloop_run')
   check('missing plan refuses without launching a run',missing.isError&&!existsSync(config.runsRoot))
   const invalid=await call('dualloop_run',{planDigest:123})
   check('native DSH argument validation rejects invalid digest',invalid.isError)
   let result
   if(config.scenario==='cancel'){
    const abort=new AbortController();const pending=call('dualloop_run',{planDigest:plan.planDigest},abort.signal);setTimeout(()=>abort.abort(),25)
    const cancelled=await pending
    // DSH may classify the aborted tool result natively; durable state is authoritative.
    const state=value(await call('dualloop_status',{runId:plan.runId}))
    result=state.result
    check('cancellation remains durable and uncertain',result?.status==='cancelled'&&(state.budget.costCny===null||state.budget.costUsd===null))
    check('cancelled work never returns success',cancelled.isError||cancelled.value?.status==='cancelled')
   }else if(config.scenario==='evaluation-failure'){
    result=value(await call('dualloop_run',{planDigest:plan.planDigest}))
    check('failure control stops at its frozen limit with known zero-CNY settlement',result.status==='failed'&&result.stopReason==='DUO_EVALUATION_FAILURE_LIMIT'&&result.budget.operations===9&&result.budget.costCny===0)
   }else{
    if(config.scenario==='resume'){
     const baseline=value(await call('dualloop_run',{planDigest:plan.planDigest,pauseAfter:'baseline'}));save('paused-baseline.json',baseline)
     check('public run pauses after settled baseline without final or generation',baseline.status==='paused'&&baseline.generationsRun===0&&baseline.final.length===0&&baseline.budget.operations===4)
     const saved=value(await call('dualloop_status',{runId:plan.runId})),partial=value(await call('dualloop_report',{runId:plan.runId}));save('paused-report.json',partial)
     check('paused status has a resumable checkpoint and partial deterministic report',saved.checkpoint.resumable&&partial.delivery.artifacts.state==='PARTIAL_REPORT_RENDERED'&&partial.diagnostics.recovery.resumeSupported)
     const blind=await call('dualloop_run',{planDigest:plan.planDigest});check('paused run requires explicit checkpoint continuation',blind.isError&&blind.error.info.code==='DUO_RESUME_REQUIRED')
     const generation=value(await call('dualloop_run',{planDigest:plan.planDigest,resumeFrom:baseline.checkpointDigest,pauseAfter:'generation'}));save('paused-generation.json',generation)
     check('public continuation executes one generation and preserves original baseline attempts',generation.status==='paused'&&generation.generationsRun===1&&generation.stageAttempts.fast===2&&generation.final.length===0)
     const stale=await call('dualloop_run',{planDigest:plan.planDigest,resumeFrom:baseline.checkpointDigest});check('stale checkpoint refuses without new work',stale.isError&&stale.error.info.code==='DUO_CHECKPOINT_CHANGED')
     result=value(await call('dualloop_run',{planDigest:plan.planDigest,resumeFrom:generation.checkpointDigest}))
     const terminal=value(await call('dualloop_status',{runId:plan.runId}))
     check('original start time and deadline survive both public continuations',terminal.run.started===saved.run.started&&terminal.checkpoint.deadlineAt===saved.checkpoint.deadlineAt)
     check('continuation records two ownership transitions and one original plan',terminal.events.filter(e=>e.kind==='resumed').length===2&&terminal.events.filter(e=>e.kind==='plan').length===1)
    }else{
    result=value(await call('dualloop_run',{planDigest:plan.planDigest}))
    }
    check('protocol completes in the DSH process',result.runtime==='dsh-native'&&result.status==='completed')
    check('configured native operation determines outcome',result.conclusion===(['alternate','evaluate','controls','constant-controls','noise-repeat','no-progress'].includes(config.scenario)?'retain_baseline':'recommend_candidate'))
    check('all final evidence was produced in this host',result.final.every(r=>r.evidence.every(e=>e.hostPid===process.pid)))
    check('fixture does not claim optimization efficacy',result.improvementProven===false&&result.evidenceKind==='fixture'&&(result.budget.costCny??result.budget.costUsd)===0)
   }
   const status=value(await call('dualloop_status',{runId:plan.runId}));check('status resolves exactly the same native run',status.result.runId===plan.runId)
   if(['evaluate','controls','constant-controls'].includes(config.scenario)){
    check('evaluation-only starts without any generator provider',plan.providers.generator===null&&!discovery.services.includes('duoGenerator'))
    check('evaluation-only retains measurement produced in this host',result.evaluations.length===1&&result.evaluations[0].evidence[0].hostPid===process.pid)
    check('evaluation-only records no search or feedback work',result.generationsRun===0&&result.stopReason==='evaluation_complete'&&!status.events.some(e=>['feedback','comparison'].includes(e.kind)))
    check('evaluation-only leaves original target unchanged and accounts both steps',readFileSync(plan.spec.target.path,'utf8')===plan.baseline.persona&&status.budget.operations===2&&status.budget.costCny===0)
   }
   if(['controls','constant-controls'].includes(config.scenario)){
    const facts=result.evaluations[0],expectedPass=config.scenario==='controls'
    check('control adapter retains four individually measured outputs',facts.evidence[0].rows.length===4&&facts.evidence[0].measurementDependency.version==='3.18.2')
    check('control outputs match the frozen pass or deliberately constant failure expectation',facts.metrics.controls_distinguish===expectedPass&&facts.metrics.control_match_rate===(expectedPass?1:.25))
    check('failed discrimination remains a constraint failure without relaxing the contract',result.measurementChecks.fast.verdicts.baseline===(expectedPass?'better':'constraint_violation'))
    check('control evidence explicitly excludes optimization efficacy',facts.evidence[0].qualification==='SUPPLIED_CONTROLS_ONLY'&&result.improvementProven===false)
    check('each nested control has a CNY zero-cost receipt',facts.costEvidence.nestedReceipts.length===4&&facts.costEvidence.nestedReceipts.every(r=>r.currency==='CNY'&&r.costCny===0))
    const preparation=value(await call('dualloop_design',{draft:plan.spec,experimentPath:plan.contractPath}));save('control-preparation.json',preparation)
    check('preparation discovers installed evaluator semantics and matching dependencies without executing it',preparation.evaluators.matches.fast.status==='COMPATIBLE_BY_DECLARATION'&&preparation.evaluators.executedEvaluations===0&&preparation.evaluators.items[0].metricDefinitions.control_match_rate.unit==='fraction')
   }
   const report=value(await call('dualloop_report',{runId:plan.runId,includeEvents:true}));save('product-report.json',report)
   check('public report separates diagnostic facts from untested causes and grants no retry authority',report.diagnostics.causeEstablished===false&&report.diagnostics.recovery.automaticNewRunAuthorized===false&&report.diagnostics.recovery.resumeSupported===false)
   if(config.scenario==='no-progress'){
    check('configured no-progress stops after one measured generation and still records planned final',result.generationsRun===1&&result.stopReason==='no_progress_limit'&&result.final.length===1)
    check('tied scores remain facts rather than an invented evaluator defect or metric ceiling',report.diagnostics.facts.some(f=>f.code==='FAST_SCORES_WITHIN_EPSILON')&&report.diagnostics.metricCeilingEstablished===false&&report.diagnostics.unresolvedQuestions.every(q=>q.state==='NOT_TESTED'))
   }
   if(config.scenario==='evaluation-failure'){
    check('the threshold-reaching failed measurement is retained and the next candidate was not executed',report.candidates.find(c=>c.id==='dl-0002').fast.state==='FAILED'&&report.candidates.find(c=>c.id==='dl-0003').fast.state==='NOT_EVALUATED')
    check('failure diagnosis retains evidence and requires inspection before new work',report.diagnostics.facts.some(f=>f.code==='EVALUATION_FAILED')&&report.diagnostics.recovery.safeToRepeatWork===false)
   }
   if(['functional','byo','three-stage'].includes(config.scenario)){
    const rows=status.events.filter(e=>e.kind==='feedback')
    check('same-run feedback retains scoped Slow facts and frozen constraints in the actual host',rows.length===2&&rows[1].feedback.slowFeedback.observations.some(o=>o.slow?.tier==='slow')&&JSON.stringify(rows[1].feedback.slowFeedback.constraints)===JSON.stringify(plan.spec.constraints))
    check('feedback records the next generator and a content identity',rows.every(e=>e.consumer.providerId===plan.providers.generator.id&&typeof e.feedbackDigest==='string'&&e.feedbackDigest.length===64))
   }
   check('native observer preserves stage evidence and original Journal export',report.candidates.length>0&&report.replayedOperations===0&&report.journalJsonl.trim().split('\n').length===status.events.length)
   check('observer uses latest unchanged budget',JSON.stringify(report.budget)===JSON.stringify(status.budget))
   if(config.scenario==='functional'){
    const duplicates=report.candidates.filter(c=>c.status==='duplicate_skipped')
    check('same-content fixtures are recorded as skipped rather than measured again',duplicates.length>0&&duplicates.every(c=>c.duplicateOf&&c.fast.state==='NOT_EVALUATED'&&c.fast.metrics===null))
    check('duplicate policy is bound in the public inspected plan',plan.searchPolicy.defaultDuplicateAction==='skip_execution_and_evaluation'&&plan.searchPolicy.allowNoiseRepeats===false)
   }
   if(config.scenario==='noise-repeat'){
    const repeated=report.candidates.find(c=>c.id!=='baseline')
    check('frozen noise-repeat opt-in preserves the explained repeat and actual measurement',plan.searchPolicy.allowNoiseRepeats===true&&repeated.duplicateOf==='baseline'&&repeated.repeat.purpose==='noise_measurement'&&repeated.fast.state==='EVALUATED')
    check('noise repeat uses ordinary native accounting without new allowance',status.budget.fastAttempts===2&&status.budget.costCny===0&&result.improvementProven===false)
   }
   if(['byo','three-stage'].includes(config.scenario)){
    check('caller function evaluator and structural search replace providers without core edits',plan.providers.generator.id==='byo-structural-fixture-search'&&plan.providers.evaluators.every(d=>d.id.startsWith('byo-')&&d.evidenceFamily))
    check('custom provider history includes operator assignments',report.lineage.some(c=>c.parentId)&&report.candidates.some(c=>c.id!=='baseline'))
    const draft=value(await call('dualloop_design',{draft:JSON.parse(readFileSync(plan.contractPath,'utf8')),experimentPath:plan.contractPath,context:{resources:[{kind:'evaluator',ref:'byo-existing-evaluation-example-v1',readAuthorized:true}]}}))
    check('native CNY draft passes the shared validator',draft.status==='draft_valid'&&draft.mode==='optimize'&&draft.authorityGranted===false)
    check('complete inputs return the existing plan step and no redundant owner questions',draft.preparation.status==='ready_for_binding'&&draft.preparation.questions.length===0&&draft.preparation.actions.some(a=>a.tool==='dualloop_plan'))
    if(config.scenario==='three-stage'){
     check('three declared search tiers share native execution with final outside search',JSON.stringify(plan.searchStages.map(s=>s.tier))==='["fast","review","slow"]'&&plan.spec.final.dataId==='final')
     check('each search tier has actual candidate measurements',report.candidates.some(c=>c.id!=='baseline'&&['fast','review','slow'].every(t=>c[t].state==='EVALUATED')))
     const feedback=status.events.filter(e=>e.kind==='feedback')
     check('next generation receives review observations without final measurements',feedback[1].feedback.reviewFeedback.observations.some(o=>o.review?.tier==='review')&&!JSON.stringify(feedback).includes('"tier":"final"'))
     check('public preparation checks all configured stage providers',Object.keys(draft.evaluators.matches).includes('review'))
     check('review work counts toward existing slow budget',result.stageAttempts.review>0&&result.budget.slowAttempts>=result.stageAttempts.review+result.stageAttempts.slow+result.final.length)
    }
   }
   const repeated=value(await call('dualloop_run',{planDigest:plan.planDigest}));check('repeat reads retained artifacts without executing providers',repeated.reusedArtifacts===true)
   const budget=value(await call('dualloop_budget_status',{runId:plan.runId}));check('budget tool uses native persistent accounting',budget.budget.operations===repeated.budget.operations)
   const badReceipt=await call('dualloop_budget_reconcile',{runId:plan.runId,receiptHash:'missing'});check('invalid recovery reports unknown receipt and cannot repeat external work',!badReceipt.isError&&value(badReceipt).outcome==='unknown-receipt')
   if(config.scenario==='warm-start'){
    const sourceFile=join(config.runsRoot,plan.runId,'duo.sqlite'),sourceBytes=readFileSync(sourceFile),draft=JSON.parse(readFileSync(config.experimentPath,'utf8'))
    // The verifier owns this isolated copy; no original user contract/profile is edited.
    draft.id='warm-start-followup-control';draft.warmStart={runIds:[plan.runId],maxRecords:6,maxContextBytes:8192}
    writeFileSync(config.experimentPath,JSON.stringify(draft))
    const cold=value(await call('dualloop_plan'));save('excluded-fixture-plan.json',cold)
    check('fixture history is excluded by default in the public host plan',cold.warmStart.mode==='cold_start'&&cold.warmStart.sources[0].reasons.includes('fixture_or_control'))
    draft.warmStart.fixturePolicy='ideas_only';writeFileSync(config.experimentPath,JSON.stringify(draft))
    const warm=value(await call('dualloop_plan'));save('warm-plan.json',warm)
    check('public warm plan selects bounded labelled ideas without creating a new run',warm.warmStart.mode==='warm_start'&&warm.warmStart.context.records.every(r=>r.use==='ideas_only')&&!existsSync(join(config.runsRoot,warm.runId)))
    const warmResult=value(await call('dualloop_run',{planDigest:warm.planDigest}));save('warm-result.json',warmResult)
    const warmStatus=value(await call('dualloop_status',{runId:warm.runId}));save('warm-status.json',warmStatus)
    const warmReport=value(await call('dualloop_report',{runId:warm.runId,includeEvents:true}));save('warm-report.json',warmReport)
    check('new-run generator actually consumes historical source identities',warmResult.status==='completed'&&warmReport.candidates.some(c=>c.hypothesis?.includes(plan.runId)))
    check('new run measures current baseline and retains separate CNY accounting',warmResult.historyReuse.baselineRemeasured&&warmResult.historyReuse.priorCostsImported===false&&warmStatus.budget.costCny===0&&warm.runId!==plan.runId)
    check('history digest reaches every generator input event',warmStatus.events.filter(e=>e.kind==='feedback').every(e=>e.warmStartDigest===warm.warmStart.contextDigest))
    check('reused history cannot claim fresh independent final improvement',warmResult.independentFinal.independence==='NOT_ESTABLISHED'&&warmReport.finalDataReview.reusedDeclaredDataId===true&&warmResult.conclusion==='insufficient_evidence'&&warmResult.improvementProven===false)
    const oldState=value(await call('dualloop_status',{runId:plan.runId}))
    check('warm start preserves source journal, old budget and original target',readFileSync(sourceFile).equals(sourceBytes)&&JSON.stringify(oldState.budget)===JSON.stringify(status.budget)&&readFileSync(plan.spec.target.path,'utf8')===plan.baseline.persona)
    const again=value(await call('dualloop_run',{planDigest:warm.planDigest}))
    check('warm result reread performs no new work',again.reusedArtifacts&&JSON.stringify(again.budget)===JSON.stringify(warmStatus.budget))
   }
   if(config.scenario==='functional'){
    // Keep this app independent of the service being removed. Cordis must
    // dispose and restart the real controller/tool consumers itself.
    // The DSH module loader can give its import a different module identity
    // from this app's native import; the configured entry owns the real fiber.
    const entries=[...ctx.loader.entries()]
    const first=entries.find(e=>e.options.id==='duo-comparator')?.fiber
    check('configured comparator is a real Cordis fiber',!!first)
    await first.dispose()
    check('removing a required provider unregisters its consumer tools',!ctx.tools.schemas().some(s=>s.name==='dualloop_run'))
    class Replacement extends WeightedComparator {
     describe(){return {id:'host-replacement-comparator',version:'1',deterministic:true}}
    }
    const replacement=await ctx.plugin(Replacement)
    for(const id of ['duo-controller','dualloop'])await entries.find(e=>e.options.id===id).fiber
    check('replacement reactivates native consumer tools',ctx.tools.schemas().some(s=>s.name==='dualloop_run'))
    const revised=value(await call('dualloop_plan'))
    check('provider replacement changes the inspected plan',revised.planDigest!==plan.planDigest)
    const stale=await call('dualloop_run',{planDigest:plan.planDigest})
    check('old plan refuses after provider replacement',stale.isError)
    const rerun=value(await call('dualloop_run',{planDigest:revised.planDigest}))
    check('replacement supports a new native run in the same host',rerun.status==='completed'&&rerun.runId===revised.runId)
    await replacement.dispose()
    check('replacement disposal unregisters consumer tools again',!ctx.tools.schemas().some(s=>s.name==='dualloop_run'))
   }
   check('no child-process API was used by native DUO',attempts===0)
   save('receipt.json',{status:'PASS',host:'actual named DSH profile',scenario:config.scenario,hostPid:process.pid,checks,toolCalls:calls.length,childProcessAttempts:attempts,paidCalls:0,modelSessions:0})
  }finally{for(const k of childMethods)childProcess[k]=original[k];syncBuiltinESMExports()}
 }
 ctx.effect(()=>ctx.appReady.onReady(()=>{void run().then(()=>exit(0),error=>{save('receipt.json',{status:'FAIL',checks,error:{name:error.name,message:error.message},toolCalls:calls.length});console.error(error);exit(1)})}))
}
