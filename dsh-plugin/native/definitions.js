import { Service } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'

export const fail = (code, message) => { throw new HarnessError(message, code) }
export const required = () => fail('DUO_NOT_IMPLEMENTED', 'A DUO service provider must implement this method')
export class ContractService extends Service {
  constructor(ctx) { super(ctx, 'duoContract') }
  resolve() { return required() }
}
export class TargetService extends Service {
  constructor(ctx) { super(ctx, 'duoTarget') }
  describe() { return required() }
  snapshot() { return required() }
  apply() { return required() }
  // Compatibility: older adapters own their content version. New adapters may
  // override identity; history is unsupported until explicit validators exist.
  identity(snapshot) { return snapshot.version }
  validateSnapshot() { return false }
  projectDelta() { return fail('DUO_HISTORY_UNSUPPORTED','The configured Target does not provide a safe historical Delta projection') }
}
export class ComparatorService extends Service {
  constructor(ctx) { super(ctx, 'duoComparator') }
  describe() { return required() }
  compare() { return required() }
}
export class GateService extends Service {
  constructor(ctx) { super(ctx, 'duoGate') }
  describe() { return required() }
  select() { return required() }
}
export class FeedbackService extends Service {
  constructor(ctx) { super(ctx, 'duoFeedback') }
  describe() { return required() }
  summarize() { return required() }
}
export class JournalService extends Service {
  constructor(ctx) { super(ctx, 'duoJournal') }
  describe() { return required() }
  open() { return required() }
}
export class BudgetService extends Service {
  constructor(ctx) { super(ctx, 'duoBudget') }
  describe() { return required() }
  open() { return required() }
  inspect() { return required() }
  reconcile() { return required() }
}
export class GeneratorService extends Service {
  constructor(ctx) { super(ctx, 'duoGenerator') }
  describe() { return required() }
  propose() { return required() }
}
export class ExecutorService extends Service {
  constructor(ctx) { super(ctx, 'duoExecutor') }
  describe() { return required() }
  execute() { return required() }
}
export class EvaluatorsService extends Service {
  constructor(ctx) { super(ctx, 'duoEvaluators') }
  describe() { return required() }
  evaluate() { return required() }
}
export class ControllerService extends Service {
  constructor(ctx) { super(ctx, 'duoController') }
  plan() { return required() }
  run() { return required() }
  status() { return required() }
}
export class ObserverService extends Service {
  constructor(ctx) { super(ctx, 'duoObserver') }
  describe() { return required() }
  report() { return required() }
}

// Cordis wraps accessed methods, so function equality on ctx.duo* is not a
// reliable implementation check. Tag abstract definitions and inspect their
// property descriptors without invoking work. Symbol identity survives the
// host loading the same package through separate module identities.
const abstractMethod=Symbol.for('@dual-loop/dsh-plugin/abstract-method')
for(const Base of [ContractService,TargetService,ComparatorService,GateService,FeedbackService,JournalService,BudgetService,GeneratorService,ExecutorService,EvaluatorsService,ControllerService,ObserverService]){
 for(const key of Object.getOwnPropertyNames(Base.prototype))if(key!=='constructor')Object.defineProperty(Base.prototype[key],abstractMethod,{value:true})
}
export function assertProviderMethods(service,component,methods){
 for(const method of methods){
  let descriptor,object=service
  while(object&&!descriptor){descriptor=Object.getOwnPropertyDescriptor(object,method);object=Object.getPrototypeOf(object)}
  if(typeof descriptor?.value!=='function'||descriptor.value[abstractMethod])throw Object.assign(new HarnessError(`Configured ${component} must implement ${method} as a concrete method before execution`,'DUO_PROVIDER_INTERFACE'),{component})
 }
}
