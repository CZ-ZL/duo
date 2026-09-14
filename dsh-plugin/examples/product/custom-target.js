// A supplied custom adapter for the product example, not another built-in Target.
// Its snapshots have `content`, never persona/config. The core is unchanged.
import {readFileSync} from 'node:fs'
import {TargetService,GeneratorService,ExecutorService,fail} from '@dual-loop/dsh-plugin/definitions'
import {digest} from '@dual-loop/dsh-plugin/contract'
import FunctionEvaluators from '@dual-loop/dsh-plugin/function-evaluators'
import {descriptor,cost,evaluateText,descriptors} from './local-providers.js'
export const name='duo-supplied-text-adapter'
export async function apply(ctx){
 class Target extends TargetService {
  describe(){return {id:'supplied-text-target',version:'1',deterministic:true,targetKinds:['local-text'],historySupport:true}}
  identity(s){return digest(s.content)}
  snapshot(path){const content=readFileSync(path,'utf8');return {id:'baseline',content,path,version:digest(content)}}
  validateSnapshot(s){return !!(s&&typeof s.content==='string'&&s.version===this.identity(s))}
  projectDelta(d){if(d?.kind!=='replace-text'||typeof d.content!=='string')fail('DUO_DELTA_INVALID','Expected replace-text content');return {kind:d.kind,content:d.content}}
  apply(c,p){if(c.parentId!==p.id||c.parentVersion!==p.version)fail('DUO_DELTA_INVALID','Parent identity changed');const d=this.projectDelta(c.delta);return {...c,content:d.content,version:digest(d.content)}}
 }
 class Generator extends GeneratorService {
  describe(){return {...descriptor('supplied-text-generator'),configDigest:'trim-v1'}}
  async propose({champion,quotas,nextId,feedback}){return {...cost,candidates:Object.entries(quotas).flatMap(([mode,n])=>Array.from({length:n},()=>({id:nextId(),parentId:champion.id,parentVersion:champion.version,
   mode,family:'trim',hypothesis:'Remove trailing whitespace',delta:{kind:'replace-text',content:champion.content.split('\n').map(x=>x.trimEnd()).join('\n')}}))),artifact:{historyCandidateIds:(feedback.warmStart?.records??[]).map(r=>r.source.candidateId)}}}
 }
 class Executor extends ExecutorService {
  describe(){return {...descriptor('supplied-text-executor'),configDigest:'content-v1'}}
  async execute({applied,signal}){signal?.throwIfAborted();return {...cost,artifact:{text:applied.content}}}
 }
 await ctx.plugin(Target);await ctx.plugin(Generator);await ctx.plugin(Executor)
 await ctx.plugin(FunctionEvaluators,{evaluate:evaluateText,descriptors:descriptors(),implementationDigest:'local-text-check-v1',dataDigest:'target-text-local-only-v1'})
}
