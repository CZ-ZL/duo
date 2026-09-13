// Caller-owned adapter around the existing Schemastery validation function.
// These fixed controls test measurement plumbing, never optimization benefit.
import Schema from '@deepseek-ai/schemastery'
import schemaPackage from '@deepseek-ai/schemastery/package.json' with {type:'json'}
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import FunctionEvaluators,{createControlEvaluation} from '@dual-loop/dsh-plugin/function-evaluators'
import * as Fixtures from './fixture-provider.js'
export const name='duo-existing-schema-evaluator-controls'
const hash=value=>createHash('sha256').update(value).digest('hex')
const schema=Schema.object({answer:Schema.string().required(),citations:Schema.array(Schema.string()).required()})
const allowedSources=['local:test']
export async function measure({artifact}){
 let parsed,validated
 try{parsed=JSON.parse(artifact.text);validated=await schema['~standard'].validate(parsed)}catch{}
 const valid=!!validated&&!validated.issues
 return {ok:true,metrics:{format_valid:valid?1:0,sources_allowed:valid&&parsed.citations.length>0&&parsed.citations.every(ref=>allowedSources.includes(ref)),sample_size:1},
  currency:'CNY',costCny:0,evidence:[{kind:'external_schema_validation',dependency:schemaPackage.name,dependencyVersion:schemaPackage.version,
   hostPid:process.pid,qualification:'FORMAT_AND_ALLOWED_SOURCE_CHECK_ONLY',independentData:false,realTools:false,
   limitations:'The existing external library checks structure. Allowed references do not establish factual answer correctness.'}]}
}
const cases=[
 {id:'correct',text:'{"answer":"42","citations":["local:test"]}',format:1,sources:true},
 {id:'missing-answer',text:'{"citations":["local:test"]}',format:0,sources:false},
 {id:'wrong-source',text:'{"answer":"42","citations":["unapproved"]}',format:1,sources:false},
 {id:'wrong-types',text:'{"answer":42,"citations":"local:test"}',format:0,sources:false},
]
const controls=cases.map(c=>({id:c.id,purpose:'control',artifact:{text:c.text},expectedMetrics:{format_valid:c.format,sources_allowed:c.sources}}))
export async function apply(ctx,config={}){
 await ctx.plugin(Fixtures,{currency:'CNY',evaluators:false,generator:false})
 const dependencies=[{name:schemaPackage.name,version:schemaPackage.version,license:schemaPackage.license,available:true}]
 if(config.missingDependency){
  const dependency='duo-intentionally-missing-evaluator-dependency';let available=false
  try{createRequire(import.meta.url).resolve(dependency);available=true}catch{}
  dependencies.push({name:dependency,available})
 }
 const measurement=config.constant?async()=>({ok:true,metrics:{format_valid:1,sources_allowed:true,sample_size:1},currency:'CNY',costCny:0}):measure
 const checked=createControlEvaluation({evaluate:measurement,controls,discriminationMetric:'format_valid',reservationCnyPerCase:0})
 await ctx.plugin(FunctionEvaluators,{
  implementationDigest:hash(readFileSync(new URL(import.meta.url),'utf8')+schemaPackage.version+JSON.stringify(config)),dataDigest:checked.controlsDigest,
  evaluate:async args=>{
   if(dependencies.some(d=>!d.available))throw new Error('Declared dependency is unavailable; plan should have refused')
   const result=await checked.evaluate(args)
   result.evidence[0].hostPid=process.pid;result.evidence[0].measurementDependency=dependencies[0]
   result.evidence[0].measurementKind=config.constant?'constant_negative_control':'external_schema_validation'
   return result
  },
  descriptors:[{id:'existing-schema-controls',version:'1',tier:'fast',dataId:'schema-controls-v1',
   metrics:['control_match_rate','controls_distinguish','sample_size'],currency:'CNY',reservationCny:checked.reservationCny,
   permissions:{paid:false,network:false,externalSideEffects:false},maxRequests:0,dependencies,
   inputDescription:'Frozen control outputs only; Executor artifact is not a measured Target answer in this control experiment.',
   outputDescription:'Exact expected format/source matches and distinct format scores; each control and fee are retained.',
   metricDefinitions:{control_match_rate:{meaning:'Fraction matching all frozen expected facts',direction:'maximize',unit:'fraction'},
    controls_distinguish:{meaning:'Completed controls have distinct measured format outcomes',direction:'constraint',unit:'boolean'},
    sample_size:{meaning:'Control callback invocations completed',direction:'minimum',unit:'cases'}},
   sampleScope:'Four explicit correct/incorrect outputs; purpose control, excluded from search and final evidence.',independentData:false,realTools:false,
   evidenceKind:'fixture',evidenceFamily:config.constant?'constant_evaluator_negative_control':'external_schema_validation_controls',
   fidelityRationale:config.constant?'Deliberately constant negative-control function; the installed validator is not invoked. No qualification claim.':'Actual installed external validator on fixed controls; no model, business-quality, Slow fidelity or optimization efficacy qualification.'}]
 })
}
