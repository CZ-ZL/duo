"""Versioned, evidence-led additions to development tests; no paid calls."""
import hashlib
import json
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from prepare_code_benchmark import prepare
from code_evaluation import evaluate_batch

AUDIT = ROOT / 'runs/code-contract-audit-20260912'
SOURCE = ROOT / 'runs/code-benchmark-readiness-20260911/upstream/BigCodeBench-v0.1.4.jsonl'
IDS = {'BigCodeBench/412', 'BigCodeBench/756', 'BigCodeBench/861'}


@pytest.fixture(scope='module')
def revised_pack(tmp_path_factory):
    pack = tmp_path_factory.mktemp('contract-suite') / 'pack'
    prepare(SOURCE, pack, prompt_format='complete', test_suite='dev-contract-v1')
    return pack


def test_revision_preserves_all_original_tests_and_final(revised_pack):
    old = json.loads((AUDIT / 'benchmark-v3-complete/answer-key.json').read_text())
    new = json.loads((revised_pack / 'answer-key.json').read_text())
    data = json.loads((revised_pack / 'dataset.json').read_text())
    original_data = json.loads((AUDIT / 'benchmark-v3-complete/dataset.json').read_text())
    assert new['evaluatorVersion'] == '4'
    assert new['version'] == 'bigcodebench-unittest-dev-contract-v1'
    assert new['datasetSha256'] == hashlib.sha256((revised_pack / 'dataset.json').read_bytes()).hexdigest()
    for tier in ['fast', 'slow', 'final']:
        assert data[tier]['tasks'] == original_data[tier]['tasks']
        assert data[tier]['id'] == 'bigcodebench-stdlib-v4-dev-contract1-' + tier
    for task_id, row in old['tasks'].items():
        if task_id in IDS:
            assert new['tasks'][task_id]['test'].startswith(row['test'] + '\n')
            assert new['tasks'][task_id]['canonical_solution'] == row['canonical_solution']
        else:
            assert new['tasks'][task_id] == row
    manifest = json.loads((revised_pack / 'manifest.json').read_text())
    assert set(manifest['testAdditions']) == IDS
    assert manifest['measurementQualification'] == 'PARTIAL_DEVELOPMENT_CONTRACT_REPAIR_NOT_QUALIFIED'


@pytest.mark.parametrize('task_id,variant,count', [
    ('BigCodeBench/412', 'omit-nfc', 6),
    ('BigCodeBench/756', 'copy-instead-of-move', 6),
    ('BigCodeBench/861', 'forbidden-cart-item', 5),
])
def test_production_evaluator_rejects_known_defect_and_accepts_reference(revised_pack, tmp_path, task_id, variant, count):
    key = json.loads((revised_pack / 'answer-key.json').read_text())
    data = json.loads((revised_pack / 'dataset.json').read_text())
    answers = {t['id']: key['tasks'][t['id']]['code_prompt'] + key['tasks'][t['id']]['canonical_solution']
               for t in data['slow']['tasks']}
    answers[task_id] = json.loads((AUDIT / f'weak-controls/{variant}-original/input.json').read_text())['code']
    result = evaluate_batch(revised_pack, 'slow', {'text': json.dumps(answers)}, tmp_path / 'flawed')
    assert result['ok'] and result['metrics']['task_pass_rate'] == 11 / 12
    evidence = result['evidence'][0]
    assert evidence['version'] == '4' and evidence['testSuiteVersion'] == key['version']
    row = next(r for r in evidence['rows'] if r['taskId'] == task_id)
    assert row['status'] == 'completed' and row['passed'] == count and row['planned'] == count + 1
    assert row['tests'][-1]['status'] == 'failed'


def test_unsupported_revision_options_refuse_before_writing(tmp_path):
    for options in [{'test_suite': 'typo'}, {'test_suite': 'dev-contract-v1'}]:
        out = tmp_path / 'bad'
        with pytest.raises(ValueError):
            prepare(SOURCE, out, **options)
        assert not out.exists()


def test_original_test_drift_refuses_before_writing(tmp_path):
    rows = [json.loads(line) for line in SOURCE.read_text().splitlines()]
    next(r for r in rows if r['task_id'] == 'BigCodeBench/412')['test'] += '\n# new upstream test version\n'
    source = tmp_path / 'changed.jsonl'
    source.write_text(''.join(json.dumps(r) + '\n' for r in rows))
    out = tmp_path / 'bad'
    with pytest.raises(ValueError, match='original test identity'):
        prepare(source, out, prompt_format='complete', test_suite='dev-contract-v1')
    assert not out.exists()
