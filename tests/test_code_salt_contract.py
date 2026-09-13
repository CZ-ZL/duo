"""Owner-selected public salt order, separately versioned and never rescored."""
import hashlib
import json
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from prepare_code_benchmark import prepare
from code_evaluation import run_case, evaluate_batch

AUDIT = ROOT / 'runs/code-contract-audit-20260912'
SOURCE = ROOT / 'runs/code-benchmark-readiness-20260911/upstream/BigCodeBench-v0.1.4.jsonl'
TASK = 'BigCodeBench/130'


@pytest.fixture(scope='module')
def pack(tmp_path_factory):
    out = tmp_path_factory.mktemp('salt-contract') / 'pack'
    prepare(SOURCE, out, prompt_format='complete', test_suite='dev-contract-v2')
    return out


def test_salt_contract_version_and_only_authorized_reference_prompt_change(pack):
    old = json.loads((AUDIT / 'benchmark-v4-dev-contract1/answer-key.json').read_text())
    key = json.loads((pack / 'answer-key.json').read_text())
    assert key['version'] == 'bigcodebench-unittest-dev-contract-v2' and key['evaluatorVersion'] == '5'
    for task_id, row in old['tasks'].items():
        if task_id != TASK:
            assert key['tasks'][task_id] == row
    row = key['tasks'][TASK]
    assert row['test'].startswith(old['tasks'][TASK]['test'] + '\n')
    assert row['canonical_solution'] == old['tasks'][TASK]['canonical_solution'].replace('salted_data = salt + data', 'salted_data = data + salt')
    assert 'SHA256(data + salt)' in row['complete_prompt']
    manifest = json.loads((pack / 'manifest.json').read_text())
    assert manifest['contractDecisions'][TASK] == 'SHA256(data + salt) per owner choice of the public specification'
    assert manifest['testAdditions'][TASK]['referenceCorrection']['beforeSha256'] == hashlib.sha256(old['tasks'][TASK]['canonical_solution'].encode()).hexdigest()
    data = json.loads((pack / 'dataset.json').read_text())
    assert next(t['input'] for t in data['slow']['tasks'] if t['id'] == TASK) == row['complete_prompt']


def test_production_scoring_accepts_public_order_and_rejects_old_reference_and_fake_hash(pack, tmp_path):
    key = json.loads((pack / 'answer-key.json').read_text())
    data = json.loads((pack / 'dataset.json').read_text())
    answers = {t['id']: key['tasks'][t['id']]['code_prompt'] + key['tasks'][t['id']]['canonical_solution'] for t in data['slow']['tasks']}
    result = evaluate_batch(pack, 'slow', {'text': json.dumps(answers)}, tmp_path / 'correct')
    assert result['ok'] and result['metrics']['task_pass_rate'] == 1
    assert result['evidence'][0]['version'] == '5'
    assert result['evidence'][0]['qualification'] == 'CUSTOM_RUNNER_PARTIAL_DEVELOPMENT_CONTRACT_REPAIR'
    old = json.loads((AUDIT / 'benchmark-v4-dev-contract1/answer-key.json').read_text())['tasks'][TASK]
    for name, code in [
        ('old-reference', old['code_prompt'] + old['canonical_solution']),
        ('salt-only-hash', key['tasks'][TASK]['code_prompt'] + key['tasks'][TASK]['canonical_solution'].replace('hashlib.sha256(salted_data).hexdigest()', 'hashlib.sha256(salt).hexdigest()')),
    ]:
        original = run_case(code, old['test'], tmp_path / (name + '-original'))
        revised = run_case(code, key['tasks'][TASK]['test'], tmp_path / (name + '-revised'))
        assert original['taskPassed'], original
        assert revised['status'] == 'completed' and not revised['taskPassed'], revised
        assert any(t['status'] == 'failed' and 'digest_matches_public_order' in t['name'] for t in revised['tests'])


def test_previous_v4_pack_regenerates_byte_identically(tmp_path):
    out = tmp_path / 'v4'
    prepare(SOURCE, out, prompt_format='complete', test_suite='dev-contract-v1')
    for name in ['dataset.json', 'answer-key.json', 'control-task.json', 'manifest.json']:
        assert (out / name).read_bytes() == (AUDIT / 'benchmark-v4-dev-contract1' / name).read_bytes()


def test_reference_drift_refused_before_output(tmp_path):
    rows = [json.loads(line) for line in SOURCE.read_text().splitlines()]
    next(r for r in rows if r['task_id'] == TASK)['canonical_solution'] += '\n# changed upstream reference\n'
    source = tmp_path / 'changed.jsonl'
    source.write_text(''.join(json.dumps(r) + '\n' for r in rows))
    out = tmp_path / 'bad'
    with pytest.raises(ValueError, match='reference identity'):
        prepare(source, out, prompt_format='complete', test_suite='dev-contract-v2')
    assert not out.exists()
