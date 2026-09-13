// Replace this local function with your existing evaluation. This complete
// example is an offline functional fixture, never an optimization-benefit claim.
import FunctionEvaluators from '@dual-loop/dsh-plugin/function-evaluators'
import {GeneratorService} from '@dual-loop/dsh-plugin/definitions'
import {compileProposal,decodeProposal} from '@dual-loop/dsh-plugin/structured-generator'
import * as Fixtures from './fixture-provider.js'
export const name='duo-byo-evaluator-example'

export function existingEvaluation({artifact,tier}) {
 const content=typeof artifact?.text==='string'?artifact.text:''
 const instruction=content.includes('answer clearly')
 // These deliberately simple predicates demonstrate distinct evidence kinds.
 // Neither makes Slow empirically higher-fidelity than Fast.
 const safe=typeof artifact?.pid==='number'&&content.includes('{{model}}')&&content.includes('{{cwd}}')
 return {ok:true,metrics:{quality:instruction?1:0,safe,sample_size:2},currency:'CNY',costCny:0,
  evidence:[{kind:tier==='fast'?'literal_fixture':'artifact_structure_fixture',qualification:'FUNCTIONAL_FIXTURE_ONLY',hostPid:artifact.pid}]}
}
export async function apply(ctx,config={}){
 await ctx.plugin(Fixtures,{currency:'CNY',evaluators:false,generator:false})
 class ReferenceSearch extends GeneratorService {
  describe(){return {id:'byo-structural-fixture-search',version:'1',currency:'CNY',reservationCny:0,permissions:{paid:false,network:false,externalSideEffects:false},evidenceKind:'fixture'}}
  async propose(args){
   const proposal=compileProposal({...args,dataset:{fast:{tasks:[]}}})
   const candidates=proposal.slots.map(slot=>({slot:slot.slot,hypothesis:'Functional operator composition control; no quality claim.',
    change:slot.mode==='exploit'?{suffix:'answer clearly'}:slot.mode==='explore'?{persona:'{{model}} in {{cwd}} must answer clearly using a different structured strategy.'}:{components:['answer clearly','Check the artifact structure.']}}))
   return {candidates:decodeProposal(JSON.stringify({candidates}),proposal,args.champion,args.nextId),currency:'CNY',costCny:0}
  }
 }
 await ctx.plugin(ReferenceSearch)
 await ctx.plugin(FunctionEvaluators,{
  implementationDigest:'byo-existing-evaluation-example-v1',dataDigest:'fixture-task-sets-v1',evaluate:existingEvaluation,
  descriptors:['fast',...(config.review?['review']:[]),'slow','final'].map(tier=>({id:'byo-'+tier,version:'1',tier,dataId:tier,metrics:['quality','safe','sample_size'],currency:'CNY',reservationCny:0,
   permissions:{paid:false,network:false,externalSideEffects:false},evidenceKind:'fixture',evidenceFamily:tier==='fast'?'literal_fixture':'artifact_structure_fixture',
   fidelityRationale:'Distinct functional checks only; no empirical higher-fidelity claim.'}))})
}
