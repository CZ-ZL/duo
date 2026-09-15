"""Owner-selected benchmark semantics; real workers, legal alternatives and mutants."""
import json, os, sys
from pathlib import Path
import pytest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts/research'))
from prepare_code_benchmark import prepare
from code_evaluation import run_case
GOAL=ROOT/'runs/code-method-goal-20260912'
SOURCE=ROOT/'runs/code-benchmark-readiness-20260911/upstream/BigCodeBench-v0.1.4.jsonl'

@pytest.fixture(scope='module')
def owner_pack(tmp_path_factory):
    p=tmp_path_factory.mktemp('owner-contract')/'pack'
    prepare(SOURCE,p,prompt_format='complete',test_suite=os.getenv('DUO_OWNER_SUITE','dev-contract-v21'))
    return p

MOVE_ALT='''import fnmatch, shutil
from pathlib import Path
def task_func(source_directory, destination_directory, file_pattern):
    src=Path(source_directory)
    if not src.exists(): raise FileNotFoundError(source_directory)
    result=[]
    for p in src.rglob('*'):
        if p.is_file() and fnmatch.fnmatch(p.name,file_pattern):
            shutil.move(str(p),str(Path(destination_directory)/p.name))
            result.append(p.name)
    return result
'''

def test_759_reference_obeys_approved_missing_source_rule(owner_pack,tmp_path):
    r=json.loads((owner_pack/'answer-key.json').read_text())['tasks']['BigCodeBench/759']
    tests=(ROOT/'scripts/research/fixtures/code-owner-759-tests.py.txt').read_text()
    result=run_case(r['code_prompt']+r['canonical_solution'],tests,tmp_path/'reference')
    assert result['status']=='completed' and result['passed']==result['planned']==6

def test_759_production_accepts_pathlib_and_rejects_wrong_programs(owner_pack,tmp_path):
    r=json.loads((owner_pack/'answer-key.json').read_text())['tasks']['BigCodeBench/759']
    controls={'pathlib':(MOVE_ALT,True),'top-only':(MOVE_ALT.replace("rglob('*')","glob('*')"),False),
              'copy':(MOVE_ALT.replace('shutil.move','shutil.copyfile'),False),
              'full-path':(MOVE_ALT.replace('result.append(p.name)','result.append(str(p))'),False)}
    for name,(code,ok) in controls.items():
        result=run_case(code,r['test'],tmp_path/name)
        assert result['status']=='completed'
        assert (result['passed']==result['planned']) is ok, (name,result)

def test_prior_v15_remains_byte_identical(tmp_path):
    p=tmp_path/'old';prepare(SOURCE,p,prompt_format='complete',test_suite='dev-contract-v12')
    for name in ['dataset.json','answer-key.json','control-task.json','manifest.json']:
        assert (p/name).read_bytes()==(GOAL/'benchmark-v15-dev-contract12'/name).read_bytes()

CSV_ALT=r'''import csv,re
def task_func(file_path,regex_pattern=r'\(.+?\)|\w+|[\W_]+'):
    with open(file_path,newline='') as f: text=' '.join(row[0] for row in csv.reader(f))
    result={}
    for match in re.findall(regex_pattern,text): result[match]=result.get(match,0)+1
    return result
'''

def test_327_custom_pattern_and_first_column(owner_pack,tmp_path):
    row=json.loads((owner_pack/'answer-key.json').read_text())['tasks']['BigCodeBench/327']
    for name,code,ok in [('reference',row['code_prompt']+row['canonical_solution'],True),('alternative',CSV_ALT,True),
                         ('all-columns',CSV_ALT.replace("row[0] for row", "' '.join(row) for row"),False),
                         ('ignores-pattern',CSV_ALT.replace('re.findall(regex_pattern,text)',"re.findall(r'\\(.+?\\)|\\w+|[\\W_]+',text)"),False)]:
        r=run_case(code,row['test'],tmp_path/name)
        assert r['status']=='completed' and (r['passed']==r['planned']) is ok,(name,r)

INSERT_ALT='''import random
from array import array
def task_func(n=10,total=100):
    remaining=total; values=[]
    for _ in range(n-1):
        v=random.randint(0,remaining);values.append(v);remaining-=v
    values.append(remaining);values.sort()
    new_num=random.randint(0,total)
    pos=next((i for i,v in enumerate(values) if v>=new_num),len(values))
    return array('i',values),pos,new_num
'''

def test_595_insertion_is_observable_and_real(owner_pack,tmp_path):
    row=json.loads((owner_pack/'answer-key.json').read_text())['tasks']['BigCodeBench/595']
    tests=(ROOT/'scripts/research/fixtures/code-owner-595-tests.py.txt').read_text()
    for name,code,ok in [('reference',row['code_prompt']+row['canonical_solution'],True),('left-insertion',INSERT_ALT,True),
                         ('wrong-position',INSERT_ALT.replace("return array('i',values),pos,new_num","return array('i',values),0,total"),False),
                         ('wrong-sum',INSERT_ALT.replace('values.append(remaining)','values.append(remaining+1)'),False)]:
        r=run_case(code,tests,tmp_path/name)
        assert r['status']=='completed' and (r['passed']==r['planned']) is ok,(name,r)
    assert row['test']==tests

