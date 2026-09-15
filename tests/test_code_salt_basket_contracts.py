"""Repair observed API/type issues without deciding format or randomness policy."""
import ast,hashlib,json,sys
from pathlib import Path
import pytest
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts/research'))
from prepare_code_benchmark import prepare
from code_evaluation import evaluate_batch,run_case
GOAL=ROOT/'runs/code-method-goal-20260912';SOURCE=ROOT/'runs/code-benchmark-readiness-20260911/upstream/BigCodeBench-v0.1.4.jsonl'
@pytest.fixture(scope='module')
def pack(tmp_path_factory):
    p=tmp_path_factory.mktemp('salt-basket')/'pack';prepare(SOURCE,p,prompt_format='complete',test_suite='dev-contract-v11');return p

def test_new_version_preserves_public_data_refs_other_tasks_and_prior_salt_assertions(pack):
    old=json.loads((GOAL/'benchmark-v13-dev-contract10/answer-key.json').read_text());key=json.loads((pack/'answer-key.json').read_text());m=json.loads((pack/'manifest.json').read_text());changed={'BigCodeBench/130','BigCodeBench/861'}
    assert key['evaluatorVersion']==m['evaluatorVersion']=='14' and key['version']==m['testSuiteVersion']=='bigcodebench-unittest-dev-contract-v11'
    assert all(row==key['tasks'][id_] for id_,row in old['tasks'].items() if id_ not in changed)
    for id_ in changed:assert all(v==key['tasks'][id_][k] for k,v in old['tasks'][id_].items() if k!='test')
    before=old['tasks']['BigCodeBench/130']['test'];after=key['tasks']['BigCodeBench/130']['test']
    def methods(source):return {n.name:ast.dump(n) for n in ast.walk(ast.parse(source)) if isinstance(n,ast.FunctionDef)}
    oldmethods,newmethods=methods(before),methods(after);oldmethods.pop('test_urandom_called_with_salt_size');newmethods.pop('test_returned_salt_has_requested_size')
    assert oldmethods==newmethods and key['tasks']['BigCodeBench/130']['original_test']==before
    oldm=json.loads((GOAL/'benchmark-v13-dev-contract10/manifest.json').read_text())
    assert m['supersededTestAdditions']['BigCodeBench/130']==oldm['testAdditions']['BigCodeBench/130'] and 'BigCodeBench/130' not in m['testAdditions']
    assert m['contractDecisions']==oldm['contractDecisions']
    assert key['tasks']['BigCodeBench/861']['test'].startswith(old['tasks']['BigCodeBench/861']['test']+'\n')
    d=json.loads((pack/'dataset.json').read_text());od=json.loads((GOAL/'benchmark-v13-dev-contract10/dataset.json').read_text());assert all(d[t]['tasks']==od[t]['tasks'] and d[t]['id']=='bigcodebench-stdlib-v14-dev-contract11-'+t for t in ['fast','slow','final'])

def test_salt_api_alias_accepted_without_dropping_escaped_format_or_digest_checks(pack,tmp_path):
    key=json.loads((pack/'answer-key.json').read_text());tests=key['tasks']['BigCodeBench/130']['test']
    cases=[('alternative-import-alias',7),('wrong-salt-before-data',6),('wrong-fixed-salt',5)]
    for name,passed in cases:
        code=json.loads((GOAL/'salt-basket-controls/130'/(name+'-behavior')/'input.json').read_text())['code'];r=run_case(code,tests,tmp_path/name)
        assert r['status']=='completed' and r['planned']==7 and r['passed']==passed
    code=json.loads((GOAL/'salt-format-isolated/public/input.json').read_text())['code'];r=run_case(code,tests,tmp_path/'plain-only')
    assert r['status']=='completed' and r['planned']==7 and r['passed']==6
    assert [t['name'].split('.')[-1] for t in r['tests'] if t['status']!='passed']==['test_various_hex_formats']

def test_counter_and_empty_baskets_measured_but_randomness_not_claimed(pack,tmp_path):
    key=json.loads((pack/'answer-key.json').read_text());tests=key['tasks']['BigCodeBench/861']['test']
    for name,passed in [('alternative-local-choices',8),('wrong-plain-dict',6),('wrong-drop-empty-baskets',7),('known-nonrandom-always-apple',8)]:
        code=json.loads((GOAL/'salt-basket-controls/861'/(name+'-behavior')/'input.json').read_text())['code'];r=run_case(code,tests,tmp_path/name)
        assert r['status']=='completed' and r['planned']==8 and r['passed']==passed

def test_slow_batch_measures_both_real_defects(pack,tmp_path):
    key=json.loads((pack/'answer-key.json').read_text());d=json.loads((pack/'dataset.json').read_text());answers={r['id']:key['tasks'][r['id']]['code_prompt']+key['tasks'][r['id']]['canonical_solution'] for r in d['slow']['tasks']}
    for number,name in [('130','wrong-salt-before-data'),('861','wrong-plain-dict')]:
        answers['BigCodeBench/'+number]=json.loads((GOAL/'salt-basket-controls'/number/(name+'-behavior')/'input.json').read_text())['code']
    e=evaluate_batch(pack,'slow',{'text':json.dumps(answers)},tmp_path/'batch')
    assert e['ok'] and e['evidence'][0]['version']=='14' and e['metrics']['task_pass_rate']==10/12

def test_prior_v13_bytes_identical(tmp_path):
    p=tmp_path/'v13';prepare(SOURCE,p,prompt_format='complete',test_suite='dev-contract-v10')
    for name in ['dataset.json','answer-key.json','control-task.json','manifest.json']:
        assert (p/name).read_bytes()==(GOAL/'benchmark-v13-dev-contract10'/name).read_bytes()
