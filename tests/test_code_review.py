"""Public code-review entry; transport fixtures are never judge qualification."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from prepare_code_review_controls import prepare,IDS,QUOTES


def controls(tmp):
    source=tmp/'source';source.mkdir()
    dataset={'version':1,'responseMode':'python-code-v1','fast':{'id':'fixture-control-contracts','tasks':[{'id':i,'input':QUOTES[i]} for i in IDS]},'slow':{'tasks':[]}}
    (source/'dataset.json').write_text(json.dumps(dataset))
    sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    (source/'answer-key.json').write_text(json.dumps({'datasetSha256':sha(source/'dataset.json'),'tasks':{}}))
    (source/'manifest.json').write_text(json.dumps({'measurementQualification':'DEVELOPMENT_CONTRACT_QUALIFIED','evidenceKind':'fixture','files':{n:sha(source/n) for n in ['dataset.json','answer-key.json']}}))
    output=tmp/'controls';prepare(source,output);return output


@pytest.mark.parametrize('scenario,requests,passed,unknown',[('normal',4,True,False),('constant',4,False,False),('uncertain',1,False,False),('missing-usage',1,False,True),('invalid-quote',1,False,False)])
def test_native_review_controls_and_stop_boundaries(tmp_path,scenario,requests,passed,unknown):
    dsh=os.environ.get('DUO_DSH_PACKAGE')
    if not dsh:pytest.skip('Use existing cached DSH')
    source=controls(tmp_path);out=tmp_path/'host'
    run=subprocess.run([sys.executable,'scripts/run_code_review.py','--mode','offline','--controls',str(source),'--output',str(out),
        '--dsh-package',dsh,'--fixture-scenario',scenario],cwd=ROOT,capture_output=True,text=True,timeout=90)
    assert run.returncode==(0 if scenario=='normal' else 1),run.stdout+run.stderr
    report=json.loads((out/'qualification.json').read_text())
    assert report['syntheticRequests']==requests and report['paidCalls']==0
    assert report['engineeringControlsPassed']==passed
    assert report['realControlsPassed'] is False and report['higherFidelityProven'] is False
    assert report['unknownUsage']==unknown
    assert report['inputContextBound']
    if scenario=='uncertain':assert report['stopReason']=='DUO_EVIDENCE_INVALID'
    if scenario=='missing-usage':assert report['costCny']==0 and report['syntheticCostCny'] is None
    if passed:assert report['controlMatchRate']==1 and report['controlsDistinguish']
    if scenario=='constant':assert report['controlMatchRate']==.5 and not report['controlsDistinguish']
    if scenario=='invalid-quote':
        errors=report['reviewDiagnostics'];assert len(errors)==1 and errors[0]['controlId']=='legal-direct'
        assert errors[0]['error']['code']=='DUO_JUDGE_INVALID'
        details=errors[0]['error']['details'];assert [d['taskId'] for d in details]==IDS
        assert all(d['field']=='contractQuote' and d['code']=='QUOTE_NOT_CONTIGUOUS' for d in details)
        result=json.loads((out/'run/result.json').read_text())
        evidence=result['evaluations'][0]['evidence']
        assert next(e for e in evidence if e['kind']=='code_review_diagnostics')['rows']==errors
        assert 'QUOTE_NOT_CONTIGUOUS' in (out/'run/product-report.json').read_text()
        assert 'QUOTE_NOT_CONTIGUOUS' in (out/'run/journal.json').read_text()
        readable=(out/'qualification.txt').read_text()
        assert 'BigCodeBench/358 / contractQuote' in readable
        assert 'One verbatim contiguous excerpt' in readable
    model_requests=list((out/'run').glob('model-request-*-input.json'));assert len(model_requests)==requests
    assert all(not json.loads(f.read_text()).get('tools') for f in model_requests)
    for file in model_requests:
        request=json.loads(file.read_text())
        body=json.loads(next(m for m in reversed(request['messages']) if m['role']=='user')['content'][0]['text'])
        assert body['outputContract']['maxLength']=={'reason':600,'contractQuote':600,'codeQuote':600,'counterexample':1000}
        assert body['outputContract']['lengthUnit']=='UTF-16 code units after JSON decoding'
        assert body['policy']['version']==3
    plan=json.loads((out/'run/run-plan.json').read_text())
    assert plan['spec']['operation']=='evaluate' and plan['spec']['generations']==0
    assert plan['spec']['budget']['maxCostCny']==1.2 and plan['providers']['evaluators'][0]['maxRequests']==4
    assert plan['spec']['fast']['version']==plan['providers']['evaluators'][0]['version']=='3'
    assert plan['providers']['evaluators'][0]['reviewer']['version']=='3'


def test_review_live_preparation_requires_correct_tariff_before_output(tmp_path):
    source=controls(tmp_path);out=tmp_path/'host'
    price=tmp_path/'price.json';price.write_text(json.dumps({'currency':'CNY','verifiedDate':'1900-01-01','model':'wrong'}))
    run=subprocess.run([sys.executable,'scripts/run_code_review.py','--mode','prepare-live','--controls',str(source),
        '--output',str(out),'--dsh-package',str(tmp_path/'unused'),'--pricing',str(price)],cwd=ROOT,capture_output=True,text=True)
    assert run.returncode==2 and 'Current tariff must bind the exact reviewer model' in run.stderr
    assert not out.exists()


@pytest.mark.parametrize('max_tokens,reservation,envelope', [(4096,None,.294912),(8192,.45,.405504)])
def test_review_live_preparation_binds_thinking_and_output_envelope(tmp_path,max_tokens,reservation,envelope):
    """Preparation boots the real named profile but makes zero model requests."""
    from datetime import datetime, timezone
    import yaml
    dsh=os.environ.get('DUO_DSH_PACKAGE')
    if not dsh:pytest.skip('Use existing cached DSH')
    source=controls(tmp_path);out=tmp_path/'thinking-host'
    price=tmp_path/'price.json'
    price.write_text(json.dumps({'id':'offline-preparation-tariff-fixture','currency':'CNY',
        'verifiedDate':datetime.now(timezone.utc).date().isoformat(),'model':'deepseek-v4-pro',
        'inputCnyPerMillion':9,'cacheReadCnyPerMillion':.3,'outputCnyPerMillion':27}))
    run=subprocess.run([sys.executable,'scripts/run_code_review.py','--mode','prepare-live',
        '--controls',str(source),'--output',str(out),'--dsh-package',dsh,'--pricing',str(price),
        '--judge-thinking','enabled','--judge-max-tokens',str(max_tokens)]+(
            ['--judge-reservation-cny',str(reservation)] if reservation else []),cwd=ROOT,capture_output=True,text=True,timeout=90)
    assert run.returncode==0,run.stdout+run.stderr
    protocol=json.loads((out/'protocol.json').read_text())
    assert protocol['version']==5 and protocol['reviewerVersion']==3
    assert protocol['judgeThinking']=='enabled' and protocol['judgeMaxTokens']==max_tokens
    total=4*(reservation or .3)
    assert protocol['maxRequests']==4 and protocol['maxCostCny']==pytest.approx(total)
    assert protocol['envelopeCny']==pytest.approx(envelope)
    composed=yaml.safe_load((out/'run/duo-model-minimum-config.stdout.txt').read_text())
    provider=next(r for r in composed if r.get('name')=='@deepseek-ai/dsh-llm-deepseek' and not r.get('disabled'))
    assert provider['config']=={'apiKeyEnv':'DEEPSEEK_API_KEY','thinking':'enabled','maxTokens':max_tokens,'retryPolicy':{'mode':'normal','maxRetries':0}}
    plan=json.loads((out/'run/prepare-plan.json').read_text())
    reviewer=plan['providers']['evaluators'][0]['reviewer']
    assert reviewer['model']=='deepseek-v4-pro' and reviewer['maxTokens']==max_tokens
    assert reviewer['reservationCny']==(reservation or .3)
    assert plan['spec']['budget']['maxCostCny']==pytest.approx(total)
    assert reviewer['version']=='3' and plan['spec']['fast']['version']=='3'
    assert not list((out/'run').glob('model-request-*-input.json'))
    assert not list((out/'run/sessions').glob('*.json'))
    frozen=json.loads((out/'run/prepared.json').read_text())
    assert frozen['fileHashes'][str(out/'protocol.json')]==hashlib.sha256((out/'protocol.json').read_bytes()).hexdigest()


@pytest.mark.parametrize('reservation',['0','nan','inf'])
def test_review_refuses_invalid_explicit_reservation(tmp_path,reservation):
    out=tmp_path/'must-not-exist'
    run=subprocess.run([sys.executable,'scripts/run_code_review.py','--mode','offline',
        '--controls',str(tmp_path/'unused'),'--output',str(out),'--dsh-package',str(tmp_path/'unused'),
        '--judge-reservation-cny',reservation],cwd=ROOT,capture_output=True,text=True)
    assert run.returncode==2 and 'finite positive' in run.stderr
    assert not out.exists()


@pytest.mark.parametrize('max_tokens,expected', [('0','positive'),('4097','reservation')])
def test_review_refuses_invalid_or_unfunded_output_cap_before_output(tmp_path,max_tokens,expected):
    from datetime import datetime, timezone
    source=controls(tmp_path);out=tmp_path/'bad'
    price=tmp_path/'price.json'
    #4097 crosses this deliberately chosen fixture tariff's fixed reservation.
    price.write_text(json.dumps({'id':'boundary-fixture','currency':'CNY','model':'deepseek-v4-pro',
        'verifiedDate':datetime.now(timezone.utc).date().isoformat(),
        'inputCnyPerMillion':9,'cacheReadCnyPerMillion':.3,'outputCnyPerMillion':28.2421875}))
    run=subprocess.run([sys.executable,'scripts/run_code_review.py','--mode','prepare-live',
        '--controls',str(source),'--output',str(out),'--dsh-package',str(tmp_path/'unused'),
        '--pricing',str(price),'--judge-thinking','enabled','--judge-max-tokens',max_tokens],
        cwd=ROOT,capture_output=True,text=True)
    assert run.returncode==2 and expected in run.stderr,run.stdout+run.stderr
    assert not out.exists()
