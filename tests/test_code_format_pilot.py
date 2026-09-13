"""No-final format preparation and its actual named DSH host acceptance."""
import json
import os
from pathlib import Path
import subprocess
import sys
import pytest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from prepare_code_format_pilot import prepare
from test_code_property_study import engineering_property_pack
read=lambda p:json.loads(p.read_text())

def inputs(tmp_path):
    pack=tmp_path/'source';engineering_property_pack(pack)
    target=tmp_path/'persona.txt';target.write_text('Implement the requested Python function completely.')
    output=tmp_path/'pilot';protocol=prepare(pack,target,output,False)
    return pack,target,output,protocol

def test_pilot_has_exact_development_tests_and_no_final_or_extra_requests(tmp_path):
    source,target,out,protocol=inputs(tmp_path);original=read(source/'answer-key.json')
    assert protocol['maxModelRequests']==6 and len(protocol['arms'])==2
    for arm,n in zip(protocol['arms'],[8,6]):
        pack=Path(arm['inputs'])/'pack';data=read(pack/'dataset.json');key=read(pack/'answer-key.json')
        assert 'final' not in data and 'slow' not in data
        assert len(data['fast']['tasks'])==n and len(key['tasks'])==n
        assert all(row==original['tasks'][i] for i,row in key['tasks'].items())
        assert 'engineering-final' not in json.dumps(data)+json.dumps(key)
    assert read(Path(protocol['arms'][0]['inputs'])/'pack/answer-key.json')['propertyTiers']==['fast']

def test_pilot_refuses_changed_source_before_creating_output(tmp_path):
    source,target,out,protocol=inputs(tmp_path)
    with (source/'dataset.json').open('a') as f:f.write(' ')
    fresh=tmp_path/'rejected'
    with pytest.raises(ValueError,match='identity'):prepare(source,target,fresh,False)
    assert not fresh.exists()

def test_development_only_one_generation_completes_native_host_without_final(tmp_path):
    dsh=os.environ.get('DUO_DSH_PACKAGE')
    if not dsh:pytest.skip('Requires existing cached DSH')
    source,target,out,protocol=inputs(tmp_path);arm=protocol['arms'][0];inp=Path(arm['inputs']);run=Path(arm['directory'])
    command=[sys.executable,'scripts/run_dsh_model.py','--mode','offline','--dsh-package',dsh,'--output',str(run),
             '--contract',str(inp/'experiment.json'),'--dataset',str(inp/'pack/dataset.json'),'--profile-patch',str(inp/'providers.patch.yml'),
             '--model-config',str(inp/'model.json'),'--runtime-cwd',str(out/'execution-cwd'),'--max-cost-cny',str(arm['maxCostCny']),
             '--max-model-requests',str(arm['maxModelRequests']),'--generator','structured-generator']
    for f in ['scripts/dsh_code_evaluator.js','scripts/code_evaluation.py','scripts/code_worker.py','examples/native/method-feedback.js','examples/native/code-method-fixture.js']:
        command+=['--profile-file',str(ROOT/f)]
    completed=subprocess.run(command,cwd=ROOT,capture_output=True,text=True,timeout=120)
    (tmp_path/'host.stdout.txt').write_text(completed.stdout);(tmp_path/'host.stderr.txt').write_text(completed.stderr)
    result=read(run/'result.json');receipt=read(run/'run-receipt.json')
    assert result['status']=='completed' and result['generationsRun']==1
    assert result['final']==[] and result['independentFinal'] is None
    assert receipt['status']=='PASS',receipt
    assert completed.returncode==0,completed.stdout+completed.stderr
    assert receipt['measurementScope']=='declared_development_only'
    assert receipt['modelRequests']==5 and receipt['paidCalls']==0
    assert receipt['optimizationProven'] is False
