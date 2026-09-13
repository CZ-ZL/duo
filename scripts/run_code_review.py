"""Public evaluation-only code-review calibration through the existing DSH entry.

offline uses labeled fixed model replies. prepare-live freezes a bounded plan
and makes no requests. Actual execution remains run_dsh_model.py with a matching
current allocation; this script never grants spending or retries.
"""
import argparse
from decimal import Decimal
from datetime import datetime,timezone
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys

import yaml
from dsh_model_profile import ROOT,save,sha,seal_manifest


def inspect_review(out):
    """Report measured control outcomes separately from host completion."""
    out=Path(out);run=out/'run';protocol=json.loads((out/'protocol.json').read_text())
    load=lambda p:json.loads(p.read_text()) if p.exists() else {}
    result=load(run/'result.json');sessions=[load(p) for p in (run/'sessions').glob('*.json')]
    evaluations=result.get('evaluations',[])
    if not evaluations:
        journal=load(run/'journal.json')
        evaluations=[e.get('result',e.get('evaluation')) for e in journal.get('events',[]) if e.get('kind')=='evaluation']
    measured=next((e for e in evaluations if e and e.get('evaluatorId')=='code-review-controls'),{})
    progress=measured.get('costEvidence',{}).get('controlProgress',{})
    control_evidence=next((e for e in measured.get('evidence',[]) if e.get('kind')=='evaluator_control_check'),progress)
    metrics=measured.get('metrics',{})
    real=[s for s in sessions if s.get('costEvidence',{}).get('kind')=='model']
    synthetic=[s for s in sessions if s.get('costEvidence',{}).get('kind')=='fixture']
    actual_cost=lambda rows:None if any(s.get('costCny') is None for s in rows) else float(sum((Decimal(str(s['costCny'])) for s in rows),Decimal(0)))
    requests=sorted(run.glob('model-request-*-input.json'),key=lambda p:int(p.name.split('-')[2]))
    dataset=load(out/'inputs/dataset.json');expected_tasks={t['id']:t['input'] for t in dataset['fast']['tasks']}
    controls=load(out/'inputs/controls.json');bound=len(requests)>0 and len(requests)<=len(controls)
    for index,file in enumerate(requests):
        request=load(file);body=None
        for message in request.get('messages',[]):
            for block in message.get('content',[]):
                try:parsed=json.loads(block.get('text',''))
                except ValueError:continue
                if isinstance(parsed,dict) and 'tasks' in parsed:body=parsed
        expected_codes=json.loads(controls[index]['artifact']['text']) if index<len(controls) else {}
        bound=bound and bool(body and not request.get('tools') and
            {t['id']:t['contract'] for t in body['tasks']}==expected_tasks and
            {t['id']:t['code'] for t in body['tasks']}==expected_codes and
            all(set(t)=={'id','contract','code'} for t in body['tasks']) and
            any(s.get('sessionId')==request.get('sessionId') for s in sessions))
    attempts=lambda rows:sum(s.get('costEvidence',{}).get('attempts',0) for s in rows)
    transport_matches=bool(sessions and len(real if protocol['live'] else synthetic)==len(sessions))
    unknown=(len(sessions)!=len(requests) or any(s.get('costCny') is None for s in sessions) or
             any(s.get('costEvidence',{}).get('attempts') not in [0,1] for s in sessions))
    passed=bool(measured.get('ok') and metrics.get('control_match_rate')==1 and metrics.get('controls_distinguish') is True and
        metrics.get('sample_size')==4 and len(requests)==4 and bound and transport_matches and not unknown)
    summary={'status':'CONTROL_CHECK_PASSED' if passed else 'CONTROL_CHECK_NOT_PASSED','purpose':'code_review_calibration_only',
        'engineeringControlsPassed':passed and not protocol['live'],'realControlsPassed':passed and protocol['live'],
        'higherFidelityProven':False,'optimizationBenefit':False,'independentCallingAgent':False,
        'controlMatchRate':metrics.get('control_match_rate'),'controlsDistinguish':metrics.get('controls_distinguish'),
        'controlRows':control_evidence.get('rows',[]),'stopReason':control_evidence.get('stopReason'),
        'reviewDiagnostics':[row for e in measured.get('evidence',[]) if e.get('kind')=='code_review_diagnostics' for row in e.get('rows',[])],
        'inputContextBound':bool(bound),'transportMatchesProtocol':transport_matches,'unknownUsage':unknown,
        'paidCalls':attempts(real),'syntheticRequests':attempts(synthetic),'costCny':actual_cost(real),
        'syntheticCostCny':actual_cost(synthetic) if synthetic else None,'currency':'CNY',
        'limits':'Only these fixed controls; static code review remains fallible. Host completion and a fixture pass do not qualify a real reviewer.'}
    save(out/'qualification.json',summary)
    lines=[f"Code-review calibration: {summary['status']}",
           f"Real requests: {summary['paidCalls']}; cost CNY: {summary['costCny']}",
           f"Fixture requests: {summary['syntheticRequests']}; usage unknown: {summary['unknownUsage']}"]
    for diagnostic in summary['reviewDiagnostics']:
        problem=diagnostic['error'];lines.append(f"Control {diagnostic['controlId']}: {problem['code']}")
        for detail in problem.get('details',[]):
            lines.append(f"  {detail['taskId'] or 'response'} / {detail['field']}: {detail['code']}. {detail['expected']}")
        if not problem.get('details'):lines.append('  '+problem['message'])
    lines.append('Invalid evidence has no accepted quality score. No automatic retry or optimization benefit is established.')
    (out/'qualification.txt').write_text('\n'.join(lines)+'\n')
    return summary


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--mode',choices=['offline','prepare-live','inspect'],required=True)
    for name in ['controls','output','dsh-package']:p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--pricing',type=Path)
    p.add_argument('--judge-model',default='deepseek-v4-pro')
    p.add_argument('--judge-thinking',choices=['disabled','enabled'],default='disabled',
                   help='Bind the existing isolated DeepSeek provider; does not qualify its judgments')
    p.add_argument('--judge-max-tokens',type=int,default=2048,
                   help='Total output allowance, including reasoning; fixed CNY reservation must cover it')
    p.add_argument('--judge-reservation-cny',type=float,default=.3,
                   help='Explicit finite per-request reservation; total control cap is four times this amount, not spending authority')
    p.add_argument('--fixture-scenario',choices=['normal','constant','uncertain','missing-usage','invalid-quote'],default='normal')
    a=p.parse_args();live=a.mode=='prepare-live';source=a.controls.resolve();out=a.output.resolve()
    if a.mode=='inspect':print(json.dumps(inspect_review(out),ensure_ascii=False));return 0
    if a.judge_max_tokens<=0:p.error('Judge output cap must be a positive integer')
    if not math.isfinite(a.judge_reservation_cny) or a.judge_reservation_cny<=0:p.error('Judge reservation must be finite positive CNY')
    reservation=a.judge_reservation_cny
    total=float(Decimal(str(reservation))*4)
    if not math.isfinite(total):p.error('Total judge reservation must be finite positive CNY')
    if live and a.fixture_scenario!='normal':p.error('Fault scenarios are offline only')
    if live and (not a.pricing or not a.judge_model.strip()):p.error('Explicit current CNY tariff and judge model required')
    prices=json.loads(a.pricing.read_text()) if live else {'id':'synthetic-code-review','currency':'CNY','inputCnyPerMillion':3,'cacheReadCnyPerMillion':.1,'outputCnyPerMillion':9}
    if live and (prices.get('verifiedDate')!=datetime.now(timezone.utc).date().isoformat() or prices.get('model')!=a.judge_model):p.error('Current tariff must bind the exact reviewer model')
    if prices.get('currency')!='CNY' or any('Usd' in k for k in prices):p.error('CNY tariff only')
    manifest=json.loads((source/'manifest.json').read_text())
    if manifest.get('scope')!='CODE_REVIEW_CALIBRATION_ONLY':p.error('Use the predeclared independent control pack')
    for name,h in manifest['files'].items():
        if Path(name).name!=name or sha(source/name)!=h:p.error('Frozen controls changed')
    controls=json.loads((source/'controls.json').read_text())
    if len(controls)!=4:p.error('This bounded qualification contains exactly four control batches')
    # Existing modelSettings rechecks this conservative envelope before dispatch.
    envelope=((16384+4096)*max(prices['inputCnyPerMillion'],prices['cacheReadCnyPerMillion'])+a.judge_max_tokens*prices['outputCnyPerMillion'])/1e6
    if envelope>reservation:p.error('Tariff exceeds the frozen per-request reservation')
    out.mkdir(parents=True,exist_ok=False);inputs=out/'inputs';inputs.mkdir();run=out/'run'
    for name in ['dataset.json','controls.json','manifest.json']:shutil.copy2(source/name,inputs/name)
    if not live:shutil.copy2(source/'fixture-grades.json',inputs/'fixture-grades.json')
    shutil.copy2(ROOT/'examples/native/code-contract-review-policy.json',inputs/'policy.json')
    persona=inputs/'persona.txt';persona.write_text('Evaluate the frozen code-review controls only. This Target is a control carrier, not an optimized production Agent.\n')
    data=json.loads((inputs/'dataset.json').read_text())
    model={'provider':'deepseek-official' if live else 'duo-offline','model':a.judge_model if live else 'fixture',
        'datasetPath':str(inputs/'dataset.json'),'artifactRoot':str(run/'sessions'),'judgmentRoot':str(run/'judgments'),
        'policyPath':str(inputs/'policy.json'),'tiers':['fast'],'evidenceKind':'model' if live else 'fixture','currency':'CNY',
        'maxTokens':a.judge_max_tokens,'maxInputBytes':16384,'timeoutMs':120000 if live else 10000,'reservationCny':reservation,'pricing':prices}
    save(inputs/'reviewer.json',model)
    # Native evaluation-only lifecycle executes the control wrapper once. Its
    # four nested reviewer calls are declared, reserved and never retried.
    contract={'version':1,'id':'code-review-calibration-v3','operation':'evaluate','target':{'kind':'dsh-persona','path':str(persona)},
        'fast':{'evaluatorId':'code-review-controls','version':'3','dataId':data['fast']['id'],'metric':'control_match_rate','weights':{'control_match_rate':1},'direction':'maximize'},
        'constraints':[{'metric':'control_match_rate','op':'==','value':1},{'metric':'controls_distinguish','op':'==','value':True}],
        'epsilon':0,'minSamples':4,'generations':0,'topK':0,'quotas':{'exploit':0,'explore':0,'innovate':0},
        'permissions':{'paid':True,'network':live,'externalSideEffects':False},
        'budget':{'currency':'CNY','maxCostCny':total,'maxSessions':2,'maxFastEvals':1,'maxSlowEvals':0,'maxWallTimeMs':600000}}
    save(inputs/'experiment.json',contract)
    patch=[{'id':i,'disabled':True} for i in ['model-generator','model-executor','model-evaluator','duo-controller','duo-offline-fixture']]
    if live:
        # Cordis replaces config objects; bind the full supported provider route.
        patch.append({'id':'deepseek','config':{'apiKeyEnv':'DEEPSEEK_API_KEY',
            'thinking':a.judge_thinking,'maxTokens':a.judge_max_tokens,
            'retryPolicy':{'mode':'normal','maxRetries':0}}})
    inserted=[{'id':'review-control-controller','name':'@dual-loop/dsh-plugin/evaluation-controller'},
        {'id':'review-controls','name':'./code-review-controls.js','config':{'modelConfigPath':str(inputs/'reviewer.json'),'controlsPath':str(inputs/'controls.json')}}]
    files=['code-contract-review.js','code-review-controls.js','fixture-provider.js']
    if not live:
        patch.append({'id':'fixture','disabled':True});inserted.append({'id':'review-fixture','name':'./code-review-fixture.js','config':{'gradesPath':str(inputs/'fixture-grades.json'),'scenario':a.fixture_scenario}})
        files.append('code-review-fixture.js')
    patch.append({'insert':inserted});(inputs/'providers.patch.yml').write_text(yaml.safe_dump(patch,sort_keys=False))
    save(out/'protocol.json',{'version':5,'purpose':'independent_code_review_calibration_only','live':live,'sourceControls':str(source),
        'reviewerVersion':3,'policyVersion':3,'judgeThinking':a.judge_thinking,'judgeMaxTokens':a.judge_max_tokens,
        'configurationVariant':f'code-review-v3-{a.judge_thinking}-{a.judge_max_tokens}',
        'judgeModel':a.judge_model if live else 'fixture','priorTargetModel':'deepseek-flash','modelStrength':'Different served model; relative quality requires measurement, never inferred from the name.',
        'maxRequests':4,'maxCostCny':total,'currency':'CNY','perRequestReservationCny':reservation,'envelopeCny':envelope,
        'stopping':['four total requests including failures and nested calls',f'CNY{total} total','unknown usage or incomplete review stops the control wrapper','no retry','no promotion or final'],
        'qualification':'All four control batches must exactly match preregistered labels with no uncertainty. Passing validates only these controls, not broad higher fidelity.',
        'realOptimization':False,'independentCaller':False,'automaticDeployment':False})
    command=[sys.executable,str(ROOT/'scripts/run_dsh_model.py'),'--mode',a.mode,'--output',str(run),'--dsh-package',str(a.dsh_package.resolve()),
        '--contract',str(inputs/'experiment.json'),'--dataset',str(inputs/'dataset.json'),'--profile-patch',str(inputs/'providers.patch.yml'),
        '--model-config',str(inputs/'reviewer.json'),
        '--max-cost-cny',str(total),'--max-model-requests','4']
    for name in files:command+=['--profile-file',str(ROOT/'examples/native'/name)]
    if live:command+=['--pricing',str(a.pricing.resolve())]
    result=subprocess.run(command,cwd=ROOT,capture_output=True,text=True,timeout=720)
    (out/'entry.stdout.txt').write_text(result.stdout);(out/'entry.stderr.txt').write_text(result.stderr)
    save(out/'entry.json',{'command':command,'exitCode':result.returncode,'mode':a.mode,'paidCalls':0,'costCny':0})
    if live and result.returncode==0:
        frozen=json.loads((run/'prepared.json').read_text())
        frozen['fileHashes'].update({str(f):sha(f) for f in [*inputs.iterdir(),out/'protocol.json',Path(__file__).resolve()]})
        save(run/'prepared.json',seal_manifest(frozen))
    summary=inspect_review(out) if not live else None
    exit_code=result.returncode or (1 if summary and not summary['engineeringControlsPassed'] else 0)
    print(json.dumps({'status':'PREPARED' if live and exit_code==0 else summary['status'] if summary else 'INCOMPLETE',
                     'exitCode':exit_code,'hostExitCode':result.returncode,'output':str(out),'paidCalls':0}))
    return exit_code


if __name__=='__main__':raise SystemExit(main())