BACKUP_ALT='''import shutil,tempfile
from pathlib import Path
BACKUP_DIR='/tmp/backup'
def task_func(directory):
    src=Path(directory);backup=None
    if not src.is_dir(): return None,[f'Directory does not exist: {directory}']
    try:
        Path(BACKUP_DIR).mkdir(parents=True,exist_ok=True)
        backup=Path(tempfile.mkdtemp(dir=BACKUP_DIR))
        shutil.copytree(src,backup/src.name)
        for child in src.iterdir():
            if child.is_dir(): shutil.rmtree(child)
            else: child.unlink()
        return str(backup),[]
    except Exception as error: return str(backup) if backup else None,[str(error)]
'''

def test_779_backup_is_repeatable_and_preserves_sources_on_failure(owner_pack,tmp_path):
    row=json.loads((owner_pack/'answer-key.json').read_text())['tasks']['BigCodeBench/779']
    tests=(ROOT/'scripts/research/fixtures/code-owner-779-tests.py.txt').read_text()
    for name,code,ok in [('reference',row['code_prompt']+row['canonical_solution'],True),('pathlib',BACKUP_ALT,True),
                         ('no-backup',BACKUP_ALT.replace('shutil.copytree(src,backup/src.name)','pass'),False),
                         ('no-clean',BACKUP_ALT.replace('for child in src.iterdir():','for child in []:'),False),
                         ('deletes-on-failure',BACKUP_ALT.replace('except Exception as error: return', 'except Exception as error:\n        shutil.rmtree(src)\n        return'),False)]:
        r=run_case(code,tests,tmp_path/name)
        assert r['status']=='completed' and (r['passed']==r['planned']) is ok,(name,r)
    assert row['test']==tests

@pytest.mark.parametrize('task,correct,wrong',[
    (130,'salt-basket-controls/130/alternative-import-alias-current','salt-format-isolated/current'),
    (769,'public-boundary-controls/769/reference-current','public-boundary-controls/769/alternative-lexical-tie-current'),
    (762,'public-boundary-controls/762/reference-current','public-boundary-controls/762/alternative-flat-archive-current'),
])
def test_published_boundaries_retain_scoring_and_expose_rules(owner_pack,tmp_path,task,correct,wrong):
    row=json.loads((owner_pack/'answer-key.json').read_text())['tasks'][f'BigCodeBench/{task}']
    old=json.loads((GOAL/'benchmark-v15-dev-contract12/answer-key.json').read_text())['tasks'][f'BigCodeBench/{task}']
    assert row['test']==old['test'] and row['canonical_solution']==old['canonical_solution']
    assert row['complete_prompt']!=old['complete_prompt']
    for name,path,ok in [('correct',correct,True),('wrong-under-approved-contract',wrong,False)]:
        code=json.loads((GOAL/path/'input.json').read_text())['code']
        r=run_case(code,row['test'],tmp_path/name)
        assert r['status']=='completed' and (r['passed']==r['planned']) is ok,(name,r)

@pytest.mark.parametrize('task,correct,wrong',[
    (931,'public-boundary-controls/931/reference-ascii-current','public-boundary-controls/931/alternative-unicode-current'),
    (861,'salt-basket-controls/861/alternative-local-choices-current','salt-basket-controls/861/known-nonrandom-always-apple-current'),
])
def test_ascii_and_distribution_controls(owner_pack,tmp_path,task,correct,wrong):
    row=json.loads((owner_pack/'answer-key.json').read_text())['tasks'][f'BigCodeBench/{task}']
    reference=row['code_prompt']+row['canonical_solution']
    controls=[('reference',reference,True),('legal-alternative',json.loads((GOAL/correct/'input.json').read_text())['code'],True),
              ('wrong',json.loads((GOAL/wrong/'input.json').read_text())['code'],False)]
    if task==931:
        controls[1]=('legal-alternative', '''from collections import defaultdict
def task_func(word):
    word=''.join(c for c in word if 'A'<=c<='Z' or 'a'<=c<='z')
    result=defaultdict(lambda:0)
    for i in range(len(word)-1):result[word[i:i+2]]+=1
    return result
''',True)
    else:
        biased=controls[1][1].replace('k=len(items)', 'weights=[92,2,2,2,2],k=len(items)')
        assert biased!=controls[1][1]
        controls.append(('strongly-biased',biased,False))
    for name,code,ok in controls:
        r=run_case(code,row['test'],tmp_path/name)
        assert r['status']=='completed' and (r['passed']==r['planned']) is ok,(name,r)
