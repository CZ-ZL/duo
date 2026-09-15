"""A JSON reader can choose Path/io APIs and still meet the public contract."""
import hashlib,json,sys
from pathlib import Path
import pytest
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts/research'))
from prepare_code_benchmark import prepare
from code_evaluation import evaluate_batch,run_case
GOAL=ROOT/'runs/code-method-goal-20260912';SOURCE=ROOT/'runs/code-benchmark-readiness-20260911/upstream/BigCodeBench-v0.1.4.jsonl';TASK='BigCodeBench/412'
@pytest.fixture(scope='module')
def pack(tmp_path_factory):
    p=tmp_path_factory.mktemp('json-io-contract')/'pack';prepare(SOURCE,p,prompt_format='complete',test_suite='dev-contract-v8');return p

def test_io_replacement_is_versioned_and_preserves_reference_public_input_and_final(pack):
    old=json.loads((GOAL/'benchmark-v10-dev-contract7/answer-key.json').read_text());oldmanifest=json.loads((GOAL/'benchmark-v10-dev-contract7/manifest.json').read_text());key=json.loads((pack/'answer-key.json').read_text());manifest=json.loads((pack/'manifest.json').read_text())
    assert key['evaluatorVersion']==manifest['evaluatorVersion']=='11' and key['version']==manifest['testSuiteVersion']=='bigcodebench-unittest-dev-contract-v8'
    assert all(r==key['tasks'][i] for i,r in old['tasks'].items() if i!=TASK)
    assert key['tasks'][TASK]['original_test']==old['tasks'][TASK]['test']
    assert all(v==key['tasks'][TASK][k] for k,v in old['tasks'][TASK].items() if k!='test')
    assert TASK not in manifest['testAdditions'] and manifest['supersededTestAdditions'][TASK]==oldmanifest['testAdditions'][TASK]
    assert manifest['testReplacements'][TASK]['originalTestSha256']==hashlib.sha256(old['tasks'][TASK]['test'].encode()).hexdigest()
    data=json.loads((pack/'dataset.json').read_text());prev=json.loads((GOAL/'benchmark-v10-dev-contract7/dataset.json').read_text())
    assert all(data[t]['tasks']==prev[t]['tasks'] and data[t]['id']=='bigcodebench-stdlib-v11-dev-contract8-'+t for t in ['fast','slow','final'])

def test_production_accepts_pathlib_and_retains_utf8_nfc_discrimination(pack,tmp_path):
    key=json.loads((pack/'answer-key.json').read_text());data=json.loads((pack/'dataset.json').read_text());answers={t['id']:key['tasks'][t['id']]['code_prompt']+key['tasks'][t['id']]['canonical_solution'] for t in data['slow']['tasks']}
    result=evaluate_batch(pack,'slow',{'text':json.dumps(answers)},tmp_path/'reference-batch')
    assert result['ok'] and result['metrics']['task_pass_rate']==1 and result['evidence'][0]['version']=='11'
    for name,passed in [('alternative-path-read-text',7),('wrong-omits-nfc',6),('wrong-latin1-decoding',5)]:
        code=json.loads((GOAL/'412-controls'/(name+'-behavior')/'input.json').read_text())['code'];r=run_case(code,key['tasks'][TASK]['test'],tmp_path/name)
        assert r['status']=='completed' and r['planned']==7 and r['passed']==passed and r['taskPassed']==name.startswith('alternative')
    answers[TASK]=code;wrong=evaluate_batch(pack,'slow',{'text':json.dumps(answers)},tmp_path/'wrong-batch')
    assert wrong['ok'] and wrong['metrics']['task_pass_rate']==11/12

def test_old_v10_pack_is_identical_and_public_drift_is_refused_before_output(tmp_path):
    p=tmp_path/'v10';prepare(SOURCE,p,prompt_format='complete',test_suite='dev-contract-v7')
    for name in ['dataset.json','answer-key.json','control-task.json','manifest.json']:
        assert (p/name).read_bytes()==(GOAL/'benchmark-v10-dev-contract7'/name).read_bytes()
    rows=list(map(json.loads,SOURCE.read_text().splitlines()));next(r for r in rows if r['task_id']==TASK)['complete_prompt']+='\n# changed requirement\n';source=tmp_path/'changed.jsonl';source.write_text(''.join(json.dumps(r)+'\n' for r in rows))
    with pytest.raises(ValueError,match='Reviewed public prompt identity mismatch'):
        prepare(source,tmp_path/'bad',prompt_format='complete',test_suite='dev-contract-v8')
    assert not (tmp_path/'bad').exists()
