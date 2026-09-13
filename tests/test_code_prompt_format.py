"""Public prompt preservation and version isolation; no provider calls."""
import hashlib
import json
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from prepare_code_benchmark import prepare


def fixture_source(tmp_path, missing=False):
    rows = [{'task_id': f'BigCodeBench/{i}', 'libs': '[]', 'entry_point': 'task_func',
             'code_prompt': 'def task_func():\n', 'instruct_prompt': f'Concise request {i}',
             'complete_prompt': f'def task_func():\n    """Public example {i}: return a string."""\n',
             'canonical_solution': f'    return "PRIVATE_CANONICAL_{i}"\n',
             'test': f'# PRIVATE_TEST_{i}\nimport unittest\nclass TestCases(unittest.TestCase):\n    pass\n'}
            for i in [4, *range(20, 56)]]
    if missing:
        del rows[-1]['complete_prompt']
    path = tmp_path / 'source.jsonl'
    path.write_text(''.join(json.dumps(row) + '\n' for row in rows))
    return path, rows


def test_complete_prompt_preserves_public_examples_and_excludes_private_fields(tmp_path):
    source, rows = fixture_source(tmp_path)
    out = tmp_path / 'complete'
    prepare(source, out, prompt_format='complete')
    dataset = json.loads((out / 'dataset.json').read_text())
    by_id = {r['task_id']: r for r in rows}
    for tier in ['fast', 'slow', 'final']:
        assert dataset[tier]['id'] == 'bigcodebench-stdlib-v3-complete-' + tier
        for task in dataset[tier]['tasks']:
            assert task['input'] == by_id[task['id']]['complete_prompt']
            assert 'Public example' in task['input']
            assert 'PRIVATE_' not in task['input']
    manifest = json.loads((out / 'manifest.json').read_text())
    assert manifest['promptFormat'] == 'bigcodebench-complete-v1'
    assert manifest['evaluatorVersion'] == '3'
    assert 'not a repair of API-specific mocks' in manifest['revisionReason']


def test_missing_complete_prompt_refuses_before_writing_no_silent_fallback(tmp_path):
    source, _ = fixture_source(tmp_path, missing=True)
    out = tmp_path / 'bad'
    with pytest.raises(ValueError, match='complete_prompt'):
        prepare(source, out, prompt_format='complete')
    assert not out.exists()


def test_unknown_prompt_format_refused(tmp_path):
    source, _ = fixture_source(tmp_path)
    with pytest.raises(ValueError, match='prompt_format'):
        prepare(source, tmp_path / 'bad', prompt_format='typo')


def test_original_pack_reproduces_and_complete_variant_retains_task_selection_and_tests(tmp_path):
    previous = ROOT / 'runs/code-benchmark-readiness-20260911'
    source = previous / 'upstream/BigCodeBench-v0.1.4.jsonl'
    legacy, complete = tmp_path / 'legacy', tmp_path / 'complete'
    prepare(source, legacy)
    for name in ['dataset.json', 'answer-key.json', 'control-task.json', 'manifest.json']:
        assert (legacy / name).read_bytes() == (previous / 'benchmark-v2' / name).read_bytes(), name
    prepare(source, complete, prompt_format='complete')
    old = json.loads((legacy / 'manifest.json').read_text())
    new = json.loads((complete / 'manifest.json').read_text())
    assert new['splits'] == old['splits'] and new['excluded'] == old['excluded']
    key = json.loads((complete / 'answer-key.json').read_text())
    assert key['tasks'] == json.loads((legacy / 'answer-key.json').read_text())['tasks']
    assert key['datasetSha256'] == hashlib.sha256((complete / 'dataset.json').read_bytes()).hexdigest()
    dataset = json.loads((complete / 'dataset.json').read_text())
    # These omissions were established on development tasks; never inspect final
    # task content to choose repairs or examples.
    dev = {t['id']: t['input'] for tier in ['fast', 'slow'] for t in dataset[tier]['tasks']}
    assert 'MD5 Hash:' in dev['BigCodeBench/565']
    assert 'isinstance(result[1], str)' in dev['BigCodeBench/130']
    assert "' (': 1" in dev['BigCodeBench/327']
