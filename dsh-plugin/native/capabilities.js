// Authoritative built-in support catalog. No provider loading or work occurs here.
// Custom adapters describe their own kind and support through the existing Target service.
export const targetKindSchema = Object.freeze({type:'string',pattern:'^[a-z][a-z0-9-]{0,95}$',
 description:'Target kind declared by the configured Target adapter. Built-in kinds are listed in capabilities.targets; a syntactically valid custom kind still requires a matching adapter.'})
const targets = [
 {kind:'dsh-persona',name:'Persona overlay',module:'@dual-loop/dsh-plugin/target',
  delta:'cordis-overlay/system-prompt',support:'SUPPORTED',
  mutable:'Complete isolated persona text; required placeholders preserved.',
  lifecycle:{discovery:true,validation:true,delta:true,journal:true,warmStart:true,report:true,recovery:'settled_search_boundary',execution:'matching_executor_required',evaluation:'matching_evaluator_required'},
  limits:['No original file writes or automatic deployment.']},
 {kind:'dsh-plugin-config',name:'Bounded fetch configuration',module:'@dual-loop/dsh-plugin/config-target',
  delta:'plugin-config-replace-v1',support:'PARTIAL',
  mutable:'Only integer maxBodyChars in [50000,200000] for @deepseek-ai/dsh-web-fetch-http.',
  lifecycle:{discovery:true,validation:true,delta:true,journal:true,warmStart:true,report:true,recovery:'settled_search_boundary',execution:'matching_executor_required',evaluation:'matching_evaluator_required'},
  limits:['Not arbitrary plugin configuration.','Live fetch execution is an opt-in source research example; not a default runtime provider.']}
]
const components = [
 ['Target','duoTarget','snapshot/apply/identity/history'],['Generator','duoGenerator','propose'],
 ['Executor','duoExecutor','execute'],['Evaluator','duoEvaluators','evaluate'],
 ['Evidence comparison','duoComparator','compare'],['Promotion','duoGate','select'],
 ['Feedback and history order','duoFeedback','summarize/orderHistory']
].map(([role,service,methods])=>({role,service,methods,replacement:'existing Cordis provider binding'}))
export const builtinTargets = () => structuredClone(targets)
export function targetCapability(kind){return builtinTargets().find(t=>t.kind===kind)??null}
export function productCapabilities(){return {version:1,targets:builtinTargets(),components:structuredClone(components),
 defaults:'Local deterministic example or caller-supplied providers. No bundled model authorization.',
 platform:'Linux, Node 24+, tested DSH 0.1.2-rc.1 / Cordis 4.0.2',
 boundaries:['Trusted in-process providers; host owns permission enforcement.','Recovery only at unchanged settled checkpoints within the original deadline.','No automatic candidate adoption.','Method superiority is not established by product acceptance.']}}
export function describeConfiguredTarget(ctx){
 try{const target=ctx.get('duoTarget');return target?{state:'PRESENT',descriptor:structuredClone(target.describe()),qualification:'DECLARATION_ONLY'}:{state:'ABSENT'}}
 catch{return {state:'UNAVAILABLE',requiredAction:'Inspect the configured Target provider; discovery does not execute it.'}}
}
