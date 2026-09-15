"""Code comparison uses real native/Python execution and labeled fixture input."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/research'))
from run_fact_comparison import inspect


def test_shared_inspection_uses_declared_code_metric_and_repeat_count(tmp_path):
    arm = tmp_path / 'arm'
    arm.mkdir()
    (arm / 'result.json').write_text(json.dumps({'status': 'completed', 'final': [
        {'candidateId': 'baseline', 'ok': True, 'metrics': {'task_pass_rate': .75}}]}))
    (arm / 'run-receipt.json').write_text(json.dumps({'status': 'PASS'}))
    protocol = {'live': False, 'primaryMetric': 'task_pass_rate', 'independentSearchRepeatsPerMethod': 1,
                'arms': [{'id': 'set1-B0', 'method': 'B0', 'repeat': 1, 'directory': 'arm'}], 'limitations': []}
    result = inspect(tmp_path, protocol)
    assert result['arms'][0]['finalScore'] == .75
    assert result['plannedIndependentSearchRepeatsPerMethod'] == 1
    assert len(result['ablationControls']) == 1


def control_pack(path):
    """Separate engineering tasks, never the held-out benchmark final."""
    path.mkdir()
    data = {'version': 1, 'responseMode': 'python-code-v1', 'responseInstructions': 'Implement each Python function.'}
    rows = {}
    for tier, count, offset in [('fast', 6, 0), ('slow', 12, 100), ('final', 18, 200)]:
        tasks = []
        for n in range(count):
            task_id = f'engineering-{tier}-{n}'
            value = offset + n + 1
            source = f'def task_func():\n    return {value}\n'
            tasks.append({'id': task_id, 'input': f'Return the integer {value}. Required interface: def task_func()'})
            rows[task_id] = {'task_id': task_id, 'code_prompt': '', 'canonical_solution': source,
                'test': f'import unittest\nclass TestCases(unittest.TestCase):\n    def test_value(self): self.assertEqual(task_func(), {value})\n'}
        data[tier] = {'id': f'engineering-code-{tier}', 'tasks': tasks}
    (path / 'dataset.json').write_text(json.dumps(data, indent=2) + '\n')
    key = {'version': 'code-engineering-control-v1', 'evaluatorVersion': '3',
           'datasetSha256': hashlib.sha256((path / 'dataset.json').read_bytes()).hexdigest(), 'tasks': rows}
    (path / 'answer-key.json').write_text(json.dumps(key, indent=2) + '\n')
    (path / 'manifest.json').write_text(json.dumps({'benchmark': 'DUO independent engineering controls',
        'measurementQualification': 'ENGINEERING_CONTROL_ONLY',
        'files': {n: hashlib.sha256((path / n).read_bytes()).hexdigest() for n in ['dataset.json', 'answer-key.json']}}))


def test_four_code_methods_use_named_host_python_evaluation_and_bounded_final(tmp_path):
    dsh = os.environ.get('DUO_DSH_PACKAGE')
    if not dsh:
        pytest.skip('Use the existing cached DSH; never install')
    pack = tmp_path / 'pack'
    control_pack(pack)
    target = tmp_path / 'persona.txt'
    target.write_text('Implement the requested Python functions exactly.\n')
    out = tmp_path / 'comparison'
    result = subprocess.run([sys.executable, 'scripts/research/run_code_comparison.py', '--mode', 'offline',
        '--search-profile', 'legacy-v1', '--output', str(out), '--dsh-package', dsh, '--benchmark-pack', str(pack), '--target', str(target)],
        cwd=ROOT, capture_output=True, text=True, timeout=240)
    assert result.returncode == 0, result.stdout + result.stderr
    report = json.loads((out / 'comparison-result.json').read_text())
    assert report['status'] == 'FUNCTIONAL_CONTROL_COMPLETE'
    assert report['paidCalls'] == report['totalCostCny'] == 0
    assert not report['realMethodComparisonVerified'] and not report['realAblationActivated']
    assert len(report['arms']) == 4 and report['plannedIndependentSearchRepeatsPerMethod'] == 1
    for arm in report['arms']:
        assert arm['generationsRun'] == (0 if arm['method'] == 'B0' else 2)
        assert arm['overlayExecutionVerified'] and arm['status'] == 'completed'
        assert arm['finalScore'] == (17 / 18 if arm['method'] == 'B0' else 1)
        assert arm['syntheticRequests'] <= arm['maxModelRequests']
        run = out / arm['directory']
        receipt = json.loads((run / 'run-receipt.json').read_text())
        assert receipt['childProcessAttempts'] == 0
        assert receipt['evaluatorProcessCalls'] <= arm['maxEvaluatorCalls']
        assert (run / 'product-report.json').exists() and (run / 'journal.json').exists()
        if arm['method'] == 'B1':
            assert arm['developmentSampleSizes'] == [18]
            assert arm['candidateSlowStates'] == ['NOT_CONFIGURED', 'NOT_CONFIGURED']
            bodies = []
            for path in run.glob('model-request-*-input.json'):
                request = json.loads(path.read_text())
                for m in request['messages']:
                    for block in m['content']:
                        try:
                            body = json.loads(block.get('text', ''))
                        except ValueError:
                            continue
                        if 'feedback' in body:
                            bodies.append(body)
            assert len(bodies) == 2
            assert all('Python' in b['instruction'] and 'grounded document answers' not in b['instruction'] for b in bodies)
            assert all(len(b['feedback']['developmentTasks']) == 18 for b in bodies)
            assert all(len(b['feedback']['developmentMeasurements'][0]['rows']) == 18 for b in bodies)
            assert any(not r['taskPassed'] for r in bodies[0]['feedback']['developmentMeasurements'][0]['rows'])
            assert 'canonical_solution' not in json.dumps(bodies) and 'engineering-final-' not in json.dumps(bodies)
    ablation = report['ablationControls'][0]
    assert ablation['state'] == 'ACTIVATED'
    assert ablation['b2CandidateSlowConsumed'] and ablation['b3ExplicitSlowRemoved'] and ablation['finalAbsent']
    assert target.read_text() == 'Implement the requested Python functions exactly.\n'


def test_code_entry_refuses_unallocated_execute(tmp_path):
    result = subprocess.run([sys.executable, 'scripts/research/run_code_comparison.py', '--mode', 'execute', '--output', str(tmp_path)],
                            cwd=ROOT, capture_output=True, text=True, env={'PATH': os.environ['PATH']})
    assert result.returncode == 2 and 'Frozen comparison and explicit current allocation required' in result.stderr
    assert not (tmp_path / 'execution-claim.json').exists()


@pytest.mark.parametrize('fault,expected', [
    ('duplicate-input', 'Task ids and task inputs must be unique'),
    ('unqualified-live', 'completed G0 measurement qualification'),
])
def test_code_preparation_refuses_unready_data_before_output(tmp_path, fault, expected):
    dsh = os.environ.get('DUO_DSH_PACKAGE')
    if not dsh:
        pytest.skip('Use the existing cached DSH')
    pack = tmp_path / 'pack'
    control_pack(pack)
    if fault == 'duplicate-input':
        data = json.loads((pack / 'dataset.json').read_text())
        data['final']['tasks'][0]['input'] = data['fast']['tasks'][0]['input']
        (pack / 'dataset.json').write_text(json.dumps(data))
        key = json.loads((pack / 'answer-key.json').read_text())
        key['datasetSha256'] = hashlib.sha256((pack / 'dataset.json').read_bytes()).hexdigest()
        (pack / 'answer-key.json').write_text(json.dumps(key))
        manifest = json.loads((pack / 'manifest.json').read_text())
        manifest['files'] = {n: hashlib.sha256((pack / n).read_bytes()).hexdigest() for n in manifest['files']}
        (pack / 'manifest.json').write_text(json.dumps(manifest))
    target = tmp_path / 'persona.txt'
    target.write_text('Existing control Target')
    out = tmp_path / 'prepared'
    result = subprocess.run(['node', '--loader', './scripts/product/dsh_native_loader.mjs', 'scripts/research/prepare_code_comparison.mjs',
        str(out), str(pack / 'dataset.json'), str(pack / 'answer-key.json'), str(target), str(fault == 'unqualified-live').lower()],
        cwd=ROOT, capture_output=True, text=True)
    assert result.returncode != 0 and expected in result.stderr
    assert not out.exists()


@pytest.mark.parametrize('tamper', ['missing-method', 'fixture-as-live'])
def test_inspection_cannot_upgrade_partial_or_fixture_evidence(tmp_path, tamper):
    # Immutable earlier host receipts; new report written only into this view.
    original = ROOT / 'runs/code-method-goal-20260912/checkpoint3-code-second-controls/test_four_code_methods_use_nam0/comparison'
    protocol = json.loads((original / 'comparison-protocol.json').read_text())
    for arm in protocol['arms']:
        (tmp_path / arm['directory']).symlink_to(original / arm['directory'], target_is_directory=True)
    if tamper == 'missing-method':
        protocol['arms'] = [a for a in protocol['arms'] if a['method'] != 'B3']
    else:
        protocol['live'] = True
    result = inspect(tmp_path, protocol)
    assert result['status'] == 'INCOMPLETE'
    assert result['realMethodComparisonVerified'] is False
    assert result['realAblationActivated'] is False
    if tamper == 'fixture-as-live':
        assert result['paidCalls'] == result['totalCostCny'] == 0
        assert result['syntheticRequests'] == 28


def test_history_profile_prepares_native_operators_and_stable_warm_target(tmp_path):
    if not os.environ.get('DUO_DSH_PACKAGE'):
        pytest.skip('Use the existing cached DSH')
    pack = tmp_path / 'pack'
    control_pack(pack)
    target = tmp_path / 'persona.txt'
    target.write_text('Original stable persona {{model}}.')
    journal = tmp_path / 'journal'
    journal.mkdir()
    warm = tmp_path / 'warm.json'
    warm.write_text(json.dumps({'runIds': ['prior-run'], 'maxRecords': 4, 'fixturePolicy': 'ideas_only'}))
    out = tmp_path / 'prepared'
    result = subprocess.run(['node', '--loader', './scripts/product/dsh_native_loader.mjs', 'scripts/research/prepare_code_comparison.mjs',
        str(out), str(pack / 'dataset.json'), str(pack / 'answer-key.json'), str(target), 'false',
        'history-structured-v2', str(warm), str(journal)], cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    protocol = json.loads((out / 'comparison-protocol.json').read_text())
    assert protocol['version'] == 2 and protocol['scope'] == 'native-code-method-comparison-v2'
    assert protocol['maxModelRequests'] == 40
    assert protocol['measurementReadiness']['slowHigherFidelity'] == 'NOT_ESTABLISHED'
    assert protocol['shared']['quota'] == {'exploit': 1, 'explore': 1, 'innovate': 1}
    assert protocol['shared']['warmStart'] is True
    for arm in protocol['arms']:
        inputs = out / arm['inputs']
        spec = json.loads((inputs / 'experiment.json').read_text())
        patch = json.loads((inputs / 'providers.patch.yml').read_text())
        assert spec['target']['path'] == str(target)
        if arm['method'] == 'B0':
            assert 'warmStart' not in spec
            continue
        assert spec['warmStart']['runIds'] == ['prior-run']
        from run_fact_comparison import child_command
        command = child_command(out, arm, 'offline', dsh=os.environ['DUO_DSH_PACKAGE'])
        assert command[command.index('--generator')+1] == 'structured-generator'
        feedback = next(row for chunk in patch for row in chunk.get('insert', []) if row.get('id') == 'method-feedback')
        assert feedback['config']['contextMode'] == 'history'
        assert arm['maxModelRequests'] == (11 if arm['method'] == 'B1' else 14)
    assert target.read_text() == 'Original stable persona {{model}}.'


def test_history_profile_rejects_invalid_warm_configuration_before_output(tmp_path):
    if not os.environ.get('DUO_DSH_PACKAGE'):
        pytest.skip('Use existing DSH')
    pack = tmp_path / 'pack'
    control_pack(pack)
    target = tmp_path / 'persona.txt'
    target.write_text('Original persona')
    warm = tmp_path / 'warm.json'
    warm.write_text(json.dumps({'runIds': ['../unsafe']}))
    out = tmp_path / 'bad'
    result = subprocess.run(['node', '--loader', './scripts/product/dsh_native_loader.mjs', 'scripts/research/prepare_code_comparison.mjs',
        str(out), str(pack / 'dataset.json'), str(pack / 'answer-key.json'), str(target), 'false',
        'history-structured-v2', str(warm), str(tmp_path)], cwd=ROOT, capture_output=True, text=True)
    assert result.returncode != 0
    assert not out.exists()


def generator_bodies(run):
    bodies=[]
    for file in run.glob('model-request-*-input.json'):
        request=json.loads(file.read_text())
        for message in request.get('messages',[]):
            for block in message.get('content',[]):
                try:body=json.loads(block.get('text',''))
                except ValueError:continue
                if isinstance(body,dict) and 'feedback' in body:bodies.append(body)
    return sorted(bodies,key=lambda b:b['generation'])


def test_structured_ablation_rejects_hidden_slow_and_incomplete_context():
    from copy import deepcopy
    from run_fact_comparison import structured_feedback_identity, explicit_slow_removed, native_digest
    history=[{'candidateId':'baseline','generation':0,'delta':None,'fast':{'tier':'fast'}}]
    feedback={'historyCompleteness':'all_latest_candidates','history':history,'families':{},
        'developmentTasks':[],'developmentMeasurements':[]}
    body={'slots':[{'slot':'exploit-1','mode':'exploit','operatorId':'append-local-v1'}], 'feedback':feedback}
    raw={**feedback,'quotas':{'exploit':1,'explore':0,'innovate':0}}
    event={'feedback':raw,'feedbackDigest':native_digest(raw)}
    receipt={'feedbackDigest':event['feedbackDigest'],'searchInputDigest':native_digest(feedback),
        'historyDigest':native_digest(history),'operatorSlots':[{'slot':'exploit-1','operatorId':'append-local-v1'}]}
    assert structured_feedback_identity(body,receipt,event,{'baseline'})
    assert explicit_slow_removed(feedback,structured=True)
    bad=deepcopy(receipt);bad['searchInputDigest']='wrong'
    assert not structured_feedback_identity(body,bad,event,{'baseline'})
    assert not structured_feedback_identity(body,receipt,event,{'baseline','missing-rejected-delta'})
    for field in ['slow','slowDecision','slowVerdict','status']:
        bad=deepcopy(feedback);bad['history'][0][field]=None
        assert not explicit_slow_removed(bad,structured=True)
    warm={'source':{'evaluators':[{'tier':'fast'}]},'role':'direction'}
    feedback['warmStart']={'records':[warm]}
    assert explicit_slow_removed(feedback,structured=True)
    for field,value in [('observations',{'slow':None}),('verdicts',{'slowDecision':'promoted'}),('role','good')]:
        bad=deepcopy(feedback);bad['warmStart']['records'][0][field]=value
        assert not explicit_slow_removed(bad,structured=True)
    bad=deepcopy(feedback);bad['warmStart']['records'][0]['source']['evaluators'].append({'tier':'slow'})
    assert not explicit_slow_removed(bad,structured=True)


def test_history_profile_public_host_consumes_deltas_and_real_control_slow(tmp_path):
    dsh=os.environ.get('DUO_DSH_PACKAGE')
    if not dsh:pytest.skip('Use existing cached DSH')
    pack=tmp_path/'pack';control_pack(pack)
    target=tmp_path/'persona.txt';target.write_text('Implement the requested Python functions exactly.\n')
    out=tmp_path/'comparison'
    run=subprocess.run([sys.executable,'scripts/research/run_code_comparison.py','--mode','offline','--output',str(out),
        '--dsh-package',dsh,'--benchmark-pack',str(pack),'--target',str(target)],cwd=ROOT,capture_output=True,text=True,timeout=360)
    assert run.returncode==0,run.stdout+run.stderr
    protocol=json.loads((out/'comparison-protocol.json').read_text())
    report=json.loads((out/'comparison-result.json').read_text())
    assert protocol['version']==2 and protocol['maxModelRequests']==40
    assert report['paidCalls']==report['totalCostCny']==0 and report['syntheticRequests']==40
    assert report['realMethodComparisonVerified'] is False and report['realAblationActivated'] is False
    for arm in report['arms']:
        assert arm['overlayExecutionVerified'] and arm['receiptStatus']=='PASS'
        if arm['method']=='B0':continue
        assert arm['candidateCount']==6 and arm['generationsRun']==2
        bodies=generator_bodies(out/arm['directory'])
        assert [len(b['feedback']['history']) for b in bodies]==[1,4]
        assert all({s['mode'] for s in b['slots']}=={'exploit','explore','innovate'} for b in bodies)
        assert all(h['delta'] is not None for h in bodies[1]['feedback']['history'] if h['candidateId']!='baseline')
        assert all(len(b['feedback']['developmentTasks'])==18 for b in bodies)
        assert all(b['feedback']['developmentMeasurements'][0]['rows'] for b in bodies)
        assert 'engineering-final-' not in json.dumps(bodies)
        assert 'canonical_solution' not in json.dumps(bodies)
    assert report['ablationControls'][0]['state']=='ACTIVATED'
    assert report['ablationControls'][0]['b2CandidateSlowConsumed']
    assert report['ablationControls'][0]['b3ExplicitSlowRemoved']
    assert target.read_text()=='Implement the requested Python functions exactly.\n'
    # A subsequent invocation uses only public history options and the same
    # original Target. Fixture history is ideas only, never inherited scores.
    source_id=json.loads((out/'set1-B2/result.json').read_text())['runId']
    warm_config=tmp_path/'warm.json'
    warm_config.write_text(json.dumps({'runIds':[source_id],'fixturePolicy':'ideas_only','maxRecords':6,'maxContextBytes':8192}))
    warm_out=tmp_path/'warm-comparison'
    warm_run=subprocess.run([sys.executable,'scripts/research/run_code_comparison.py','--mode','offline','--output',str(warm_out),
        '--dsh-package',dsh,'--benchmark-pack',str(pack),'--target',str(target),
        '--warm-start-config',str(warm_config),'--journal-root',str(out/'native-journal')],
        cwd=ROOT,capture_output=True,text=True,timeout=360)
    assert warm_run.returncode==0,warm_run.stdout+warm_run.stderr
    warm_report=json.loads((warm_out/'comparison-result.json').read_text())
    assert warm_report['status']=='FUNCTIONAL_CONTROL_COMPLETE' and warm_report['paidCalls']==0
    assert warm_report['ablationControls'][0]['state']=='ACTIVATED'
    for arm in warm_report['arms']:
        if arm['method']=='B0':continue
        run_dir=warm_out/arm['directory']
        plan=json.loads((run_dir/'run-plan.json').read_text())
        assert plan['warmStart']['mode']=='warm_start'
        assert plan['warmStart']['finalDataReview']['independence']=='NOT_ESTABLISHED'
        for body in generator_bodies(run_dir):
            records=body['feedback']['warmStart']['records']
            assert records and all(r['source']['runId']==source_id and r['use']=='ideas_only' for r in records)
            assert all('observations' not in r and 'verdicts' not in r for r in records)
            assert any(r['delta'] for r in records)
            assert 'engineering-final-' not in json.dumps(body)
        journal=json.loads((run_dir/'journal.json').read_text())
        assert any(e.get('candidateId')=='baseline' and e.get('fast',{}).get('ok') for e in journal['events'])
    assert target.read_text()=='Implement the requested Python functions exactly.\n'
