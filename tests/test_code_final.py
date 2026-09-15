"""Final data derivation: actual file identity and exposure boundaries, no API."""
import hashlib
import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
from prepare_code_final import prepare


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_pack(tmp_path):
    rows = [{'task_id': f'engineering-final/{i}', 'complete_prompt': f'Return exactly {i}.',
             'code_prompt': 'def task_func():\n', 'canonical_solution': f'    return {i}\n',
             'test': f'assert task_func() == {i}', 'libs': '[]'} for i in range(60)]
    source = tmp_path / 'source.jsonl'
    source.write_text('\n'.join(json.dumps(r) for r in rows) + '\n')
    pack = tmp_path / 'pack';pack.mkdir()
    data = {'version': 1, 'responseMode': 'python-code-v1'}
    for tier, chosen in [('fast', rows[:6]), ('slow', rows[6:18]), ('final', rows[18:36])]:
        data[tier] = {'id': 'original-' + tier, 'tasks': [{'id': r['task_id'], 'input': r['complete_prompt']} for r in chosen]}
    save(pack / 'dataset.json', data)
    save(pack / 'answer-key.json', {'version': 'original-score', 'evaluatorVersion': '24',
         'datasetSha256': sha(pack / 'dataset.json'), 'tasks': {r['task_id']: r for r in rows[:36]}})
    save(pack / 'control-task.json', {'id': 'old-separate-control'})
    save(pack / 'qualification.json', {'status': 'DEVELOPMENT_CONTRACT_QUALIFIED', 'scope': '18 development tasks only'})
    save(pack / 'manifest.json', {'sourceSha256': sha(source), 'measurementQualification': 'DEVELOPMENT_CONTRACT_QUALIFIED',
         'evaluatorVersion': '24', 'eligibleTasks': 60, 'excluded': [], 'files': {n: sha(pack / n) for n in ['dataset.json', 'answer-key.json', 'control-task.json', 'qualification.json']}})
    exposure = tmp_path / 'exposure.json'
    used = [f'BigCodeBench/{i}' for i in range(20)] + [r['task_id'] for r in rows[:37]]
    save(exposure, {'status': 'RECORDED_EXPOSURE_AUDITED_WITH_SOURCE_COPY_CLASSIFICATION',
         'sourceSha256': sha(source), 'exposedTaskIds': used, 'eligibleUnexposedWithinRecordedScope': [r['task_id'] for r in rows[37:]], 'errors': []})
    return pack, source, exposure


def test_new_final_preserves_development_and_excludes_all_recorded_use(tmp_path):
    pack, source, exposure = source_pack(tmp_path)
    before = {p.name: p.read_bytes() for p in pack.iterdir()}
    out = tmp_path / 'new'
    result = prepare(pack, source, exposure, out, 'frozen-control-seed')
    old = json.loads((pack / 'dataset.json').read_text());new = json.loads((out / 'dataset.json').read_text())
    assert new['fast'] == old['fast'] and new['slow'] == old['slow']
    assert len(new['final']['tasks']) == 18 and new['final']['id'] != old['final']['id']
    used = set(json.loads(exposure.read_text())['exposedTaskIds'])
    assert not {t['id'] for t in new['final']['tasks']} & used
    old_key = json.loads((pack / 'answer-key.json').read_text());new_key = json.loads((out / 'answer-key.json').read_text())
    assert new_key['evaluatorVersion'] == old_key['evaluatorVersion']
    for tier in ['fast', 'slow']:
        for task in old[tier]['tasks']:
            assert new_key['tasks'][task['id']] == old_key['tasks'][task['id']]
    assert set(new_key['tasks']) == {t['id'] for tier in ['fast', 'slow', 'final'] for t in new[tier]['tasks']}
    assert new_key['datasetSha256'] == sha(out / 'dataset.json')
    assert {p.name: p.read_bytes() for p in pack.iterdir()} == before
    assert result['modelRequests'] == 0 and result['finalQualified'] is False
    again = tmp_path / 'again'
    prepare(pack, source, exposure, again, 'frozen-control-seed')
    assert json.loads((again / 'dataset.json').read_text()) == new
    manifest = json.loads((out / 'manifest.json').read_text())
    assert all(sha(out / name) == expected for name, expected in manifest['files'].items())
    assert manifest['measurementQualification'] == 'DEVELOPMENT_CONTRACT_QUALIFIED'
    assert manifest['finalQualification'] == 'NOT_RUN'


