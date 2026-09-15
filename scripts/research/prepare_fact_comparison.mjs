// Prepare fixed inputs for the existing native runner; never execute a model.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {singleLoopData,publicDevelopmentTasks} from '../../examples/native/method-feedback.js'
import {digest,resolveNativeContract} from '@dual-loop/dsh-plugin/contract'
import {readDataset} from '@dual-loop/dsh-plugin/model-accounting'

const [output,datasetFile,keyFile,targetFile,liveText]=process.argv.slice(2)
if(![output,datasetFile,keyFile,targetFile].every(Boolean)||!['true','false'].includes(liveText))throw new Error('Supply new output, dataset, key, target and true/false live mode')
const out=resolve(output),live=liveText==='true',dataset=readDataset(resolve(datasetFile)),answerKey=JSON.parse(readFileSync(keyFile,'utf8'))
if(answerKey.datasetDigest!==digest(dataset)||!dataset.slow||dataset.fast.tasks.length!==5||dataset.slow.tasks.length!==10||dataset.final.tasks.length!==10)throw new Error('This fixed study requires the original frozen5/10/10fact task and matching key')
const full=singleLoopData(dataset,answerKey),root=resolve(fileURLToPath(new URL('..',import.meta.url)))
mkdirSync(out,{recursive:false})
mkdirSync(join(out,'execution-cwd'))
const save=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'})
const order=[['B0','B1','B2','B3'],['B3','B2','B1','B0']],arms=[]
for(const [index,methods] of order.entries())for(const method of methods){
 const repeat=index+1,id='set'+repeat+'-'+method,directory=join(out,id),inputs=join(out,'inputs',id)
 mkdirSync(inputs,{recursive:true});copyFileSync(targetFile,join(inputs,'persona.txt'))
 const chosen=method==='B1'?full:{dataset,answerKey},data=chosen.dataset,key=chosen.answerKey
 save(join(inputs,'dataset.json'),data);save(join(inputs,'answerKey.json'),key)
 const objective=tier=>({evaluatorId:'fact-support-'+tier,version:'2',dataId:data[tier].id,metric:'supported_accuracy',direction:'maximize',weights:{supported_accuracy:1}})
 const baseline=method==='B0',contract={version:1,id:'v4-fact-'+id,target:{kind:'dsh-persona',path:join(inputs,'persona.txt')},
  ...baseline?{operation:'evaluate'}:{fast:objective('fast'),...method==='B1'?{}:{slow:objective('slow')}},final:objective('final'),
  constraints:[{metric:'format_valid',op:'==',value:true}],epsilon:.01,minSamples:5,generations:baseline?0:2,topK:baseline?0:1,
  quotas:{exploit:baseline?0:1,explore:0,innovate:0},permissions:{paid:true,network:live,externalSideEffects:false},
  budget:{currency:'CNY',maxCostCny:baseline?.1:1.1,maxSessions:baseline?2:18,maxFastEvals:baseline?0:3,maxSlowEvals:baseline?1:method==='B1'?2:5,maxWallTimeMs:1200000}}
 resolveNativeContract(contract,join(inputs,'experiment.json'));save(join(inputs,'experiment.json'),contract)
 const profile=join(directory,'dsh-home/profiles/duo-model-minimum'),replacements=[
  {id:'fact-evaluator',name:'./fact-evaluator.js',config:{datasetPath:join(directory,'inputs/dataset.json'),answerKeyPath:join(profile,'answerKey.json')}}],patch=[
  {id:'model-evaluator',disabled:true},
  {id:'duo-journal',config:{root:join(out,'native-journal')}}]
 if(!baseline){patch.push({id:'duo-feedback',disabled:true});replacements.push({id:'method-feedback',name:'./method-feedback.js',config:{method,datasetPath:join(directory,'inputs/dataset.json')}})}
 if(['B2','B3'].includes(method)){patch.push({id:'duo-gate',disabled:true});replacements.push({id:'method-gate',name:'@dual-loop/dsh-plugin/bounded-tie-gate',config:{maxTies:1}})}
 if(!live){patch.push({id:'fixture',disabled:true});replacements.push({id:'fact-fixture',name:'./fact-method-fixture.js',config:{answerKeyPath:join(profile,'answerKey.json')}})}
 patch.push({insert:replacements})
 save(join(inputs,'providers.patch.yml'),patch)
 // Offline synthetic tariff is the existing runner default3/.1/9. A smaller
 // transport-only envelope keeps the same monetary caps with reservation.1.
 save(join(inputs,'model.json'),{maxTokens:live?2048:1024,maxInputBytes:live?32768:24576,reservationCny:.1})
 save(join(inputs,'groups.json'),[{id:'v4-fact-method-budget',maxModelRequestsPerRun:10,limits:{currency:'CNY',maxCostCny:6.8,maxSessions:8,maxFastEvals:0,maxSlowEvals:0,maxWallTimeMs:12000000}}])
 arms.push({id,method,repeat,directory:id,inputs:'inputs/'+id,maxCostCny:contract.budget.maxCostCny,maxModelRequests:baseline?1:10,
  optimizationCapCny:baseline?0:.9,finalCapCny:baseline?.1:.2,datasetDigest:digest(data),finalDigest:digest(data.final),
  publicDevelopmentDigest:digest(publicDevelopmentTasks(data)),targetDigest:digest(readFileSync(targetFile,'utf8'))})
}
if(new Set(arms.map(a=>a.publicDevelopmentDigest)).size!==1||new Set(arms.map(a=>a.finalDigest)).size!==1)throw new Error('Method data drift')
save(join(out,'comparison-protocol.json'),{version:1,scope:'native-fact-method-comparison-v1',live,arms,sourceRoot:root,
 currency:'CNY',maxCostCny:6.8,maxModelRequests:62,primaryMetric:'supported_accuracy',independentSearchRepeatsPerMethod:2,runtimeCwd:join(out,'execution-cwd'),
 modes:{B0:'Unmodified target, final only; zero search.',B1:'Single full15-case development tier, own history and every measured failure row.',B2:'Two-tier DUO with conservative explicit Slow feedback and declared bounded tie gate.',B3:'Same B2 selection and quota computation; all explicit Slow contents removed from generator feedback.'},
 shared:{coldStart:true,warmStart:false,model:'deepseek-v4-flash',thinking:'disabled',liveMaxTokens:2048,liveMaxInputBytes:32768,reservationCny:.1,
  automaticRetries:0,quota:{exploit:1,explore:0,innovate:0},generations:2,gate:{provider:'bounded-tie-gate',maxTies:1,scope:'B2/B3',adoption:'strict comparator unchanged'},seed:'No API seed configured; no claim of identical random draws',primaryResource:'CNY optimization ceiling; generation/request/wall caps can bind first'},
 budgetProof:{searchMaxRequests:{B1:5,B2:8,B3:8},searchReservationPerRequestCny:.1,optimizationCeilingCny:.9,finalMaxRequestsPerSearch:2,finalReservationCny:.1,scope:'Only declared deterministic comparator/gate/feedback/evaluator and single-request generator/executor; no other paid component'},
 order,stops:['Every arm terminal at fixed generation/request/money/deadline or native failure; no retry.','Unknown/inflight cost stops the whole study; preserve untouched remaining arms.','Known settled unsuccessful arms remain in results; other independent arms may continue.','No code/evaluator/policy/prompt revisions after freeze or final peeking.'],
 limitations:['Synthetic keyed facts, limited semantic headroom from E1; no business efficacy claim.','Two independent search repeats per method are descriptive, not significance or equivalence.','B3 retains indirect Slow parent/quota effects. Inactive feedback cannot answer its value.','Offline transport produces known answers with synthetic usage; controls are not effect evidence.','Model alias is provider-routed, not an immutable server-weight identity.','B1 and B2/B3 can use different actual resources under the same monetary ceiling and finite generation cap.']})
console.log(JSON.stringify({state:'INPUTS_PREPARED_NO_MODEL_CALLS',arms:arms.length,output:out}))
