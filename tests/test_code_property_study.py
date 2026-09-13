"""Public, receipt-bound composition; no new final selection or model calls."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import pytest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from prepare_code_property_study import prepare
P=ROOT/'runs/c1-deterministic-slow-20260913/pack'
C1=ROOT/'runs/c1-deterministic-slow-20260913/acceptance.json'
F=ROOT/'runs/code-measurement-readiness-20260912/new-final-pack'
C2=ROOT/'runs/code-measurement-readiness-20260912/final-readiness.json'
read=lambda p:json.loads(p.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()


def test_public_composition_binds_qualified_development_and_exact_selected_final(tmp_path):
    output=tmp_path/'study';result=prepare(P,C1,F,C2,output)
    assert result['status']=='QUALIFIED_STUDY_INPUTS_PREPARED'
    data=read(output/'dataset.json');key=read(output/'answer-key.json')
    assert {t:len(data[t]['tasks']) for t in ['fast','slow','final']}=={'fast':6,'slow':2,'final':18}
    assert all(data[t]==read(P/'dataset.json')[t] for t in ['fast','slow'])
    assert data['final']==read(F/'dataset.json')['final']
    for tier in ['fast','slow','final']:
        source=read((F if tier=='final' else P)/'answer-key.json')
        assert all(key['tasks'][t['id']]==source['tasks'][t['id']] for t in data[tier]['tasks'])
    assert len(key['tasks'])==26
    manifest=read(output/'manifest.json')
    assert manifest['comparisonProfile']=='properties-structured-v3'
    assert manifest['measurementQualification']=='DEVELOPMENT_CONTRACT_QUALIFIED'
    assert manifest['slowHigherFidelity']=='BOUNDED_INCREMENTAL_TWO_TASKS'
    assert manifest['sourceBindings'][str(C1)]==sha(C1)
    assert manifest['sourceBindings'][str(C2)]==sha(C2)
    assert result['modelRequests']==0


@pytest.mark.parametrize('fault',['rejected-c1','changed-final','changed-program-tests'])
def test_refuses_drift_and_unqualified_receipts_before_output(tmp_path,fault):
    p,c1,f=P,C1,F
    if fault=='rejected-c1':
        c1=tmp_path/'rejected.json';v=read(C1);v['status']='NOT_QUALIFIED';c1.write_text(json.dumps(v))
    elif fault=='changed-final':
        f=tmp_path/'changed';shutil.copytree(F,f)
        with (f/'dataset.json').open('a') as stream:stream.write(' ')
    else:
        p=tmp_path/'changed';shutil.copytree(P,p)
        with (p/'answer-key.json').open('a') as stream:stream.write(' ')
    with pytest.raises(ValueError,match='qualification|identity'):
        prepare(p,c1,f,C2,tmp_path/'out')
    assert not (tmp_path/'out').exists()


def native_prepare(pack,output,target,live='true'):
    return subprocess.run(['node','--loader','./scripts/dsh_native_loader.mjs','scripts/prepare_code_comparison.mjs',
        str(output),str(pack/'dataset.json'),str(pack/'answer-key.json'),str(target),live,'properties-structured-v3'],
        cwd=ROOT,text=True,capture_output=True,timeout=30)


def test_property_profile_prepares_three_generations_and_fair_b1_without_calls(tmp_path):
    if not os.environ.get('DUO_DSH_PACKAGE'):pytest.skip('Use existing cached DSH')
    pack=tmp_path/'study';prepare(P,C1,F,C2,pack)
    target=tmp_path/'persona.txt';target.write_text('Existing original persona.')
    output=tmp_path/'methods';result=native_prepare(pack,output,target)
    assert result.returncode==0,result.stderr
    protocol=read(output/'comparison-protocol.json')
    assert protocol['version']==3 and protocol['shared']['generations']==3
    assert protocol['maxModelRequests']==54
    assert protocol['measurementReadiness']['slowHigherFidelity']=='BOUNDED_INCREMENTAL_TWO_TASKS'
    assert protocol['budgetProof']['maxRequests']=={'B0':1,'B1':15,'B2':19,'B3':19}
    for arm in protocol['arms']:
        inputs=output/arm['inputs'];spec=read(inputs/'experiment.json');data=read(inputs/'pack/dataset.json');key=read(inputs/'pack/answer-key.json')
        assert data['final']==read(F/'dataset.json')['final']
        assert spec['generations']==(0 if arm['method']=='B0' else 3)
        assert spec['minSamples']==2
        assert spec['budget']['maxSessions']>=arm['maxEvaluatorCalls']*2+spec['generations']
        if arm['method']=='B1':
            assert len(data['fast']['tasks'])==8 and 'slow' not in data
            assert key['propertyTiers']==['fast']
            original=read(P/'answer-key.json')
            assert all(key['tasks'][t['id']]==original['tasks'][t['id']] for t in data['fast']['tasks'])
        patch=read(inputs/'providers.patch.yml');host=next(p['config'] for p in patch if p.get('id')=='model-entry')
        assert host['requiredGenerations']==spec['generations']
    assert target.read_text()=='Existing original persona.'
    assert not list(output.glob('*/sessions/*.json'))


def test_property_profile_rechecks_receipts_before_creating_methods(tmp_path):
    if not os.environ.get('DUO_DSH_PACKAGE'):pytest.skip('Use existing cached DSH')
    pack=tmp_path/'study';prepare(P,C1,F,C2,pack)
    target=tmp_path/'persona.txt';target.write_text('Original persona')
    manifest=read(pack/'manifest.json');manifest['sourceBindings'][str(C1)]='0'*64
    (pack/'manifest.json').write_text(json.dumps(manifest))
    result=native_prepare(pack,tmp_path/'out',target)
    assert result.returncode!=0 and 'identity' in result.stderr
    assert not (tmp_path/'out').exists()


def engineering_property_pack(pack):
    from test_code_comparison import control_pack
    control_pack(pack)
    data=read(pack/'dataset.json');key=read(pack/'answer-key.json')
    data['slow']['tasks']=data['slow']['tasks'][:2]
    ids={t['id'] for tier in ['fast','slow','final'] for t in data[tier]['tasks']}
    key['tasks']={i:row for i,row in key['tasks'].items() if i in ids}
    key['propertyTiers']=['slow']
    (pack/'dataset.json').write_text(json.dumps(data,indent=2)+'\n');key['datasetSha256']=sha(pack/'dataset.json')
    (pack/'answer-key.json').write_text(json.dumps(key,indent=2)+'\n')
    manifest=read(pack/'manifest.json');manifest['files']={n:sha(pack/n) for n in ['dataset.json','answer-key.json']}
    (pack/'manifest.json').write_text(json.dumps(manifest))


def test_three_generation_public_host_preserves_real_input_identity_and_ablation(tmp_path):
    dsh=os.environ.get('DUO_DSH_PACKAGE')
    if not dsh:pytest.skip('Use existing cached DSH')
    pack=tmp_path/'pack';engineering_property_pack(pack)
    target=tmp_path/'persona.txt';target.write_text('Existing engineering persona. Implement requested functions.')
    output=tmp_path/'comparison'
    command=[sys.executable,'scripts/run_code_comparison.py','--mode','offline','--benchmark-pack',str(pack),
        '--target',str(target),'--dsh-package',dsh,'--search-profile','properties-structured-v3','--output',str(output)]
    result=subprocess.run(command,cwd=ROOT,text=True,capture_output=True,timeout=300)
    assert result.returncode==0,result.stdout+result.stderr
    report=read(output/'comparison-result.json')
    assert report['status']=='FUNCTIONAL_CONTROL_COMPLETE'
    assert report['paidCalls']==0 and report['totalCostCny']==0
    assert not report['realMethodComparisonVerified']
    for arm in report['arms']:
        assert arm['generationsRun']==(0 if arm['method']=='B0' else 3)
        assert arm['overlayExecutionVerified'] and arm['searchContextVerified']
        if arm['method']!='B0':
            assert arm['candidateCount']==9
    audit=report['ablationControls'][0]
    assert audit['state']=='ACTIVATED'
    assert audit['b2CandidateSlowConsumed'] and audit['b3ExplicitSlowRemoved']
    assert len(audit['inputs'])==6
    assert {x['generation'] for x in audit['inputs']}=={1,2,3}


RECORDED_HOST=ROOT/'runs/code-method-goal-20260912/c3-integration-20260913/host-green1-work/test_three_generation_public_h0/comparison'


def replay_view(output,omit_third=False):
    output.mkdir()
    for arm in ['B0','B1','B2','B3']:
        source=RECORDED_HOST/('set1-'+arm);dest=output/source.name;dest.mkdir()
        for p in source.iterdir():
            if omit_third and arm=='B3' and p.name.startswith('model-request-') and p.name.endswith('-input.json'):
                request=read(p)
                bodies=[json.loads(b['text']) for m in request.get('messages',[]) if m.get('role')=='user' for b in m.get('content',[]) if b.get('type')=='text']
                if any(b.get('generation')==3 and 'feedback' in b for b in bodies):continue
            (dest/p.name).symlink_to(p,target_is_directory=p.is_dir())
    return read(RECORDED_HOST/'comparison-protocol.json')


def test_recorded_three_generations_prove_consumption_and_full_metrics(tmp_path):
    from run_fact_comparison import inspect
    output=tmp_path/'replay';protocol=replay_view(output)
    result=inspect(output,protocol)
    assert result['status']=='FUNCTIONAL_CONTROL_COMPLETE'
    assert result['ablationControls'][0]['consumingGenerations']==[2,3]
    assert result['ablationControls'][0]['state']=='ACTIVATED'
    for arm in result['arms']:
        metrics=arm['experimentMetrics']
        assert metrics['totalEvaluationWork']['completedBatchReceipts']==arm['maxEvaluatorCalls']
        assert metrics['totalEvaluationWork']['programExecutions']>0
        if arm['method']!='B0':
            assert len(metrics['candidateScoreDistribution']['fast'])==9
            assert metrics['bestCandidateScore']['fast']==1
        if arm['method'] in ['B2','B3']:
            assert metrics['promotionCount']==3
            assert metrics['promotionPrecision']['state']=='NOT_IDENTIFIABLE'
            assert metrics['promotionPrecision']['independentlyEvaluated']==1
            assert metrics['promotionPrecision']['value'] is None
            assert metrics['rejectedCandidates']
    assert result['paidCalls']==result['totalCostCny']==0
    assert not result['realMethodComparisonVerified']


def test_missing_third_generation_is_not_complete_or_effective_ablation(tmp_path):
    from run_fact_comparison import inspect
    output=tmp_path/'replay';protocol=replay_view(output,omit_third=True)
    result=inspect(output,protocol)
    assert result['status']=='INCOMPLETE'
    assert result['ablationControls'][0]['state']=='INACTIVE_OR_UNVERIFIED'
    assert not result['ablationControls'][0]['b3ExplicitSlowRemoved']


@pytest.mark.parametrize('cap',['2.75','NaN','-1','2.81'])
def test_property_budget_reduction_reaches_all_native_inputs_before_freeze(tmp_path,cap):
    if not os.environ.get('DUO_DSH_PACKAGE'):pytest.skip('Use existing cached DSH')
    pack=tmp_path/'study';prepare(P,C1,F,C2,pack)
    target=tmp_path/'persona.txt';target.write_text('Existing original target.')
    out=tmp_path/'comparison'
    r=subprocess.run(['node','--loader','./scripts/dsh_native_loader.mjs','scripts/prepare_code_comparison.mjs',
        str(out),str(pack/'dataset.json'),str(pack/'answer-key.json'),str(target),'true','properties-structured-v3','','',cap],
        cwd=ROOT,capture_output=True,text=True,timeout=30)
    if cap!='2.75':
        assert r.returncode!=0 and not out.exists()
        return
    assert r.returncode==0,r.stderr
    protocol=read(out/'comparison-protocol.json')
    assert protocol['maxCostCny']==8.65 and protocol['maxModelRequests']==54
    for arm in protocol['arms']:
        expected=.4 if arm['method']=='B0' else 2.75
        assert arm['maxCostCny']==expected
        inp=out/arm['inputs'];spec=read(inp/'experiment.json');patch=read(inp/'providers.patch.yml')
        assert spec['budget']['maxCostCny']==expected
        host=next(row['config'] for row in patch if row.get('id')=='model-entry')
        assert host['budgetGroups'][0]['limits']['maxCostCny']==8.65
