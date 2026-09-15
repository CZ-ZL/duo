// Retained historical entry; shared admission, execution and delivery live in the current Caller driver.
import {apply as applyCaller,inject} from './dsh_caller_host.js'
import {bridgeCode} from './schema-answer-evaluator.js'
export {inject}
export const name='duo-maturation-combined-acceptance'
export const apply=(ctx,config)=>applyCaller(ctx,{...config,adapterBridgeCode:bridgeCode})
