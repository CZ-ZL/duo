"""Behavior controls for the remaining five reviewed development tasks."""
import hashlib,json,sys
from pathlib import Path
import pytest
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts/research'))
from prepare_code_benchmark import prepare
from code_evaluation import evaluate_batch,run_case
GOAL=ROOT/'runs/code-method-goal-20260912';SOURCE=ROOT/'runs/code-benchmark-readiness-20260911/upstream/BigCodeBench-v0.1.4.jsonl';NUMBERS=['911','769','288','358','762']
@pytest.fixture(scope='module')
def pack(tmp_path_factory):
    p=tmp_path_factory.mktemp('remaining-contracts')/'pack';prepare(SOURCE,p,prompt_format='complete',test_suite='dev-contract-v10');return p

def test_five_additions_preserve_all_other_data_and_bind_new_version(pack):
    old=json.loads((GOAL/'benchmark-v12-dev-contract9/answer-key.json').read_text());key=json.loads((pack/'answer-key.json').read_text());manifest=json.loads((pack/'manifest.json').read_text());changed={'BigCodeBench/'+n for n in NUMBERS}
    assert key['evaluatorVersion']==manifest['evaluatorVersion']=='13' and key['version']==manifest['testSuiteVersion']=='bigcodebench-unittest-dev-contract-v10'
    for id_,row in old['tasks'].items():
        if id_ not in changed:assert row==key['tasks'][id_]
        else:
            after=key['tasks'][id_];assert after['test'].startswith(row['test']+'\n')
            assert all(v==after[k] for k,v in row.items() if k!='test')
            assert manifest['testAdditions'][id_]['combinedTestSha256']==hashlib.sha256(after['test'].encode()).hexdigest()
    data=json.loads((pack/'dataset.json').read_text());prior=json.loads((GOAL/'benchmark-v12-dev-contract9/dataset.json').read_text())
    assert all(data[t]['tasks']==prior[t]['tasks'] and data[t]['id']=='bigcodebench-stdlib-v13-dev-contract10-'+t for t in ['fast','slow','final'])

@pytest.mark.parametrize('number',NUMBERS)
def test_production_accepts_alternative_and_rejects_specific_wrong_behavior(pack,tmp_path,number):
    key=json.loads((pack/'answer-key.json').read_text());tests=key['tasks']['BigCodeBench/'+number]['test'];total=7 if number=='358' else 6
    for name,passed in [('alternative',total),('wrong-specific-behavior',total-1)]:
        code=json.loads((GOAL/'remaining-five-controls'/number/(name+'-behavior')/'input.json').read_text())['code'];r=run_case(code,tests,tmp_path/name)
        assert r['status']=='completed' and r['planned']==total and r['passed']==passed and r['taskPassed']==(name=='alternative')

def test_full_development_batch_reports_five_specific_failures(pack,tmp_path):
    key=json.loads((pack/'answer-key.json').read_text());data=json.loads((pack/'dataset.json').read_text())
    for tier in ['fast','slow']:
        answers={r['id']:key['tasks'][r['id']]['code_prompt']+key['tasks'][r['id']]['canonical_solution'] for r in data[tier]['tasks']};bad=0
        for number in NUMBERS:
            id_='BigCodeBench/'+number
            if id_ in answers:
                answers[id_]=json.loads((GOAL/'remaining-five-controls'/number/'wrong-specific-behavior-behavior/input.json').read_text())['code'];bad+=1
        e=evaluate_batch(pack,tier,{'text':json.dumps(answers)},tmp_path/tier)
        assert e['ok'] and e['evidence'][0]['version']=='13' and e['metrics']['task_pass_rate']==(len(answers)-bad)/len(answers)

def test_old_v12_bytes_preserved_and_public_drift_rejected(tmp_path):
    p=tmp_path/'v12';prepare(SOURCE,p,prompt_format='complete',test_suite='dev-contract-v9')
    for name in ['dataset.json','answer-key.json','control-task.json','manifest.json']:
        assert (p/name).read_bytes()==(GOAL/'benchmark-v12-dev-contract9'/name).read_bytes()
    rows=list(map(json.loads,SOURCE.read_text().splitlines()));next(r for r in rows if r['task_id']=='BigCodeBench/911')['complete_prompt']+='\n# new public contract\n';source=tmp_path/'changed.jsonl';source.write_text(''.join(json.dumps(r)+'\n' for r in rows))
    with pytest.raises(ValueError,match='Reviewed public prompt identity mismatch'):
        prepare(source,tmp_path/'bad',prompt_format='complete',test_suite='dev-contract-v10')
    assert not (tmp_path/'bad').exists()
