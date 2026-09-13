"""A copy that only creates filenames must not pass the public copy contract."""
import hashlib, json, sys
from pathlib import Path
import pytest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from prepare_code_benchmark import prepare
from code_evaluation import evaluate_batch, run_case
GOAL=ROOT/'runs/code-method-goal-20260912'
SOURCE=ROOT/'runs/code-benchmark-readiness-20260911/upstream/BigCodeBench-v0.1.4.jsonl'
TASK='BigCodeBench/665'
@pytest.fixture(scope='module')
def pack(tmp_path_factory):
    p=tmp_path_factory.mktemp('copy-contract')/'pack'
    prepare(SOURCE,p,prompt_format='complete',test_suite='dev-contract-v5')
    return p

def test_copy_checks_are_additive_versioned_and_leave_other_tasks_and_final_unchanged(pack):
    old=json.loads((GOAL/'benchmark-v7-dev-contract4/answer-key.json').read_text())
    key=json.loads((pack/'answer-key.json').read_text())
    manifest=json.loads((pack/'manifest.json').read_text())
    assert key['evaluatorVersion']==manifest['evaluatorVersion']=='8'
    assert key['version']==manifest['testSuiteVersion']=='bigcodebench-unittest-dev-contract-v5'
    assert key['tasks'][TASK]['test'].startswith(old['tasks'][TASK]['test']+'\n')
    for i,row in old['tasks'].items():
        if i != TASK: assert key['tasks'][i]==row
        else: assert all(v==key['tasks'][i][k] for k,v in row.items() if k!='test')
    data=json.loads((pack/'dataset.json').read_text()); prev=json.loads((GOAL/'benchmark-v7-dev-contract4/dataset.json').read_text())
    assert all(data[t]['tasks']==prev[t]['tasks'] and data[t]['id']=='bigcodebench-stdlib-v8-dev-contract5-'+t for t in ['fast','slow','final'])
    assert 'registered tests' in manifest['primaryMetric']
    assert manifest['testAdditions'][TASK]['originalTestSha256']==hashlib.sha256(old['tasks'][TASK]['test'].encode()).hexdigest()
    assert manifest['testReplacements']['BigCodeBench/565']['replacementTestSha256']==hashlib.sha256(key['tasks']['BigCodeBench/565']['test'].encode()).hexdigest()

def test_production_accepts_legal_copy_and_rejects_content_return_and_mutation_errors(pack,tmp_path):
    key=json.loads((pack/'answer-key.json').read_text()); data=json.loads((pack/'dataset.json').read_text())
    answers={t['id']:key['tasks'][t['id']]['code_prompt']+key['tasks'][t['id']]['canonical_solution'] for t in data['slow']['tasks']}
    result=evaluate_batch(pack,'slow',{'text':json.dumps(answers)},tmp_path/'reference-batch')
    assert result['ok'] and result['metrics']['task_pass_rate']==1 and result['evidence'][0]['version']=='8'
    for name in ['alternative-copyfile','wrong-empty-copies','wrong-return-none','wrong-mutates-source']:
        code=json.loads((GOAL/'665-controls'/(name+'-behavior')/'input.json').read_text())['code']
        row=run_case(code,key['tasks'][TASK]['test'],tmp_path/name)
        assert row['status']=='completed' and row['planned']==7
        assert row['taskPassed']==name.startswith('alternative')
        assert row['passed']==(7 if name.startswith('alternative') else 6)
    answers[TASK]=code
    wrong=evaluate_batch(pack,'slow',{'text':json.dumps(answers)},tmp_path/'wrong-batch')
    assert wrong['ok'] and wrong['metrics']['task_pass_rate']==11/12

def test_v7_bytes_unchanged_and_unreviewed_test_changes_refused(tmp_path):
    output=tmp_path/'v7'; prepare(SOURCE,output,prompt_format='complete',test_suite='dev-contract-v4')
    for name in ['dataset.json','answer-key.json','control-task.json','manifest.json']:
        assert (output/name).read_bytes()==(GOAL/'benchmark-v7-dev-contract4'/name).read_bytes()
    rows=list(map(json.loads,SOURCE.read_text().splitlines()))
    next(r for r in rows if r['task_id']==TASK)['test']+='\n# upstream changed\n'
    source=tmp_path/'changed.jsonl';source.write_text(''.join(json.dumps(r)+'\n' for r in rows))
    with pytest.raises(ValueError,match='Reviewed original test identity mismatch'):
        prepare(source,tmp_path/'bad',prompt_format='complete',test_suite='dev-contract-v5')
    assert not (tmp_path/'bad').exists()
