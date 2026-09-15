"""Current fact study uses public native entry; scripted controls are not efficacy."""
import json
import os
from pathlib import Path
import subprocess
import sys
import shutil

import pytest

ROOT=Path(__file__).resolve().parents[1]


def test_all_four_methods_run_native_with_full_single_loop_and_active_screened_feedback(tmp_path):
    dsh=os.environ.get('DUO_DSH_PACKAGE')
    if not dsh:pytest.skip('Select the existing cached DSH installation')
    facts=tmp_path/'facts'
    made=subprocess.run(['node','--loader','./scripts/product/dsh_native_loader.mjs','examples/native/fact-task.js','--output',str(facts)],cwd=ROOT,capture_output=True,text=True)
    assert made.returncode==0,made.stderr
    out=tmp_path/'comparison'
    result=subprocess.run([sys.executable,'scripts/research/run_fact_comparison.py','--mode','offline','--output',str(out),
        '--dsh-package',dsh,'--dataset',str(facts/'dataset.json'),'--answer-key',str(facts/'answerKey.json'),
        '--target',str(ROOT/'examples/native/persona.txt')],cwd=ROOT,capture_output=True,text=True,timeout=180)
    assert result.returncode==0,result.stdout+result.stderr
    report=json.loads((out/'comparison-result.json').read_text())
    assert report['status']=='FUNCTIONAL_CONTROL_COMPLETE'
    assert report['paidCalls']==report['totalCostCny']==0
    assert report['realMethodComparisonVerified'] is False
    assert len(report['arms'])==8
    for row in report['arms']:
        assert row['status']=='completed'
        assert row['finalScore']==1
        assert row['overlayExecutionVerified'] is True
        assert all('state' in c[tier] for c in row['candidates'] for tier in ['fast','slow','final'])
        assert row['generationsRun']==(0 if row['method']=='B0' else 2)
        if row['method']=='B1':
            assert row['developmentSampleSizes']==[15]
            assert row['candidateSlowStates']==['NOT_CONFIGURED','NOT_CONFIGURED']
    assert len(report['ablationControls'])==2
    assert all(x['b2CandidateSlowConsumed'] and x['b3ExplicitSlowRemoved'] and x['generatorToolsAbsent'] for x in report['ablationControls'])
    assert report['plannedIndependentSearchRepeatsPerMethod']==2
    assert report['completedIndependentSearchRepeats']=={'B1':2,'B2':2,'B3':2}
    runtime_directories={json.loads(p.read_text())['runtimeCwd'] for arm in report['arms']
        for p in (out/arm['directory']).glob('model-request-*-input.json')}
    assert runtime_directories=={str(out/'execution-cwd')}
    # A first-generation Journal tool would invalidate the ablation even if the
    # second generation itself has no tools. Keep the original control intact.
    tampered=tmp_path/'tampered-control';shutil.copytree(out,tampered,symlinks=True)
    changed=False
    for path in (tampered/'set1-B3').glob('model-request-*-input.json'):
        value=json.loads(path.read_text())
        for message in value.get('messages',[]):
            for block in message.get('content',[]):
                try:body=json.loads(block.get('text',''))
                except ValueError:continue
                if body.get('generation')==1 and 'feedback' in body:
                    value['tools']=[{'name':'read_journal'}];path.write_text(json.dumps(value));changed=True
    assert changed
    session_ids={json.loads(p.read_text()).get('sessionId') for p in (tampered/'set1-B3'/'sessions').glob('*.json')
        if json.loads(p.read_text()).get('candidateId')=='dl-0001'}
    for path in (tampered/'set1-B3').glob('model-request-*-input.json'):
        value=json.loads(path.read_text())
        if value.get('sessionId') in session_ids:
            value['system']='CONTROLLED WRONG PERSONA';path.write_text(json.dumps(value));break
    audit=subprocess.run([sys.executable,'scripts/research/run_fact_comparison.py','--mode','inspect','--output',str(tampered)],cwd=ROOT,capture_output=True,text=True)
    assert audit.returncode==0,audit.stderr
    changed_report=json.loads((tampered/'comparison-result.json').read_text())
    assert changed_report['ablationControls'][0]['state']=='INACTIVE_OR_UNVERIFIED'
    assert changed_report['ablationControls'][0]['generatorToolsAbsent'] is False
    assert next(x for x in changed_report['arms'] if x['id']=='set1-B3')['overlayExecutionVerified'] is False


def test_new_method_entry_refuses_unfrozen_or_unallocated_execution_before_credentials(tmp_path):
    run=subprocess.run([sys.executable,'scripts/research/run_fact_comparison.py','--mode','execute','--output',str(tmp_path)],
        cwd=ROOT,env={'PATH':os.environ['PATH']},capture_output=True,text=True)
    assert run.returncode==2
    assert 'Frozen comparison and explicit current allocation required' in run.stderr
    assert not (tmp_path/'execution-claim.json').exists()


def test_inspection_keeps_unknown_usage_and_unfinished_repeats_without_crashing(tmp_path):
    arm=tmp_path/'arm';(arm/'sessions').mkdir(parents=True)
    (arm/'sessions'/'unknown.json').write_text(json.dumps({'costCny':None,'costEvidence':{'attempts':1,'usage':None}}))
    (arm/'result.json').write_text(json.dumps({'status':'failed','budget':{'costCny':None}}))
    protocol={'live':True,'arms':[{'id':'set1-B1','method':'B1','repeat':1,'directory':'arm'}],'limitations':[]}
    (tmp_path/'comparison-protocol.json').write_text(json.dumps(protocol))
    run=subprocess.run([sys.executable,'scripts/research/run_fact_comparison.py','--mode','inspect','--output',str(tmp_path)],cwd=ROOT,capture_output=True,text=True)
    assert run.returncode==0,run.stderr
    report=json.loads((tmp_path/'comparison-result.json').read_text())
    assert report['status']=='INCOMPLETE' and report['totalCostCny'] is None
    assert report['paidCalls']==1 and report['knownCostCny']==0
    assert report['completedIndependentSearchRepeats']=={'B1':0,'B2':0,'B3':0}


def test_runtime_context_refuses_ambient_configuration_and_execute_override(tmp_path):
    runtime=tmp_path/'runtime';runtime.mkdir();(runtime/'.env').write_text('CONTROL_ONLY=1\n')
    output=tmp_path/'new-host'
    refused=subprocess.run([sys.executable,'scripts/research/run_dsh_model.py','--mode','offline','--output',str(output),
        '--dsh-package',str(tmp_path/'unused-dsh'),'--runtime-cwd',str(runtime)],cwd=ROOT,
        env={'PATH':os.environ['PATH']},capture_output=True,text=True)
    assert refused.returncode==2 and 'without ambient .env or Cordis configuration' in refused.stderr
    assert not output.exists()
    frozen=tmp_path/'frozen';frozen.mkdir();(frozen/'prepared.json').write_text(json.dumps({'runtimeCwd':str(runtime)}))
    refused=subprocess.run([sys.executable,'scripts/research/run_dsh_model.py','--mode','execute','--output',str(frozen),'--runtime-cwd',str(tmp_path)],
        cwd=ROOT,env={'PATH':os.environ['PATH']},capture_output=True,text=True)
    assert refused.returncode==2 and 'Frozen runtime working directory cannot be overridden' in refused.stderr
    assert not (frozen/'execution-claim.json').exists()
