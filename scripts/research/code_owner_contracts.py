"""Versioned owner-selected semantics, bound to the reviewed evaluator15 rows."""
import hashlib
import json
from pathlib import Path

FIXTURES=Path(__file__).with_name('fixtures')
ORDER=[759,327,595,779,130,769,762,931,861]

def sha(value):
    return hashlib.sha256(value.encode()).hexdigest()

def clarify(prompt, text):
    for marker in ('    """\n', "    '''\n"):
        if marker in prompt:
            return prompt.replace(marker, marker+'    Contract clarification: '+text+'\n\n', 1)
    raise ValueError('Public contract docstring not found')

def apply_owner_contracts(selected, revision):
    if not 1 <= revision <= len(ORDER): raise ValueError('Unknown owner contract revision')
    metadata=json.loads((FIXTURES/'code-owner-contracts.json').read_text())
    rows=[dict(r) for r in selected]; changes={}
    for number in ORDER[:revision]:
        task='BigCodeBench/'+str(number)
        if task not in {r['task_id'] for r in rows[:18]}: raise ValueError('Owner changes must stay in development')
        row=next(r for r in rows if r['task_id']==task); contract=metadata[task]
        for field,expected in contract['baseHashes'].items():
            if sha(row[field])!=expected: raise ValueError('Reviewed owner contract identity mismatch: '+task+'/'+field)
        row['owner_contract_original']={f:row[f] for f in contract['baseHashes']}
        if number==759:
            row['complete_prompt']=row['complete_prompt'].replace("['task_func_data/file1.txt', 'task_func_data/file2.txt']", "['file1.txt', 'file2.txt']")
            row['canonical_solution']='    if not os.path.exists(source_directory):\n        raise FileNotFoundError(source_directory)\n'+row['canonical_solution']
            row['test']=(FIXTURES/'code-owner-759-tests.py.txt').read_text()
        elif number==327:
            row['complete_prompt']=row['complete_prompt'].replace(
                'By default, it captures content between parentheses as a single match and \n    any word or sequence of non-alphanumeric characters outside as matches in a string.',
                'Use re.findall with the literal regex_pattern, including its alternative order and greedy matches.\n    Only the first column of each CSV row is read, then joined with a single space.')
            row['test']+='\n'+(FIXTURES/'code-owner-327-tests.py.txt').read_text()
        elif number==595:
            row['complete_prompt']=row['complete_prompt'].replace(
                "The function uses a retry mechanism to ensure the generated numbers sum up to 'total'.",
                "The generated nonnegative integer numbers must sum to 'total'; the generation algorithm is unrestricted.")
            row['complete_prompt']=row['complete_prompt'].replace('tuple: A tuple containing the sorted numbers as an array and the insertion position for a new number.',
                'tuple: (nums, pos, new_num), containing the sorted array, a valid sorted insertion position, and the actual new integer.')
            row['complete_prompt']=row['complete_prompt'].replace('sorted_nums, pos = task_func','sorted_nums, pos, new_num = task_func')
            row['canonical_solution']="""    cuts = sorted([0, total] + [random.randint(0, total) for _ in range(n - 1)])
    nums = array('i', sorted(b - a for a, b in zip(cuts, cuts[1:])))
    new_num = random.randint(0, total)
    pos = bisect.bisect(nums, new_num)
    return nums, pos, new_num
"""
            row['test']=(FIXTURES/'code-owner-595-tests.py.txt').read_text()
        elif number==779:
            for field in ['complete_prompt','code_prompt']:
                row[field]=row[field].replace('import shutil','import shutil\nimport uuid').replace('return "/fake/backup/path"', 'return os.path.join(BACKUP_DIR, "backup_" + uuid.uuid4().hex)')
            row['complete_prompt']=clarify(row['complete_prompt'],
                'BACKUP_DIR is the configurable backup root. If it cannot hold a backup directory, report an error and preserve the source. The example path is illustrative.')
            row['canonical_solution']='''    if not os.path.isdir(directory):
        return None, [f"Directory does not exist: {directory}"]
    backup_dir = None
    errors = []
    try:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        backup_dir = get_unique_backup_dir()
        os.makedirs(backup_dir)
        shutil.copytree(directory, os.path.join(backup_dir, os.path.basename(os.path.normpath(directory))))
    except Exception as error:
        return backup_dir, [str(error)]
    try:
        shutil.rmtree(directory)
        os.makedirs(directory)
    except Exception as error:
        errors.append(str(error))
    return backup_dir, errors
'''
            row['test']=(FIXTURES/'code-owner-779-tests.py.txt').read_text()
        elif number in [931,861]:
            if number==931:
                row['complete_prompt']=row['complete_prompt'].replace('where only alphabetic characters are considered.', 'where only ASCII letters A-Z and a-z are considered, preserving case.')
            row['test']+='\n'+(FIXTURES/f'code-owner-{number}-tests.py.txt').read_text()
        row['complete_prompt']=clarify(row['complete_prompt'],contract['decision']+'.')
        changes[task]={**contract,'revisedHashes':{f:sha(row[f]) for f in contract['baseHashes']},
                       'originalFieldsArchivedAs':'owner_contract_original', 'decisionSource':'Owner approved all nine recommendations; decision-nine-contracts.json'}
    return rows,changes
