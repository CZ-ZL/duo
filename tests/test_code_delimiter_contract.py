"""An explicitly supplied delimiter must actually affect disk-path evaluation."""
import json,sys
from pathlib import Path
import pytest
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from prepare_code_benchmark import prepare
from code_evaluation import evaluate_batch,run_case
GOAL=ROOT/'runs/code-method-goal-20260912';SOURCE=ROOT/'runs/code-benchmark-readiness-20260911/upstream/BigCodeBench-v0.1.4.jsonl';TASK='BigCodeBench/973'
@pytest.fixture(scope='module')
def pack(tmp_path_factory):
    p=tmp_path_factory.mktemp('delimiter-contract')/'pack';prepare(SOURCE,p,prompt_format='complete',test_suite='dev-contract-v12');return p

def test_delimiter_check_is_versioned_with_old_test_and_reference_preserved(pack):
    old=json.loads((GOAL/'benchmark-v14-dev-contract11/answer-key.json').read_text());key=json.loads((pack/'answer-key.json').read_text());m=json.loads((pack/'manifest.json').read_text())
    assert key['evaluatorVersion']==m['evaluatorVersion']=='15' and key['version']==m['testSuiteVersion']=='bigcodebench-unittest-dev-contract-v12'
    assert all(row==key['tasks'][id_] for id_,row in old['tasks'].items() if id_!=TASK)
    assert all(v==key['tasks'][TASK][k] for k,v in old['tasks'][TASK].items() if k!='test')
    assert key['tasks'][TASK]['test']==old['tasks'][TASK]['test']+'\n'+(ROOT/'scripts/fixtures/code-disk-delimiter-tests-v1.py.txt').read_text()
    d=json.loads((pack/'dataset.json').read_text());od=json.loads((GOAL/'benchmark-v14-dev-contract11/dataset.json').read_text());assert all(d[t]['tasks']==od[t]['tasks'] and d[t]['id']=='bigcodebench-stdlib-v15-dev-contract12-'+t for t in ['fast','slow','final'])

def test_production_accepts_statvfs_and_detects_ignored_argument(pack,tmp_path):
    key=json.loads((pack/'answer-key.json').read_text());tests=key['tasks'][TASK]['test']
    for name,passed in [('reference',7),('alternative-statvfs',7),('wrong-ignores-delimiter',6)]:
        code=json.loads((GOAL/'public-boundary-controls/973'/(name+'-behavior')/'input.json').read_text())['code'];r=run_case(code,tests,tmp_path/name)
        assert r['status']=='completed' and r['planned']==7 and r['passed']==passed
    d=json.loads((pack/'dataset.json').read_text());answers={r['id']:key['tasks'][r['id']]['code_prompt']+key['tasks'][r['id']]['canonical_solution'] for r in d['fast']['tasks']};answers[TASK]=code
    e=evaluate_batch(pack,'fast',{'text':json.dumps(answers)},tmp_path/'batch')
    assert e['ok'] and e['evidence'][0]['version']=='15' and e['metrics']['task_pass_rate']==5/6

def test_prior_v14_bytes_unchanged(tmp_path):
    p=tmp_path/'v14';prepare(SOURCE,p,prompt_format='complete',test_suite='dev-contract-v11')
    for name in ['dataset.json','answer-key.json','control-task.json','manifest.json']:
        assert (p/name).read_bytes()==(GOAL/'benchmark-v14-dev-contract11'/name).read_bytes()
