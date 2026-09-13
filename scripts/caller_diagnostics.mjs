// Explain acceptance failures from recorded facts. This never interprets text
// as executable tools, invokes providers, changes a score, or resumes a run.
export function diagnoseRequestBoundary({kind,options,config,requestBytes}) {
 const expected={provider:config.provider,model:config.model,maxTokens:config.maxTokens}
 const actual={provider:options.provider,model:options.model,maxTokens:options.maxTokens}
 const routeMismatch=Object.keys(expected).filter(k=>actual[k]!==expected[k])
 const maxInputBytes=kind==='caller'?config.callerMaxInputBytes:config.innerMaxInputBytes
 if(!routeMismatch.length&&requestBytes<=maxInputBytes)return null
 return {
  code:routeMismatch.length?'DUO_REQUEST_ROUTE_MISMATCH':'DUO_REQUEST_INPUT_LIMIT',
  component:'combined-request-admission',causeStatus:'ESTABLISHED_AT_ADMISSION',
  message:routeMismatch.length?'Request route or output limit differs from the frozen plan.':`Request input is ${requestBytes} bytes; the frozen ${kind} limit is ${maxInputBytes} bytes.`,
  facts:{kind,requestBytes,maxInputBytes,excessBytes:Math.max(0,requestBytes-maxInputBytes),expected,actual,routeMismatch,providerRequestDispatched:false,reservationCreated:false},
  recovery:{automaticRetry:false,preserveReceipts:true,reconcileCurrentBatchBeforeNewWork:true,
   nextAction:'Inspect the recorded boundary and public tool results. Prepare any changed request envelope before execution, verify its CNY reservation, and deduct every settled attempt under the existing authorization. Do not mutate this sealed run or silently trim its history.'}
 }
}

export function diagnoseCombinedFailure({failure,checks,finalText='',terminalReason}) {
 if(failure)return failure
 const failedChecks=Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name)
 if(!failedChecks.length)return null
 const toolShapedText=finalText.includes('<｜｜DSML｜｜tool_calls>')
 return {
  code:toolShapedText?'DUO_CALLER_TOOL_TEXT':'DUO_COMBINATION_INCOMPLETE',
  component:'combined-caller-acceptance',
  message:toolShapedText?'Caller output contains tool-shaped text while required operations remain incomplete. Text is not a native tool call.':'Caller termination did not satisfy every required experiment and result check.',
  facts:{turnEnd:terminalReason?.kind??'unknown',failedChecks,toolShapedText},
  causeStatus:'NOT_ESTABLISHED',
  recovery:{automaticRetry:false,executeTextAsTools:false,preserveReceipts:true,reconcileCurrentBatchBeforeNewWork:true,nextAction:'Inspect recorded Caller blocks, request/format receipts and unmet stages. A subsequent run needs a separately reviewed launch within the actual remaining authorization; it cannot reset this batch.'}
 }
}
