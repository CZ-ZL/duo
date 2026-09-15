"""Real isolated program discrimination and incremental evidence, not optimization."""
import hashlib
import json
from pathlib import Path
import shutil
import sys
import os
import subprocess
import pytest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts/research'))
from prepare_code_properties import prepare,qualify
SOURCE=ROOT/'runs/code-method-goal-20260912/benchmark-v24-qualified'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()


def test_fixed_properties_add_measured_discrimination_without_final(tmp_path):
    original={p.name:sha(p) for p in SOURCE.iterdir() if p.is_file()}
    pack=tmp_path/'properties';prepare(SOURCE,pack)
    data=json.loads((pack/'dataset.json').read_text())
    assert 'final' not in data
    assert [t['id'] for t in data['slow']['tasks']]==['BigCodeBench/358','BigCodeBench/412']
    assert data['fast']==json.loads((SOURCE/'dataset.json').read_text())['fast']
    assert json.loads((pack/'answer-key.json').read_text())['propertyTiers']==['slow']
    assert json.loads((pack/'calibration-pack/answer-key.json').read_text())['propertyTiers']==['fast','slow']
    result=qualify(pack,tmp_path/'checked')
    assert result['status']=='QUALIFIED_BOUNDED_INCREMENTAL'
    assert result['oldTaskPassRates']==[1,1,0,1,1,0]
    assert result['newTaskPassRates']==[1,1,0,.5,.5,0]
    assert len(result['incrementalWitnesses'])==2
    assert {x['taskId'] for x in result['incrementalWitnesses']}=={'BigCodeBench/358','BigCodeBench/412'}
    assert all(x['oldPassed'] and not x['newPassed'] and x['failedExtraTests'] for x in result['incrementalWitnesses'])
    assert result['modelRequests']==0 and result['costCny']==0
    measured=json.loads((tmp_path/'checked/source-reference/new/evaluation.json').read_text())
    assert measured['evidence'][0]['qualification']=='BOUNDED_PROPERTY_METAMORPHIC_CHECKS'
    assert result['optimizationBenefit'] is False
    assert {p.name:sha(p) for p in SOURCE.iterdir() if p.is_file()}==original


def test_refuses_changed_source_before_preparation(tmp_path):
    source=tmp_path/'source';shutil.copytree(SOURCE,source)
    with (source/'answer-key.json').open('a') as stream:stream.write(' ')
    with pytest.raises(ValueError,match='identity'):
        prepare(source,tmp_path/'out')
    assert not (tmp_path/'out').exists()


def test_public_native_fast_and_slow_controls(tmp_path):
    dsh=os.environ.get('DUO_DSH_PACKAGE')
    if not dsh:
        pytest.skip('Set DUO_DSH_PACKAGE to existing cached DSH; no install')
    pack=tmp_path/'properties';prepare(SOURCE,pack)
    output=tmp_path/'host'
    result=subprocess.run([sys.executable,str(ROOT/'scripts/research/verify_code_benchmark.py'),
        '--calibration-pack',str(pack),'--dsh-package',dsh,'--output',str(output)],
        text=True,capture_output=True,timeout=90)
    assert result.returncode==0, result.stdout+result.stderr
    receipt=json.loads((output/'receipt.json').read_text())
    assert receipt['status']=='PASS'
    assert receipt['verifiedTiers']==['fast','slow']
    assert receipt['modelRequests']==0 and receipt['costCny']==0
    assert receipt['optimizationBenefit']=='NOT_RUN'
    native=json.loads((output/'result.json').read_text())
    assert len(native['evaluations'])==2
    assert all(e['metrics']['control_match_rate']==1 for e in native['evaluations'])


def test_refuses_changed_frozen_control_before_execution(tmp_path):
    pack=tmp_path/'properties';prepare(SOURCE,pack)
    p=pack/'calibration-pack/controls.json'
    with p.open('a') as stream:stream.write(' ')
    with pytest.raises(ValueError,match='identity'):
        qualify(pack,tmp_path/'out')
    assert not (tmp_path/'out').exists()
