"""The public move contract preserves bytes/unselected files and error type."""
import hashlib,json,sys
from pathlib import Path
import pytest
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from prepare_code_benchmark import prepare
from code_evaluation import evaluate_batch,run_case
GOAL=ROOT/'runs/code-method-goal-20260912';SOURCE=ROOT/'runs/code-benchmark-readiness-20260911/upstream/BigCodeBench-v0.1.4.jsonl';TASK='BigCodeBench/756'
@pytest.fixture(scope='module')
def pack(tmp_path_factory):
    p=tmp_path_factory.mktemp('move-contract')/'pack';prepare(SOURCE,p,prompt_format='complete',test_suite='dev-contract-v9');return p

def test_move_checks_are_versioned_and_preserve_prior_tests_public_inputs_and_final(pack):
    old=json.loads((GOAL/'benchmark-v11-dev-contract8/answer-key.json').read_text());key=json.loads((pack/'answer-key.json').read_text());manifest=json.loads((pack/'manifest.json').read_text())
    assert key['evaluatorVersion']==manifest['evaluatorVersion']=='12' and key['version']==manifest['testSuiteVersion']=='bigcodebench-unittest-dev-contract-v9'
    assert all(r==key['tasks'][i] for i,r in old['tasks'].items() if i!=TASK)
    assert all(v==key['tasks'][TASK][k] for k,v in old['tasks'][TASK].items() if k!='test')
    assert key['tasks'][TASK]['test'].startswith(old['tasks'][TASK]['test']+'\n')
    data=json.loads((pack/'dataset.json').read_text());prev=json.loads((GOAL/'benchmark-v11-dev-contract8/dataset.json').read_text())
    assert all(data[t]['tasks']==prev[t]['tasks'] and data[t]['id']=='bigcodebench-stdlib-v12-dev-contract9-'+t for t in ['fast','slow','final'])
    assert manifest['testAdditions'][TASK]['combinedTestSha256']==hashlib.sha256(key['tasks'][TASK]['test'].encode()).hexdigest()
    oldmanifest=json.loads((GOAL/'benchmark-v11-dev-contract8/manifest.json').read_text())
    assert manifest['supersededTestAdditions']==oldmanifest['supersededTestAdditions'] and manifest['testReplacements']==oldmanifest['testReplacements']

def test_production_accepts_rename_and_rejects_corruption_loss_and_wrong_exception(pack,tmp_path):
    key=json.loads((pack/'answer-key.json').read_text());data=json.loads((pack/'dataset.json').read_text());tier=next(t for t in ['fast','slow'] if TASK in [r['id'] for r in data[t]['tasks']]);answers={r['id']:key['tasks'][r['id']]['code_prompt']+key['tasks'][r['id']]['canonical_solution'] for r in data[tier]['tasks']}
    result=evaluate_batch(pack,tier,{'text':json.dumps(answers)},tmp_path/'reference-batch')
    assert result['ok'] and result['metrics']['task_pass_rate']==1 and result['evidence'][0]['version']=='12'
    for name,passed in [('alternative-path-rename',9),('wrong-corrupt-jpg',8),('wrong-delete-unselected',8),('wrong-exception-type',8)]:
        code=json.loads((GOAL/'756-controls'/(name+'-behavior')/'input.json').read_text())['code'];r=run_case(code,key['tasks'][TASK]['test'],tmp_path/name)
        assert r['status']=='completed' and r['planned']==9 and r['passed']==passed and r['taskPassed']==name.startswith('alternative')
    answers[TASK]=code;wrong=evaluate_batch(pack,tier,{'text':json.dumps(answers)},tmp_path/'wrong-batch')
    assert wrong['ok'] and wrong['metrics']['task_pass_rate']==(len(answers)-1)/len(answers)

def test_old_v11_bytes_unchanged_and_unreviewed_public_prompt_rejected(tmp_path):
    p=tmp_path/'v11';prepare(SOURCE,p,prompt_format='complete',test_suite='dev-contract-v8')
    for name in ['dataset.json','answer-key.json','control-task.json','manifest.json']:
        assert (p/name).read_bytes()==(GOAL/'benchmark-v11-dev-contract8'/name).read_bytes()
    rows=list(map(json.loads,SOURCE.read_text().splitlines()));next(r for r in rows if r['task_id']==TASK)['complete_prompt']+='\n# different public requirement\n';source=tmp_path/'changed.jsonl';source.write_text(''.join(json.dumps(r)+'\n' for r in rows))
    with pytest.raises(ValueError,match='Reviewed public prompt identity mismatch'):
        prepare(source,tmp_path/'bad',prompt_format='complete',test_suite='dev-contract-v9')
    assert not (tmp_path/'bad').exists()
