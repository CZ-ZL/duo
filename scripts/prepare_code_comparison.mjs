// Fixed code-method composition over existing native services. No model calls.
import {readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs'
import {resolve,join,dirname} from 'node:path'
import {createHash} from 'node:crypto'
import {singleLoopCodeData,publicDevelopmentTasks} from '../examples/native/method-feedback.js'
import {digest,resolveNativeContract} from '@dual-loop/dsh-plugin/contract'
import {readDataset} from '@dual-loop/dsh-plugin/model-accounting'

const [output,datasetFile,keyFile,targetFile,liveText,searchProfile='legacy-v1',warmStartFile='',journalRoot='',armCapText='']=process.argv.slice(2)
if(![output,datasetFile,keyFile,targetFile].every(Boolean)||!['true','false'].includes(liveText))throw new Error('Supply new output, code dataset/key, Target and true/false live mode')
if(!['legacy-v1','history-structured-v2','properties-structured-v3'].includes(searchProfile))throw new Error('Unknown versioned code search profile')
const properties=searchProfile==='properties-structured-v3',aligned=searchProfile!=='legacy-v1'
const generations=properties?3:2,minimumSamples=properties?2:6,defaultArmCap=properties?2.8:2.4,version=properties?3:aligned?2:1
if(armCapText&&(!properties||!Number.isFinite(Number(armCapText))||Number(armCapText)<=0||Number(armCapText)>defaultArmCap))throw new Error('An optional property-study arm cap must be finite, positive and no higher than the default CNY ceiling')
const armCap=armCapText?Number(armCapText):defaultArmCap,totalCap=Number((.4+3*armCap).toFixed(9))
if(properties&&warmStartFile)throw new Error('The property study is preregistered as a cold start')
if((warmStartFile||journalRoot)&&!aligned)throw new Error('Historical legacy profile has no cross-run warm input')
if(warmStartFile&&!journalRoot)throw new Error('Warm start requires its existing native Journal root')
if(journalRoot&&!statSync(journalRoot).isDirectory())throw new Error('Journal root must be an existing directory')
const warmStart=warmStartFile?JSON.parse(readFileSync(warmStartFile)):null
const sha=b=>createHash('sha256').update(b).digest('hex'),out=resolve(output),live=liveText==='true'
const bytes=readFileSync(datasetFile),dataset=readDataset(datasetFile),answerKey=JSON.parse(readFileSync(keyFile)),source=dirname(resolve(datasetFile))
const manifest=JSON.parse(readFileSync(join(source,'manifest.json')))
if(resolve(keyFile)!==join(source,'answer-key.json')||!manifest.files?.['dataset.json']||!manifest.files?.['answer-key.json']||
 Object.entries(manifest.files).some(([name,hash])=>name.includes('/')||name.includes('\\')||sha(readFileSync(join(source,name)))!==hash))throw new Error('Source pack manifest identity mismatch')
const engineeringProperties=properties&&!live&&manifest.measurementQualification==='ENGINEERING_CONTROL_ONLY'&&answerKey.version==='code-engineering-control-v1'&&Object.keys(answerKey.tasks).every(id=>id.startsWith('engineering-'))
if(properties&&!engineeringProperties){
 if(manifest.comparisonProfile!==searchProfile||manifest.slowHigherFidelity!=='BOUNDED_INCREMENTAL_TWO_TASKS'||answerKey.evaluatorVersion!=='25-properties-v1'||!Object.keys(manifest.sourceBindings??{}).length||
  Object.entries(manifest.sourceBindings).some(([path,hash])=>sha(readFileSync(path))!==hash))throw new Error('Qualified property study receipt identity mismatch')
}
const full=singleLoopCodeData(bytes,answerKey)
if(dataset.fast.tasks.length!==6||dataset.slow.tasks.length!==(properties?2:12)||dataset.final.tasks.length!==18)throw new Error('This version requires its fixed6/'+(properties?2:12)+'/18split; no score-based task replacement')
if(live&&manifest.measurementQualification!=='DEVELOPMENT_CONTRACT_QUALIFIED')throw new Error('Code comparison requires completed G0 measurement qualification before live preparation; local controls remain available')
const target=readFileSync(targetFile),arms=[],methods=['B0','B1','B2','B3']
const save=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'})
// Validate bounded history before creating output. Reuse the native schema;
// an empty history is a valid cold start, not an import or paid authorization.
if(warmStart)resolveNativeContract({version:1,id:'history-preflight',target:{kind:'dsh-persona',path:resolve(targetFile)},
 fast:{evaluatorId:'check',version:'1',dataId:'check',metric:'task_pass_rate',direction:'maximize',weights:{task_pass_rate:1}},
 generations:2,topK:1,epsilon:.01,minSamples:6,quotas:{exploit:1,explore:1,innovate:1},constraints:[],
 permissions:{paid:true,network:live,externalSideEffects:false},
 warmStart,budget:{currency:'CNY',maxCostCny:2.4,maxSessions:30,maxFastEvals:7,maxSlowEvals:5,maxWallTimeMs:1200000}},join(out,'history-preflight.json'))
const fastCalls=1+generations*(aligned?3:1),slowCalls=1+generations,requestLimit=properties?54:aligned?40:28,groupId=aligned?'code-method-budget-'+sha(out).slice(0,12):'code-method-budget'
mkdirSync(out,{recursive:false});mkdirSync(join(out,'execution-cwd'))
for(const method of methods){
 const id='set1-'+method,directory=join(out,id),inputs=join(out,'inputs',id),pack=join(inputs,'pack'),baseline=method==='B0'
 mkdirSync(pack,{recursive:true});writeFileSync(join(inputs,'persona.txt'),target,{flag:'wx'})
 const chosen=method==='B1'?full:{dataset,datasetBytes:bytes,answerKey},data=chosen.dataset,key=chosen.answerKey
 writeFileSync(join(pack,'dataset.json'),chosen.datasetBytes,{flag:'wx'});save(join(pack,'answer-key.json'),key)
 save(join(pack,'derivation.json'),chosen.derivation??{kind:'original_code_splits',sourceDatasetSha256:sha(bytes),datasetSha256:sha(bytes),finalUnchanged:true,originalTestsUnchanged:true})
 save(join(pack,'manifest.json'),{sourceManifestSha256:sha(readFileSync(join(source,'manifest.json'))),measurementQualification:manifest.measurementQualification,
  files:Object.fromEntries(['dataset.json','answer-key.json','derivation.json'].map(n=>[n,sha(readFileSync(join(pack,n)))]))})
 const objective=tier=>({evaluatorId:'code-unittest-'+tier,version:key.evaluatorVersion??'3',dataId:data[tier].id,metric:'task_pass_rate',direction:'maximize',weights:{task_pass_rate:1}})
 const maxCallsByTier=baseline?{final:1}:method==='B1'?{fast:fastCalls,final:2}:{fast:fastCalls,slow:slowCalls,final:2}
 const maxEvaluatorCalls=Object.values(maxCallsByTier).reduce((a,b)=>a+b,0),maxModelRequests=maxEvaluatorCalls+(baseline?0:generations)
 const contract={version:1,id:'code-method-'+(properties?'v3-':aligned?'v2-':'')+id,target:{kind:'dsh-persona',path:aligned?resolve(targetFile):join(inputs,'persona.txt')},
  ...baseline?{operation:'evaluate'}:{fast:objective('fast'),...method==='B1'?{}:{slow:objective('slow')}},final:objective('final'),
  ...!baseline&&warmStart?{warmStart}:{},
  constraints:[{metric:'format_valid',op:'==',value:true}],epsilon:.01,minSamples:minimumSamples,generations:baseline?0:generations,topK:baseline?0:1,
  quotas:{exploit:baseline?0:1,explore:!baseline&&aligned?1:0,innovate:!baseline&&aligned?1:0},permissions:{paid:true,network:live,externalSideEffects:false},
  budget:{currency:'CNY',maxCostCny:baseline?.4:armCap,maxSessions:baseline?2:aligned?maxEvaluatorCalls*2+generations:18,maxFastEvals:baseline?0:fastCalls,maxSlowEvals:baseline?1:method==='B1'?2:slowCalls+2,maxWallTimeMs:1200000}}
 resolveNativeContract(contract,join(inputs,'experiment.json'));save(join(inputs,'experiment.json'),contract)
 const profile=join(directory,'dsh-home/profiles/duo-model-minimum'),replacements=[
  {id:'code-evaluator',name:'./dsh_code_evaluator.js',config:{pack,artifactRoot:join(directory,'executions')}}]
 const patch=[{id:'model-evaluator',disabled:true},{id:'duo-journal',config:{root:journalRoot?resolve(journalRoot):join(out,'native-journal')}},
  {id:'model-entry',config:{output:directory,live,maxModelRequests,requiredGenerations:baseline?0:generations,arm:method,
   budgetGroups:[{id:groupId,maxModelRequestsPerRun:properties?19:aligned?14:10,limits:{currency:'CNY',maxCostCny:totalCap,maxSessions:4,maxFastEvals:0,maxSlowEvals:0,maxWallTimeMs:4800000}}],
   evaluatorProcess:{script:join(profile,'code_evaluation.py'),pack,artifactRoot:join(directory,'executions'),tiers:Object.keys(maxCallsByTier),maxCalls:maxEvaluatorCalls,maxCallsByTier}}}]
 if(!baseline){patch.push({id:'duo-feedback',disabled:true});replacements.push({id:'method-feedback',name:'./method-feedback.js',config:{method,datasetPath:join(directory,'inputs/dataset.json'),...aligned?{contextMode:'history'}:{},...properties?{maxTestDetails:2}:{}}})}
 if(['B2','B3'].includes(method)){patch.push({id:'duo-gate',disabled:true});replacements.push({id:'method-gate',name:'@dual-loop/dsh-plugin/bounded-tie-gate',config:{maxTies:1}})}
 if(!live){patch.push({id:'fixture',disabled:true});replacements.push({id:'code-method-fixture',name:'./code-method-fixture.js',config:{pack}})}
 patch.push({insert:replacements});save(join(inputs,'providers.patch.yml'),patch)
 save(join(inputs,'model.json'),{maxTokens:16384,maxInputBytes:65536,reservationCny:properties&&live?.3:.4,timeoutMs:live?120000:10000,...aligned?{explicitSlowFeedback:method!=='B3'}:{}})
 save(join(inputs,'groups.json'),[])
 arms.push({id,method,repeat:1,benchmarkKind:'code',...aligned?{searchProfile}:{},directory:id,inputs:'inputs/'+id,maxCostCny:contract.budget.maxCostCny,
  maxModelRequests,maxEvaluatorCalls,maxCallsByTier,datasetDigest:digest(data),datasetSha256:sha(chosen.datasetBytes),
  finalDigest:digest(data.final),publicDevelopmentDigest:digest(publicDevelopmentTasks(data)),targetDigest:digest(target.toString())})
}
if(new Set(arms.map(a=>a.publicDevelopmentDigest)).size!==1||new Set(arms.map(a=>a.finalDigest)).size!==1)throw new Error('Method data drift')
save(join(out,'comparison-protocol.json'),{version,scope:'native-code-method-comparison-v'+version,live,arms,currency:'CNY',maxCostCny:totalCap,maxModelRequests:requestLimit,
 ...aligned?{searchProfile,measurementReadiness:{development:manifest.measurementQualification,slowHigherFidelity:properties?(engineeringProperties?'ENGINEERING_CONTROL_ONLY':manifest.slowHigherFidelity):'NOT_ESTABLISHED',
  reason:properties?'C1 measured two fixed old-pass/new-fail property witnesses. Limited two-task increment, not general correctness or benefit.':'Fast/Slow use the same unittest family. More tasks do not prove higher fidelity; observed saturation and activation must be reported.',
  effectiveFeedback:'REQUIRES_OBSERVED_CANDIDATE_SLOW_IN_LATER_GENERATION',independentFinal: properties?'C2_FIXED_SOURCE_CONTROLS_ONLY_RUNTIME_NONLEAKAGE_REQUIRED':warmStart?'HISTORY_REUSE_REQUIRES_INDEPENDENCE_REVIEW':'FROZEN_FINAL_NOT_CONTRACT_CALIBRATED'},
  context:{history:'all_latest_candidates_ranked',failureDetails:properties?'measured_first_tier_counts_and_first2failures160chars; full raw receipts retained':'measured_first_tier_only',generator:'structured-generator',explicitSlow:'B2 enabled; B3 removed from same-run and warm context',journalRoot:journalRoot?resolve(journalRoot):join(out,'native-journal')}}:{},
 primaryMetric:'task_pass_rate',independentSearchRepeatsPerMethod:1,runtimeCwd:join(out,'execution-cwd'),
 finalTaskIds:dataset.final.tasks.map(t=>t.id),evidenceKind:'real_model_on_restricted_code_benchmark',measurementQualification:manifest.measurementQualification,
 modes:{B0:'Original Target; final only, no search.',B1:'Single full'+(properties?8:18)+'-task development tier with all measured rows and identical tests.',B2:'Fast/Slow with conservative explicit feedback and fixed bounded tie gate.',B3:'B2 with explicit Slow feedback removed; same parent selection and computed quotas.'},
 shared:{coldStart:!warmStart,warmStart:!!warmStart,model:live?'deepseek-flash':'fixture',thinking:'disabled',maxTokens:16384,maxInputBytes:65536,reservationCny:properties&&live?.3:.4,automaticRetries:0,
  quota:{exploit:1,explore:aligned?1:0,innovate:aligned?1:0},generations,gate:{provider:'bounded-tie-gate',maxTies:1,scope:'B2/B3'},seed:'No model seed configured',optimizationArmTotalCapCny:armCap},
 budgetProof:{maxRequests:Object.fromEntries(arms.map(a=>[a.method,a.maxModelRequests])),maxEvaluatorCalls:Object.fromEntries(arms.map(a=>[a.method,a.maxEvaluatorCalls])),maxFinalExecutionsPerArm:2,
  totalIncludes:'Every generated proposal, candidate execution and independent final. Python evaluations make no model calls; local CPU time unpriced.',
  limit:'Equal total monetary ceiling; reservations can stop an arm before its request ceiling. No promise that every maximum-length response fits every planned operation.'},
 order:[methods],stops:['Frozen native generation/request/money/deadline limits; no automatic retry.','Unknown cost stops remaining arms; all failures retained.','No changed scoring/prompt/policy or final feedback after freeze.'],
 limitations:['G0 qualification and separate current allocation required before live method execution.','One replicate is descriptive, not proof of general superiority.','B3 preserves indirect Slow parent/quota effects.','Inactive feedback is not an effective ablation.','Offline transport deliberately exercises improvement using controlled replies; not optimization evidence.','No independent Calling Agent acceptance in this entry.']})
console.log(JSON.stringify({status:'CODE_METHOD_INPUTS_PREPARED',arms:4,paidCalls:0,output:out}))
