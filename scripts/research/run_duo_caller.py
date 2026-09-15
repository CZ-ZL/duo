#!/usr/bin/env python3
"""Clean public Caller smoke using a supplied fact task and existing evaluator.

No benchmark is generated or selected here. Offline transport is an explicit
control. Real prepare/execute reuse the existing sealed native launcher.
"""
import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
from dsh_model_profile import Profile, ROOT, agent_entries, save, sha, freeze_profile_inputs, seal_manifest

SCOPE='native-configured-caller'

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--mode',choices=['offline','prepare-live','execute'],required=True)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--dsh-package',type=Path)
    p.add_argument('--contract',type=Path)
    p.add_argument('--dataset',type=Path)
    p.add_argument('--answer-key',type=Path)
    p.add_argument('--pricing',type=Path)
    p.add_argument('--authorization',type=Path)
    p.add_argument('--caller-max-requests',type=int,default=7)
    p.add_argument('--caller-max-input-bytes',type=int,default=53248)
    p.add_argument('--caller-reservation-cny',type=float,default=.128)
    p.add_argument('--fixture-missing-usage',action='store_true')
    args=p.parse_args()
    if args.mode=='execute':
        frozen=json.loads((args.output/'prepared.json').read_text())
        if frozen.get('scope')!=SCOPE:p.error('This entry only executes its configured Caller scope')
        command=[sys.executable,str(ROOT/'scripts/research/run_dsh_model.py'),'--mode','execute','--output',str(args.output)]
        if args.authorization:command+=['--authorization',str(args.authorization)]
        return subprocess.run(command,cwd=ROOT).returncode
    live=args.mode=='prepare-live'
    if not all([args.dsh_package,args.contract,args.dataset,args.answer_key]):p.error('Supply existing DSH, native evaluation contract, dataset and separate answer key')
    if not 1<=args.caller_max_requests<=12 or not 1024<=args.caller_max_input_bytes<=131072 or not math.isfinite(args.caller_reservation_cny) or args.caller_reservation_cny<=0:p.error('Finite Caller request/input/cost reservation required')
    if args.caller_reservation_cny>.9:p.error('Each Caller reservation must fit its CNY.90 suballowance; inner CNY.10 remains separate')
    if live and (not args.pricing or args.fixture_missing_usage):p.error('Fresh official CNY pricing and no fixture flags required')
    pricing=json.loads(args.pricing.read_text()) if live else {'id':'configured-caller-fixture-cny','currency':'CNY','inputCnyPerMillion':2,'cacheReadCnyPerMillion':.04,'outputCnyPerMillion':8}
    if live and pricing.get('verifiedDate')!=datetime.now(timezone.utc).date().isoformat():p.error('Refresh official tariff for current UTC date')
    envelope=((args.caller_max_input_bytes+4096)*max(pricing['inputCnyPerMillion'],pricing['cacheReadCnyPerMillion'])+1536*pricing['outputCnyPerMillion'])/1e6
    if pricing.get('currency')!='CNY' or args.caller_reservation_cny+1e-12<envelope:p.error('Caller reservation does not cover frozen input/output envelope')
    contract=json.loads(args.contract.read_text());dataset=json.loads(args.dataset.read_text())
    if contract.get('operation')!='evaluate' or contract.get('generations')!=0 or contract.get('slow') or contract.get('final') or contract.get('budget',{}).get('maxCostCny')!=.1 or contract['budget'].get('currency')!='CNY':p.error('This bounded smoke requires one Fast-only evaluation, no search/final, and explicit CNY.10 inner allowance')
    if contract.get('fast',{}).get('evaluatorId')!='fact-support-fast' or contract['fast'].get('version')!='2' or contract['fast'].get('dataId')!=dataset['fast']['id']:p.error('This example uses the existing fact-support v2 evaluator; declare matching task identity')
    target=Path(contract['target']['path']);target=(args.contract.parent/target).resolve();contract['target']['path']=str(target)
    if not target.is_file():p.error('Target must be an existing authorized file')
    if contract['permissions']!={'paid':True,'network':live,'externalSideEffects':False}:p.error('Contract permissions must match the explicit live/offline mode')
    host=Profile(args.dsh_package,args.output);(host.output/'inputs').mkdir();host.pack()
    for file,source in [('dataset.json',args.dataset),('answerKey.json',args.answer_key)]:shutil.copyfile(source,host.output/'inputs'/file)
    shutil.copyfile(ROOT/'AGENT_GUIDE.md',host.output/'PUBLIC_GUIDE.md')
    save(host.output/'pricing.json',pricing);save(host.output/'experiment.json',contract)
    save(host.output/'input-provenance.json',{str(x.resolve()):sha(x) for x in [args.contract,args.dataset,args.answer_key,target]})
    experiment=str(host.output/'experiment.json');providerName='deepseek-official' if live else 'duo-configured-caller-fixture';model='deepseek-v4-flash' if live else 'fixture'
    resources={'purpose':'Use public DUO tools to inspect and attach the supplied existing fact measurement, inspect the supplied frozen evaluation-only contract and its actual native plan, run once and read its report with view summary (full facts remain available on demand). Explain measured task quality, limits, and costs. No search, final test, retries, contract changes or adoption.',
        'targetPath':str(target),'experimentPath':experiment,'firstContract':contract,'evaluatorIdPrefix':'fact-support-',
        'resourceDiscovery':'Supplied public resource: cordis_inspect_query with platform host, provider FactMeasurement, method describe, input {}. Read its service contract, descriptors and authorized bridge code; attach that exact adapter via cordis_define and cordis_run. No evaluator is prebound to DUO. Inspect the native plan in a subsequent tool step after the adapter starts.',
        'fileAuthority':'This is the complete-input starting point. The supplied contract is already saved in the isolated profile. Inspect actual target and contract through dualloop_plan; no file editing is needed or authorized. Private dataset, answer-key, final and request/receipt files are outside Caller read scope.',
        'budget':{'currency':'CNY','maxCostCny':1,'callerMaxCostCny':.9,'innerMaxCostCny':.1,'callerRequestCap':args.caller_max_requests,'innerRequestCap':1,'callerMaxInputBytes':args.caller_max_input_bytes,'callerReservationCny':args.caller_reservation_cny,'innerReservationCny':.1,'requestCapMeaning':'An additional ceiling, not a promise that every worst-case request is affordable. Per-role CNY admission can stop earlier; deterministic report export needs no Caller request.','retryPolicy':'No automatic retry. All nested requests included; suballowances cannot be transferred.'},
        'finalResponseRules':'Return one JSON object with runId and conclusion copied verbatim from the actual DUO report, evaluatorId fact-support-fast, improvementProven false, innerLedgerCostCny copied as a number or null, evidenceKind real_model for live or fixture offline, costAccounting final_total_ledger_required, and a concise factual explanation. Your final Caller fee is available only after settlement, so refer to total-cost-receipts.json; native inner cost omits Caller fees and must not be double counted.',
        'evidenceLimits':['Supplied task is synthetic keyed fact extraction, not a real business adoption.','Fact/support evaluator uses known rule-generated keys; controls verify discrimination, no general external truth guarantee.','Evaluation-only has no generated candidate, optimization benefit, Slow search or final confirmation.','Caller and inner usage are separately counted; aggregate and inner ledgers overlap.']}
    save(host.output/'resources.json',resources)
    # The actual adapter source is a public supplied resource, never generated by
    # this driver and never pre-attached. Its exact bytes bound host-code authority.
    source=(ROOT/'examples/native/fact-evaluator-resource.js').read_text()
    bridge=json.loads(source.split('export const bridgeCode=',1)[1].split('\n',1)[0])
    config={'output':str(host.output),'live':live,'workflow':'evaluation_only','scope':SCOPE,'guidePath':str(host.output/'PUBLIC_GUIDE.md'),'resourcesPath':str(host.output/'resources.json'),'adapterBridgeCode':bridge,
        'provider':providerName,'model':model,'maxTokens':1536,'maxCostCny':1,'maxModelRequests':args.caller_max_requests+1,'callerRequestCap':args.caller_max_requests,'innerRequestCap':1,'callerMaxCostCny':.9,'innerMaxCostCny':.1,
        'callerReservationCny':args.caller_reservation_cny,'innerReservationCny':.1,'callerMaxInputBytes':args.caller_max_input_bytes,'innerMaxInputBytes':32768,'timeoutMs':900000 if live else 60000,'pricing':pricing}
    provider={'provider':providerName,'model':model,'maxTokens':1536,'datasetPath':str(host.output/'inputs/dataset.json'),'artifactRoot':str(host.output/'sessions'),'evidenceKind':'model' if live else 'fixture','currency':'CNY','reservationCny':.1,'maxInputBytes':32768,'timeoutMs':90000 if live else 5000,'pricing':pricing}
    entries=agent_entries()+[
        {'id':'caller-cordis-runner','name':'@deepseek-ai/dsh-cordis-host-runner'},
        {'id':'caller-cordis-tools','name':'@deepseek-ai/dsh-tool-cordis'},
        {'id':'caller-json-extension','name':'@deepseek-ai/dsh-deepseek-llm-api-extensions'},
        {'id':'caller-json','name':'@dual-loop/dsh-plugin/json-output','config':{'artifactRoot':str(host.output/'request-formats'),'includeCallerSessions':True}},
        ({'id':'caller-provider','name':'@deepseek-ai/dsh-llm-deepseek','config':{'apiKeyEnv':'DEEPSEEK_API_KEY','thinking':'disabled','maxTokens':1536,'retryPolicy':{'mode':'normal','maxRetries':0}}} if live else {'id':'caller-fixture','name':'./dsh_configured_caller_fixture.js','config':{'resourcesPath':str(host.output/'resources.json'),'answerKeyPath':str(host.output/'inputs/answerKey.json'),'missingUsage':args.fixture_missing_usage}}),
        {'id':'caller-executor','name':'@dual-loop/dsh-plugin/model-executor','config':provider},
        {'id':'caller-measurement-resource','name':'./fact-evaluator-resource.js','config':{'datasetPath':provider['datasetPath'],'answerKeyPath':str(host.output/'inputs/answerKey.json')}},
        {'id':'caller-entry','name':'./dsh_caller_host.js','config':config}]
    patches=[{'id':n,'disabled':True} for n in ['duo-controller','duo-observer','duo-observer-tools','dualloop']]
    patches += [{'id':'duo-contract','config':{'experiment':experiment}},{'id':'duo-journal','config':{'root':str(host.output/'journal')}},
        # The default bundle wires the bundled offline fixture; the caller
        # providers below replace it (duplicate service registration fails boot).
        {'id':'duo-offline-fixture','disabled':True},
        {'insert':[{'id':'duo-deferred-runtime','name':'@dual-loop/dsh-plugin/deferred-runtime','config':{'evaluationOnly':True}},*entries]}]
    scripts=['dsh_caller_host.js','caller_diagnostics.mjs']+([] if live else ['dsh_configured_caller_fixture.js'])
    profile=host.stage('duo-configured-caller',patches,scripts,bundles=['@dual-loop/dsh-plugin'])
    modules=['fact-evaluator-resource.js','fact-evaluator.js','fact-task.js']
    for file in modules:shutil.copyfile(ROOT/'examples/native'/file,profile/file)
    result=host.boot('duo-configured-caller',timeout=90)
    if live and result.returncode==0:
        inputs=[host.output/f for f in ['pricing.json','PUBLIC_GUIDE.md','resources.json','experiment.json','input-provenance.json']]+list((host.output/'inputs').glob('*'))+[profile/f for f in modules+scripts]+[ROOT/'scripts/research/run_duo_caller.py',target]
        for package in ['dsh-cordis-host-runner','dsh-tool-cordis','dsh-fs','dsh-fs-local','dsh-fs-observation-policy','dsh-tool-fs','dsh-typert-protocol']:
            base=host.dsh.parent/package;inputs += [base/'package.json',*sorted((base/'lib').rglob('*.js'))]
        frozen=seal_manifest({'status':'PREPARED_NOT_AUTHORIZED','scope':SCOPE,'currency':'CNY','maxCostCny':1,'maxModelRequests':config['maxModelRequests'],'callerRequestCap':args.caller_max_requests,'innerRequestCap':1,'profile':'duo-configured-caller','dshPackage':str(host.dsh),'planDigest':json.loads((host.output/'prepare-plan.json').read_text())['planDigest'],**freeze_profile_inputs(host,profile,inputs)})
        save(host.output/'prepared.json',frozen)
        save(host.output/'authorization-template.json',{k:frozen[k] for k in ['scope','currency','maxCostCny','maxModelRequests','manifestDigest','planDigest']}|{'approvedBy':None,'authorizationText':None,'batch':'EXPLICIT_CURRENT_ALLOCATION_REQUIRED'})
    print(args.mode,'Caller exit:',result.returncode,'output:',host.output)
    return result.returncode

if __name__=='__main__':raise SystemExit(main())