@pytest.mark.parametrize('fault', ['source-drift', 'exposure-incomplete', 'development-omitted', 'pool-fabricated', 'insufficient-pool'])
def test_refuses_invalid_provenance_without_writing_output(tmp_path, fault):
    pack, source, exposure = source_pack(tmp_path)
    value = json.loads(exposure.read_text())
    if fault == 'source-drift':
        source.write_text(source.read_text() + '\n')
    elif fault == 'exposure-incomplete':
        value['errors'] = [{'error': 'unreadable historical input'}]
    elif fault == 'development-omitted':
        value['exposedTaskIds'].remove('engineering-final/0')
        value['eligibleUnexposedWithinRecordedScope'].append('engineering-final/0')
    elif fault == 'pool-fabricated':
        value['eligibleUnexposedWithinRecordedScope'].append('engineering-final/99999')
    else:
        value['exposedTaskIds'] += value['eligibleUnexposedWithinRecordedScope'][:6]
        value['eligibleUnexposedWithinRecordedScope'] = value['eligibleUnexposedWithinRecordedScope'][6:]
    save(exposure, value)
    out = tmp_path / 'refused'
    with pytest.raises(ValueError):
        prepare(pack, source, exposure, out, 'frozen-control-seed')
    assert not out.exists()


def test_final_alias_compatibility_preserves_cohort_assertions_and_development(tmp_path):
    import ast
    root = Path(__file__).resolve().parents[1]
    r2 = root / 'runs/code-method-goal-20260912/r2-formal-refreeze-20260913'
    old = r2 / 'new-final-pack'
    provenance = json.loads((old / 'final-provenance.json').read_text())
    before = {p.name: sha(p) for p in old.iterdir() if p.is_file()}
    out = tmp_path / 'compatible'
    prepare(provenance['sourcePack'], root / 'runs/code-benchmark-readiness-20260911/upstream/BigCodeBench-v0.1.4.jsonl',
            provenance['exposureAudit'], out, provenance['seed'], unittest_compatibility='py312-equals-v1')
    old_data = json.loads((old / 'dataset.json').read_text());data = json.loads((out / 'dataset.json').read_text())
    old_key = json.loads((old / 'answer-key.json').read_text());key = json.loads((out / 'answer-key.json').read_text())
    assert data['final']['tasks'] == old_data['final']['tasks']
    assert data['final']['id'] != old_data['final']['id']
    assert data['final']['measurementVersion'] == 'bigcodebench-final-py312-equals-v1'
    assert all(data[t] == old_data[t] for t in ['fast', 'slow'])
    changed = [i for i in key['tasks'] if key['tasks'][i] != old_key['tasks'][i]]
    assert changed == ['BigCodeBench/394']
    row = key['tasks'][changed[0]];original = old_key['tasks'][changed[0]]
    assert row['original_test'] == original['test']
    assert all(row[k] == v for k, v in original.items() if k != 'test')
    tree = ast.parse(original['test']);count = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'assertEquals':
            node.func.attr = 'assertEqual';count += 1
    assert count == 1
    assert ast.dump(ast.parse(row['test'])) == ast.dump(tree)
    assert {p.name: sha(p) for p in old.iterdir() if p.is_file()} == before
    manifest = json.loads((out / 'manifest.json').read_text())
    assert manifest['finalMeasurementVersion'] == data['final']['measurementVersion']
    assert all(sha(out / n) == h for n, h in manifest['files'].items())


def test_alias_repair_does_not_change_comments_strings_or_other_objects():
    from prepare_code_final import normalize_unittest_equals
    source = '# self.assertEquals(a,b)\nself.assertEquals("中文", "self.assertEquals")\nother.assertEquals(1,2)\n'
    result, count = normalize_unittest_equals(source)
    assert count == 1
    assert result == '# self.assertEquals(a,b)\nself.assertEqual("中文", "self.assertEquals")\nother.assertEquals(1,2)\n'
