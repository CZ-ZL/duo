"""Two-response Caller format diagnostic using the existing native DSH launcher.

Preparation/offline modes never dispatch paid work. This is a separately reviewed
slice of the existing maturation batch, not a new allocation or optimizer.
"""
import argparse
from datetime import datetime, timezone
from decimal import Decimal
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
from dsh_model_profile import Profile, ROOT, agent_entries, save, sha, freeze_profile_inputs, seal_manifest

SCOPE='native-maturation-caller-format-probe'
PARENT_SCOPE='native-maturation-caller-warm-start'

def number(value):
    if isinstance(value,bool) or not isinstance(value,(int,float)):
        raise ValueError('Finite known numeric accounting required')
    n=Decimal(str(value))
    if not n.is_finite() or n<0: raise ValueError('Finite nonnegative accounting required')
    return n

def parent_allocation(parent_run, authorization_path, summary_path):
    parent_run=Path(parent_run).resolve();authorization_path=Path(authorization_path).resolve();summary_path=Path(summary_path).resolve()
    read=lambda p:json.loads(p.read_text())
    auth=read(authorization_path);summary=read(summary_path)
    result=read(parent_run/'result.json');requests=read(parent_run/'requests.json');budget=read(parent_run/'total-budget.json');receipts=read(parent_run/'total-cost-receipts.json')
    if auth.get('scope')!=PARENT_SCOPE or summary.get('scope')!=PARENT_SCOPE or auth.get('approvedBy')!='user' or not auth.get('authorizationText') or not auth.get('batch') or auth['batch']!=summary.get('batch'):
        raise ValueError('A bound approved maturation parent batch is required; no other allowance')
    if auth.get('currency')!='CNY' or summary.get('currency')!='CNY' or result.get('status') not in ['completed','failed'] or result.get('evidenceKind')!='real_caller_real_inner_custom_schema_evaluation':
        raise ValueError('A terminal actual-model CNY parent receipt is required')
    if result.get('runId')!=auth.get('planDigest') or result.get('planDigest')!=auth['planDigest'] or summary.get('realRunId')!=result['runId']:
        raise ValueError('Parent plan identity mismatch')
    for file,key in [('result.json','resultSha256'),('requests.json','requestReceiptSha256'),('total-cost-receipts.json','totalCostReceiptsSha256')]:
        if sha(parent_run/file)!=summary.get(key):raise ValueError('Parent receipt changed: '+file)
    if not requests or len(requests)!=len(receipts) or len({x['id'] for x in requests})!=len(requests) or any(x.get('kind') not in ['caller','inner'] or not x.get('usage') for x in requests):
        raise ValueError('Every parent dispatch needs known usage and one settlement')
    cost=sum((number(x.get('costCny')) for x in requests),Decimal(0));total=len(requests)
    if any(number(x)!=cost for x in [result.get('costCny'),budget.get('costCny'),summary.get('usedCostCny')]) or sum((number(x.get('cost'))/Decimal(10**9) for x in receipts),Decimal(0))!=cost:
        raise ValueError('Parent costs disagree')
    if any(x!=total for x in [result.get('modelRequests'),budget.get('operations'),summary.get('usedModelRequests')]) or not summary.get('allUsageKnown') or budget.get('blockedReason') or number(budget.get('reservedCostCny'))!=0:
        raise ValueError('Parent accounting is unresolved')
    limits={k:number(auth.get(k)) for k in ['maxCostCny','maxModelRequests','callerRequestCap','innerRequestCap']}
    if limits['maxCostCny']>4 or limits['maxModelRequests']>40 or any(limits[k]!=int(limits[k]) for k in ['maxModelRequests','callerRequestCap','innerRequestCap']) or limits['callerRequestCap']>20 or limits['innerRequestCap']>20:
        raise ValueError('Parent exceeds the reviewed maturation batch limits')
    counts={kind:sum(x['kind']==kind for x in requests) for kind in ['caller','inner']}
    for kind in counts:
        cap=int(limits[kind+'RequestCap']);row=summary.get('byKind',{}).get(kind,{})
        if row!={'used':counts[kind],'cap':cap,'remaining':cap-counts[kind]} or result.get('requestCounts',{}).get(kind)!=counts[kind]:raise ValueError('Parent suballowance mismatch')
    if number(summary.get('maxCostCny'))!=limits['maxCostCny'] or number(summary.get('maxModelRequests'))!=limits['maxModelRequests'] or number(summary.get('remainingCostCny'))!=limits['maxCostCny']-cost or number(summary.get('remainingModelRequests'))!=limits['maxModelRequests']-total:
        raise ValueError('Parent remaining allowance mismatch')
    if limits['maxCostCny']-cost<Decimal('.5') or limits['maxModelRequests']-total<2 or limits['callerRequestCap']-counts['caller']<2:
        raise ValueError('Existing batch cannot cover the fixed CNY0.5 / 2-request diagnostic')
    files=[authorization_path,summary_path,*[parent_run/name for name in ['result.json','requests.json','total-budget.json','total-cost-receipts.json']]]
    return {'batch':auth['batch'],'parentRunId':result['runId'],'priorRequests':total,'priorCostCny':float(cost),'priorCallerRequests':counts['caller'],'priorInnerRequests':counts['inner'],
        'batchMaxRequests':int(limits['maxModelRequests']),'batchMaxCostCny':float(limits['maxCostCny']),'callerRemaining':int(limits['callerRequestCap'])-counts['caller'],'innerRemaining':int(limits['innerRequestCap'])-counts['inner'],
        'probeMaxRequests':2,'probeMaxCostCny':.5,'sourceHashes':{str(p):sha(p) for p in files}}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--mode',choices=['offline','prepare-live','execute'],required=True)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--dsh-package',type=Path)
    p.add_argument('--parent-run',type=Path)
    p.add_argument('--batch-authorization',type=Path)
    p.add_argument('--batch-summary',type=Path)
    p.add_argument('--request-id',default='request-4')
    p.add_argument('--pricing',type=Path)
    p.add_argument('--authorization',type=Path)
    p.add_argument('--fixture-missing-usage',action='store_true')
    args=p.parse_args()
    if args.mode=='execute':
        frozen=json.loads((args.output/'prepared.json').read_text())
        if frozen.get('scope')!=SCOPE:p.error('Wrong prepared diagnostic scope')
        if not (args.output/'result.json').exists():
            current=parent_allocation(*map(Path,frozen['parentInputs']))
            if current!=frozen['batchCarry']:p.error('Parent batch consumption changed; inspect rather than reset allowance')
        command=[sys.executable,str(ROOT/'scripts/research/run_dsh_model.py'),'--mode','execute','--output',str(args.output)]
        if args.authorization:command+=['--authorization',str(args.authorization)]
        return subprocess.run(command,cwd=ROOT).returncode
    if not all([args.dsh_package,args.parent_run,args.batch_authorization,args.batch_summary]):p.error('Cached DSH and explicit parent run, batch authorization and current summary required')
    live=args.mode=='prepare-live'
    if live and (not args.pricing or args.fixture_missing_usage):p.error('Real preparation needs fresh pricing and no fixture override')
    parent_inputs=[str(x.resolve()) for x in [args.parent_run,args.batch_authorization,args.batch_summary]]
    try:carry=parent_allocation(*map(Path,parent_inputs))
    except (ValueError,KeyError,TypeError) as error:p.error(str(error))
    if not re.fullmatch(r'request-[1-9][0-9]{0,3}',args.request_id):p.error('Use an actual bounded parent request ID')
    source=args.parent_run/(args.request_id+'-input.json');original=json.loads(source.read_text())
    row=next((x for x in json.loads((args.parent_run/'requests.json').read_text()) if x['id']==args.request_id),None)
    if not row or row['kind']!='caller' or original.get('sessionId')!=row.get('sessionId') or original.get('evidenceKind')!='model' or original.get('provider')!='deepseek-official' or original.get('model')!='deepseek-v4-flash':p.error('Use a real Caller input belonging to this parent request')
    pricing=json.loads(args.pricing.read_text()) if args.pricing else {'id':'format-probe-synthetic','currency':'CNY','inputCnyPerMillion':3,'cacheReadCnyPerMillion':.1,'outputCnyPerMillion':9}
    if live and (pricing.get('currency')!='CNY' or pricing.get('verifiedDate')!=datetime.now(timezone.utc).date().isoformat()):p.error('Current official UTC-date CNY tariff required')
    host=Profile(args.dsh_package,args.output);host.pack();shutil.copyfile(source,host.output/'caller-input.json');save(host.output/'pricing.json',pricing);save(host.output/'parent-allocation.json',carry)
    config={'output':str(host.output),'live':live,'sourcePath':str(host.output/'caller-input.json'),'sourceSha256':sha(source),'provider':'deepseek-official' if live else 'duo-format-fixture','model':'deepseek-v4-flash','maxTokens':2048,'maxInputBytes':70000,'maxCostCny':.5,'maxModelRequests':2,'reservationCny':.25,'timeoutMs':210000 if live else 15000,'pricing':pricing,'parent':carry,'arms':['json_on','json_off']}
    entries=agent_entries()+[
        {'id':'probe-journal','name':'@dual-loop/dsh-plugin/journal','config':{'root':str(host.output/'journal')}},
        {'id':'probe-budget','name':'@dual-loop/dsh-plugin/budget'},
        {'id':'probe-extensions','name':'@deepseek-ai/dsh-deepseek-llm-api-extensions'},
        ({'id':'probe-provider','name':'@deepseek-ai/dsh-llm-deepseek','config':{'apiKeyEnv':'DEEPSEEK_API_KEY','thinking':'disabled','maxTokens':2048,'retryPolicy':{'mode':'normal','maxRetries':0}}} if live else {'id':'probe-fixture','name':'./dsh_caller_format_fixture.js','config':{'missingUsage':args.fixture_missing_usage}}),
        {'id':'probe-entry','name':'./dsh_caller_format_probe.js','config':config}]
    scripts=['dsh_caller_format_probe.js']+([] if live else ['dsh_caller_format_fixture.js'])
    profile=host.stage('duo-caller-format-probe',[{'insert':entries}],scripts)
    result=host.boot('duo-caller-format-probe',timeout=45)
    if live and result.returncode==0:
        inputs=[host.output/name for name in ['caller-input.json','pricing.json','parent-allocation.json']]+[profile/'dsh_caller_format_probe.js',ROOT/'scripts/research/run_caller_format_probe.py',source.resolve(),*map(Path,carry['sourceHashes'])]
        frozen=seal_manifest({'status':'PREPARED_NOT_AUTHORIZED','scope':SCOPE,'currency':'CNY','maxCostCny':.5,'maxModelRequests':2,'profile':'duo-caller-format-probe','dshPackage':str(host.dsh),'planDigest':json.loads((host.output/'prepare-plan.json').read_text())['planDigest'],'parentInputs':parent_inputs,'batchCarry':carry,**freeze_profile_inputs(host,profile,inputs)})
        save(host.output/'prepared.json',frozen)
        save(host.output/'authorization-template.json',{'scope':SCOPE,'currency':'CNY','maxCostCny':.5,'maxModelRequests':2,'planDigest':frozen['planDigest'],'manifestDigest':frozen['manifestDigest'],'batch':carry['batch'],'approvedBy':None,'authorizationText':None,'purpose':'One response per JSON-mode arm; no tool execution. Charge to the existing maturation batch after its prior recorded spend.'})
    print(args.mode,'diagnostic exit:',result.returncode,'output:',host.output)
    return result.returncode

if __name__=='__main__':raise SystemExit(main())
