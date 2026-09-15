"""Measure the public defaultdict behavior without fixing its factory API."""
import hashlib,json,sys
from pathlib import Path
import pytest
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts/research'))
from prepare_code_benchmark import prepare
from code_evaluation import evaluate_batch,run_case
GOAL=ROOT/'runs/code-method-goal-20260912';SOURCE=ROOT/'runs/code-benchmark-readiness-20260911/upstream/BigCodeBench-v0.1.4.jsonl';TASK='BigCodeBench/931'
@pytest.fixture(scope='module')
def pack(tmp_path_factory):
    p=tmp_path_factory.mktemp('defaultdict-contract')/'pack';prepare(SOURCE,p,prompt_format='complete',test_suite='dev-contract-v7');return p

def test_return_behavior_addition_is_versioned_and_preserves_public_inputs_other_tasks_and_final(pack):
    old=json.loads((GOAL/'benchmark-v9-dev-contract6/answer-key.json').read_text());key=json.loads((pack/'answer-key.json').read_text());manifest=json.loads((pack/'manifest.json').read_text())
    assert key['evaluatorVersion']==manifest['evaluatorVersion']=='10' and key['version']==manifest['testSuiteVersion']=='bigcodebench-unittest-dev-contract-v7'
    assert all(r==key['tasks'][i] for i,r in old['tasks'].items() if i!=TASK)
    assert all(v==key['tasks'][TASK][k] for k,v in old['tasks'][TASK].items() if k!='test')
    assert key['tasks'][TASK]['test'].startswith(old['tasks'][TASK]['test']+'\n')
    data=json.loads((pack/'dataset.json').read_text());prev=json.loads((GOAL/'benchmark-v9-dev-contract6/dataset.json').read_text())
    assert all(data[t]['tasks']==prev[t]['tasks'] and data[t]['id']=='bigcodebench-stdlib-v10-dev-contract7-'+t for t in ['fast','slow','final'])
    assert manifest['testAdditions'][TASK]['originalTestSha256']==hashlib.sha256(old['tasks'][TASK]['test'].encode()).hexdigest()
    assert 'registered tests' in manifest['primaryMetric']

def test_production_accepts_equivalent_factory_and_rejects_wrong_type_or_default(pack,tmp_path):
    key=json.loads((pack/'answer-key.json').read_text());data=json.loads((pack/'dataset.json').read_text());answers={t['id']:key['tasks'][t['id']]['code_prompt']+key['tasks'][t['id']]['canonical_solution'] for t in data['fast']['tasks']}
    result=evaluate_batch(pack,'fast',{'text':json.dumps(answers)},tmp_path/'reference-batch')
    assert result['ok'] and result['metrics']['task_pass_rate']==1 and result['evidence'][0]['version']=='10'
    for name,passed in [('alternative-default-factory',9),('wrong-plain-dict',7),('wrong-default-list',8)]:
        code=json.loads((GOAL/'931-controls'/(name+'-behavior')/'input.json').read_text())['code'];r=run_case(code,key['tasks'][TASK]['test'],tmp_path/name)
        assert r['status']=='completed' and r['planned']==9 and r['passed']==passed and r['taskPassed']==name.startswith('alternative')
    answers[TASK]=code;wrong=evaluate_batch(pack,'fast',{'text':json.dumps(answers)},tmp_path/'wrong-batch')
    assert wrong['ok'] and wrong['metrics']['task_pass_rate']==5/6

def test_v9_bytes_unchanged_and_unreviewed_public_prompt_refused(tmp_path):
    p=tmp_path/'v9';prepare(SOURCE,p,prompt_format='complete',test_suite='dev-contract-v6')
    for name in ['dataset.json','answer-key.json','control-task.json','manifest.json']:
        assert (p/name).read_bytes()==(GOAL/'benchmark-v9-dev-contract6'/name).read_bytes()
    rows=list(map(json.loads,SOURCE.read_text().splitlines()));next(r for r in rows if r['task_id']==TASK)['complete_prompt']+='\n# changed public requirement\n';source=tmp_path/'changed.jsonl';source.write_text(''.join(json.dumps(r)+'\n' for r in rows))
    with pytest.raises(ValueError,match='Reviewed public prompt identity mismatch'):
        prepare(source,tmp_path/'bad',prompt_format='complete',test_suite='dev-contract-v7')
    assert not (tmp_path/'bad').exists()
