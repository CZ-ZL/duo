"""Versioned API-independent real-file behavior for the reviewed task565."""
import hashlib
import json
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/research'))
from prepare_code_benchmark import prepare
from code_evaluation import evaluate_batch, run_case

GOAL = ROOT / 'runs/code-method-goal-20260912'
SOURCE = ROOT / 'runs/code-benchmark-readiness-20260911/upstream/BigCodeBench-v0.1.4.jsonl'
TASK = 'BigCodeBench/565'


@pytest.fixture(scope='module')
def pack(tmp_path_factory):
    out = tmp_path_factory.mktemp('hash-contract') / 'pack'
    prepare(SOURCE, out, prompt_format='complete', test_suite='dev-contract-v4')
    return out


def test_replacement_is_versioned_and_retains_originals_prompts_references_and_final(pack):
    old = json.loads((GOAL / 'benchmark-v6-dev-contract3/answer-key.json').read_text())
    new = json.loads((pack / 'answer-key.json').read_text())
    assert new['evaluatorVersion'] == '7' and new['version'] == 'bigcodebench-unittest-dev-contract-v4'
    assert new['executionRequirements'] == {'platform': 'linux', 'machine': 'x86_64'}
    for task_id, row in old['tasks'].items():
        if task_id == TASK:
            assert new['tasks'][TASK]['original_test'] == row['test']
            assert {k: v for k, v in new['tasks'][TASK].items() if k not in ['test', 'original_test']} == {k: v for k, v in row.items() if k != 'test'}
        else:
            assert new['tasks'][task_id] == row
    data = json.loads((pack / 'dataset.json').read_text())
    previous = json.loads((GOAL / 'benchmark-v6-dev-contract3/dataset.json').read_text())
    for tier in ['fast', 'slow', 'final']:
        assert data[tier]['tasks'] == previous[tier]['tasks']
        assert data[tier]['id'] == 'bigcodebench-stdlib-v7-dev-contract4-' + tier
    manifest = json.loads((pack / 'manifest.json').read_text())
    replacement = manifest['testReplacements'][TASK]
    assert replacement['originalTestSha256'] == hashlib.sha256(old['tasks'][TASK]['test'].encode()).hexdigest()
    assert replacement['replacementTestSha256'] == hashlib.sha256(new['tasks'][TASK]['test'].encode()).hexdigest()
    assert replacement['fixtureSha256'] == '107cf5a51e49fae42dec5c5e9bec60c4656582ab384650234a0cc592d880e5ed'
    assert 'registered tests' in manifest['primaryMetric']


def test_production_accepts_reference_and_alternative_and_rejects_hash_and_load_errors(pack, tmp_path):
    key = json.loads((pack / 'answer-key.json').read_text())
    data = json.loads((pack / 'dataset.json').read_text())
    answers = {t['id']: key['tasks'][t['id']]['code_prompt'] + key['tasks'][t['id']]['canonical_solution'] for t in data['fast']['tasks']}
    correct = evaluate_batch(pack, 'fast', {'text': json.dumps(answers)}, tmp_path / 'reference-batch')
    assert correct['ok'] and correct['metrics']['task_pass_rate'] == 1
    assert correct['evidence'][0]['version'] == '7'
    assert correct['evidence'][0]['qualification'] == 'CUSTOM_RUNNER_PARTIAL_DEVELOPMENT_CONTRACT_REPAIR'
    for name in ['alternative-streamed-hexdigest', 'wrong-constant-hashes', 'wrong-skips-load']:
        code = json.loads((GOAL / '565-controls' / (name + '-behavior/input.json')).read_text())['code']
        answers[TASK] = code
        result = evaluate_batch(pack, 'fast', {'text': json.dumps(answers)}, tmp_path / name)
        assert result['ok'] and result['metrics']['task_pass_rate'] == (1 if name.startswith('alternative') else 5 / 6)
        measured = next(r for r in result['evidence'][0]['rows'] if r['taskId'] == TASK)
        assert measured['status'] == 'completed' and measured['planned'] == 6


def test_wrong_platform_is_infrastructure_refusal_without_grading_candidates(pack, tmp_path, monkeypatch):
    import platform
    monkeypatch.setattr(platform, 'machine', lambda: 'aarch64')
    output = tmp_path / 'unused'
    result = evaluate_batch(pack, 'fast', {'text': '{}'}, output)
    assert result['ok'] is False and result['metrics'] == {}
    assert result['evidence'][0]['kind'] == 'unsupported_evaluator_environment'
    assert not output.exists()


def test_v6_stays_byte_identical_and_reviewed_prompt_drift_is_refused(tmp_path):
    out = tmp_path / 'v6'
    prepare(SOURCE, out, prompt_format='complete', test_suite='dev-contract-v3')
    for name in ['dataset.json', 'answer-key.json', 'control-task.json', 'manifest.json']:
        assert (out / name).read_bytes() == (GOAL / 'benchmark-v6-dev-contract3' / name).read_bytes()
    rows = list(map(json.loads, SOURCE.read_text().splitlines()))
    next(r for r in rows if r['task_id'] == TASK)['complete_prompt'] += '\n# new public rule\n'
    source = tmp_path / 'changed.jsonl'
    source.write_text(''.join(json.dumps(r) + '\n' for r in rows))
    with pytest.raises(ValueError, match='public prompt identity'):
        prepare(source, tmp_path / 'bad', prompt_format='complete', test_suite='dev-contract-v4')
    assert not (tmp_path / 'bad').exists()
