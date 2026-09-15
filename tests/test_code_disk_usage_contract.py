"""Real public relative paths must work independently of a mocked disk API."""
import hashlib,json,sys
from pathlib import Path
import pytest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts/research'))
from prepare_code_benchmark import prepare
from code_evaluation import evaluate_batch,run_case
GOAL=ROOT/'runs/code-method-goal-20260912'
SOURCE=ROOT/'runs/code-benchmark-readiness-20260911/upstream/BigCodeBench-v0.1.4.jsonl'
TASK='BigCodeBench/973'
@pytest.fixture(scope='module')
def pack(tmp_path_factory):
    p=tmp_path_factory.mktemp('disk-contract')/'pack';prepare(SOURCE,p,prompt_format='complete',test_suite='dev-contract-v6');return p

def test_public_relative_contract_repair_is_versioned_and_archives_prior_tests_and_reference(pack):
    key=json.loads((pack/'answer-key.json').read_text());old=json.loads((GOAL/'benchmark-v8-dev-contract5/answer-key.json').read_text());manifest=json.loads((pack/'manifest.json').read_text())
    assert key['evaluatorVersion']==manifest['evaluatorVersion']=='9'
    assert key['version']==manifest['testSuiteVersion']=='bigcodebench-unittest-dev-contract-v6'
    r=key['tasks'][TASK];prior=old['tasks'][TASK]
    assert r['original_test']==prior['test'] and r['original_canonical_solution']==prior['canonical_solution']
    assert r['canonical_solution']==prior['canonical_solution'].replace('if not sub_path.startswith(delimiter):','if path.startswith(delimiter) and not sub_path.startswith(delimiter):')
    assert all(key['tasks'][i]==v for i,v in old['tasks'].items() if i!=TASK)
    assert all(v==r[k] for k,v in prior.items() if k not in ['test','canonical_solution'])
    data=json.loads((pack/'dataset.json').read_text());olddata=json.loads((GOAL/'benchmark-v8-dev-contract5/dataset.json').read_text())
    assert all(data[t]['tasks']==olddata[t]['tasks'] and data[t]['id']=='bigcodebench-stdlib-v9-dev-contract6-'+t for t in ['fast','slow','final'])
    assert manifest['referenceCorrections'][TASK]['beforeSha256']==hashlib.sha256(prior['canonical_solution'].encode()).hexdigest()
    assert manifest['testReplacements'][TASK]['replacementTestSha256']==hashlib.sha256(r['test'].encode()).hexdigest()
    assert 'registered tests' in manifest['primaryMetric'] and manifest['measurementQualification']=='PARTIAL_DEVELOPMENT_CONTRACT_REPAIR_NOT_QUALIFIED'

def test_production_accepts_corrected_reference_and_alternative_but_identifies_old_relative_bug_and_wrong_outputs(pack,tmp_path):
    key=json.loads((pack/'answer-key.json').read_text());data=json.loads((pack/'dataset.json').read_text())
    answers={t['id']:key['tasks'][t['id']]['code_prompt']+key['tasks'][t['id']]['canonical_solution'] for t in data['fast']['tasks']}
    result=evaluate_batch(pack,'fast',{'text':json.dumps(answers)},tmp_path/'reference-batch')
    assert result['ok'] and result['metrics']['task_pass_rate']==1 and result['evidence'][0]['version']=='9'
    for name in ['reference','alternative-statvfs','wrong-zero-usage','wrong-only-last-component','wrong-filters-empty-component']:
        code=json.loads((GOAL/'973-controls'/(name+'-behavior')/'input.json').read_text())['code']
        row=run_case(code,key['tasks'][TASK]['test'],tmp_path/name)
        assert row['status']=='completed' and row['planned']==6
        assert row['taskPassed']==(name=='alternative-statvfs')
    answers[TASK]=json.loads((GOAL/'973-controls/reference-behavior/input.json').read_text())['code']
    wrong=evaluate_batch(pack,'fast',{'text':json.dumps(answers)},tmp_path/'old-reference-batch')
    assert wrong['ok'] and wrong['metrics']['task_pass_rate']==5/6

def test_prior_pack_unchanged_and_unreviewed_reference_drift_refused(tmp_path):
    p=tmp_path/'v8';prepare(SOURCE,p,prompt_format='complete',test_suite='dev-contract-v5')
    for n in ['dataset.json','answer-key.json','control-task.json','manifest.json']:
        assert (p/n).read_bytes()==(GOAL/'benchmark-v8-dev-contract5'/n).read_bytes()
    rows=list(map(json.loads,SOURCE.read_text().splitlines()));next(r for r in rows if r['task_id']==TASK)['canonical_solution']+='\n# new upstream version\n'
    source=tmp_path/'changed.jsonl';source.write_text(''.join(json.dumps(r)+'\n' for r in rows))
    with pytest.raises(ValueError,match='Reviewed reference identity mismatch'):
        prepare(source,tmp_path/'bad',prompt_format='complete',test_suite='dev-contract-v6')
    assert not (tmp_path/'bad').exists()
