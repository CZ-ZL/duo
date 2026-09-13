"""Bounded admission, accounting and actual-host acceptance of the new entries."""
import json
import os
from pathlib import Path
import subprocess
import sys
import pytest

ROOT=Path(__file__).resolve().parents[1]


def command(script,*args):
    return subprocess.run([sys.executable,str(ROOT/'scripts'/script),*map(str,args)],cwd=ROOT,
        env={'PATH':os.environ['PATH']},text=True,capture_output=True,timeout=90)


def test_comparison_requires_its_own_exact_allocation_before_credentials(tmp_path):
    (tmp_path/'comparison-protocol.json').write_text('{"arms":[]}')
    (tmp_path/'comparison-prepared.json').write_text('{"planDigest":"p","fileHashes":{}}')
    r=command('run_native_comparison.py','--mode','execute','--output',tmp_path)
    assert r.returncode==2 and 'Explicit CNY allocation required' in r.stderr
    auth={'scope':'native-three-arm-comparison','approvedBy':'user','authorizationText':'fixture only',
        'currency':'CNY','planDigest':'p','maxCostCny':3,'maxModelRequests':40}
    for change in [{'scope':'native-minimum-two-generation'},{'maxCostCny':float('nan')},{'maxModelRequests':True},
                   {'currency':'USD'},{'maxCostUsd':3},{'planDigest':'foreign'}]:
        path=tmp_path/'auth.json';path.write_text(json.dumps({**auth,**change}))
        r=command('run_native_comparison.py','--mode','execute','--output',tmp_path,'--authorization',path)
        assert r.returncode==2 and 'Authorization does not match' in r.stderr
        assert not (tmp_path/'execution-claim.json').exists()


def test_interrupted_comparison_never_automatically_replays(tmp_path):
    (tmp_path/'comparison-protocol.json').write_text('{"arms":[]}')
    (tmp_path/'comparison-prepared.json').write_text('{"planDigest":"p"}')
    (tmp_path/'execution-claim.json').write_text('{}')
    r=command('run_native_comparison.py','--mode','execute','--output',tmp_path)
    assert r.returncode==2 and 'Existing batch claim' in r.stderr


def test_native_caller_actual_loop_success_and_unknown_usage_stop(tmp_path):
    dsh=os.environ.get('DUO_DSH_PACKAGE')
    if not dsh:pytest.skip('Set DUO_DSH_PACKAGE to an existing cached DSH')
    for missing in [False,True]:
        out=tmp_path/('unknown' if missing else 'normal')
        r=command('run_native_calling.py','--mode','offline','--output',out,'--dsh-package',dsh,
                  *(['--fixture-missing-usage'] if missing else []))
        report=json.loads((out/'result.json').read_text())
        assert report['paidCalls']==0 and report['costCny']==0
        assert report['modelAutonomyEvaluated'] is False
        if missing:
            assert r.returncode!=0
            assert report['status']=='failed'
            assert report['unknownCost'] is True
            assert report['budget']['costCny'] is None
            assert report['modelRequests']==1
        else:
            assert r.returncode==0, r.stderr+r.stdout
            assert report['status']=='completed'
            assert report['modelRequests']==6
            assert report['firstValidRunMs']>0
            assert report['recoveredError'] and report['reusedRun'] and report['interpretationValid']
            assert report['budget']['reservedCostCny']==0
            assert len(json.loads((out/'cost-receipts.json').read_text()))==6
            probes=json.loads((out/'fixture-json-output-probes.json').read_text())
            assert len(probes)==report['modelRequests']
            assert all(p['fields']=={'response_format':{'type':'json_object'}} for p in probes)


def test_comparison_rejects_tampered_manifest_even_with_old_digest(tmp_path):
    (tmp_path/'comparison-protocol.json').write_text('{"arms":[]}')
    (tmp_path/'comparison-prepared.json').write_text('{"planDigest":"old-digest","fileHashes":{}}')
    path=tmp_path/'auth.json'
    path.write_text(json.dumps({'scope':'native-three-arm-comparison','approvedBy':'user','authorizationText':'fixture only',
        'currency':'CNY','planDigest':'old-digest','maxCostCny':3,'maxModelRequests':40}))
    r=command('run_native_comparison.py','--mode','execute','--output',tmp_path,'--authorization',path)
    assert r.returncode==2 and 'manifest digest mismatch' in r.stderr
    assert not (tmp_path/'execution-claim.json').exists()


def test_comparison_partial_receipts_remain_visible_in_inspection(tmp_path):
    arm=tmp_path/'arm';arm.mkdir();(arm/'sessions').mkdir()
    (arm/'result.json').write_text('{"status":"failed"}')
    (arm/'sessions/request.json').write_text('{"currency":"CNY","costCny":0.01,"costEvidence":{"attempts":1,"kind":"model"}}')
    (arm/'sessions/truncated.json').write_text('{"currency":')
    protocol={'live':True,'arms':[{'arm':'dual_loop','repeat':1,'directory':'arm'}]}
    (tmp_path/'comparison-protocol.json').write_text(json.dumps(protocol))
    r=command('run_native_comparison.py','--mode','inspect','--output',tmp_path)
    assert r.returncode==0,r.stderr
    report=json.loads((tmp_path/'comparison-result.json').read_text())
    assert report['status']=='INCOMPLETE'
    assert report['knownCostCny']==0.01
    assert report['totalCostCny'] is None
    assert report['arms'][0]['status']=='UNCERTAIN'
    assert report['arms'][0]['knownPaidCalls']==1
    assert report['arms'][0]['receiptErrors']==['truncated.json: invalid receipt JSON']
