"""Configured Caller/real function measurement through actual DSH; scripted transport only."""
import json
import os
from pathlib import Path
import subprocess
import sys
import pytest

ROOT = Path(__file__).resolve().parents[1]

@pytest.mark.parametrize('limit,unknown', [(7,False),(5,False),(7,True),(9,False)])
def test_public_caller_attaches_fact_measurement_and_retains_delivery(tmp_path,limit,unknown):
    dsh=os.environ.get('DUO_DSH_PACKAGE')
    if not dsh: pytest.skip('Select an existing cached DSH package')
    prepared=tmp_path/'facts'
    gen=subprocess.run(['node','--loader','./scripts/dsh_native_loader.mjs','examples/native/fact-task.js','--output',str(prepared)],cwd=ROOT,capture_output=True,text=True)
    assert gen.returncode==0,gen.stderr
    target=tmp_path/'persona.txt';target.write_bytes((ROOT/'examples/native/persona.txt').read_bytes());original=target.read_bytes()
    dataset=json.loads((prepared/'dataset.json').read_text())
    contract=json.loads((ROOT/'examples/native/evaluation-experiment.json').read_text())
    contract.update(id='configured-caller-control',target={'kind':'dsh-persona','path':str(target)},fast={'evaluatorId':'fact-support-fast','version':'2','dataId':dataset['fast']['id'],'metric':'supported_accuracy','direction':'maximize','weights':{'supported_accuracy':1}},constraints=[{'metric':'format_valid','op':'==','value':True}],minSamples=5)
    contract['budget'].update(maxCostCny=.1,maxSessions=2,maxFastEvals=1,maxSlowEvals=0,maxWallTimeMs=30000)
    contract['permissions']['paid']=True
    file=tmp_path/'experiment.json';file.write_text(json.dumps(contract))
    out=tmp_path/'host'
    cmd=[sys.executable,str(ROOT/'scripts/run_duo_caller.py'),'--mode','offline','--output',str(out),'--dsh-package',dsh,'--contract',str(file),'--dataset',str(prepared/'dataset.json'),'--answer-key',str(prepared/'answerKey.json'),'--caller-max-requests',str(limit)]
    # Freeze an explicit fixture envelope for the complete public guide/tool
    # transcript (observed 56,108 bytes). Production's 52 KiB default and the
    # input/cost admission guard remain unchanged; this is zero-API transport.
    cmd += ['--caller-max-input-bytes','65536','--caller-reservation-cny','0.16']
    if unknown:cmd.append('--fixture-missing-usage')
    run=subprocess.run(cmd,cwd=ROOT,capture_output=True,text=True,timeout=100)
    assert (out/'result.json').exists(),run.stdout+run.stderr
    r=json.loads((out/'result.json').read_text());calls=json.loads((out/'tool-calls.json').read_text())
    assert r['modelRequests']==r['costCny']==0
    assert r['initialEvaluatorBound'] is False
    assert r['requestCounts']['caller']<=limit and r['requestCounts']['inner']<=1
    assert target.read_bytes()==original
    assert r['independentRealCallerVerified'] is False
    if unknown:
        assert r['status']=='failed' and r['budget']['costCny'] is None
        assert r['requestCounts']=={'caller':1,'inner':0}
        assert r['interpretationValid'] is False
    else:
        described=next(c['result']['value']['data'] for c in calls if c['name']=='cordis_inspect_query' and c['arguments'].get('provider')=='FactMeasurement')
        assert described['discovery']['runtimeService']=='factMeasurement'
        assert described['discovery']['runtimeBound'] is True
        assert described['discovery']['codingCatalogRequired'] is False
        assert 'coding-contract catalog' in described['discovery']['meaning']
        assert r['checks']['callerAttachedCustomEvaluator']
        assert r['checks']['oneCompletedEvaluation']
        assert r['checks']['innerAccounting'] and r['checks']['totalAccounting']
        assert r['requestCounts']['inner']==1
        assert r['delivery']['artifacts']['state']=='FILES_WRITTEN'
        assert r['delivery']['reportModelRequests']==0
        assert len(r['delivery']['reports'])==1
        report=json.loads(Path(r['delivery']['reports'][0]['json']).read_text())
        assert report['candidates'][0]['fast']['metrics']['supported_accuracy']==1
        if limit==5:
            assert r['status']=='failed' and not r['checks']['callerReadReport']
            assert r['delivery']['caller']['state']!='VERIFIED'
        else:
            assert run.returncode==0,run.stdout+run.stderr+str(r.get('failure'))
            assert r['status']=='completed' and all(r['checks'].values())
            assert any(c['name']=='cordis_run' and not c['result']['isError'] for c in calls)
