"""Seed example repair is versioned, public, and independent of model scores."""
import ast
import doctest
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
TASK = 'BigCodeBench/862'


@pytest.fixture(scope='module')
def pack(tmp_path_factory):
    out = tmp_path_factory.mktemp('seed-contract') / 'pack'
    prepare(SOURCE, out, prompt_format='complete', test_suite='dev-contract-v3')
    return out


def test_seed_version_retains_prior_contracts_all_public_inputs_and_final(pack):
    old = json.loads((GOAL / 'benchmark-v5-dev-contract2/answer-key.json').read_text())
    new = json.loads((pack / 'answer-key.json').read_text())
    manifest = json.loads((pack / 'manifest.json').read_text())
    assert new['evaluatorVersion'] == '6' and new['version'] == 'bigcodebench-unittest-dev-contract-v3'
    for task_id, row in old['tasks'].items():
        if task_id == TASK:
            assert new['tasks'][task_id]['test'].startswith(row['test'] + '\n')
            assert {k: v for k, v in new['tasks'][task_id].items() if k != 'test'} == {k: v for k, v in row.items() if k != 'test'}
        else:
            assert new['tasks'][task_id] == row
    assert manifest['testAdditions'][TASK]['publicPromptSha256']
    assert manifest['contractDecisions']['BigCodeBench/130'] == 'SHA256(data + salt) per owner choice of the public specification'
    data = json.loads((pack / 'dataset.json').read_text())
    previous = json.loads((GOAL / 'benchmark-v5-dev-contract2/dataset.json').read_text())
    for tier in ['fast', 'slow', 'final']:
        assert data[tier]['tasks'] == previous[tier]['tasks']
        assert data[tier]['id'] == 'bigcodebench-stdlib-v6-dev-contract3-' + tier


def test_production_accepts_references_alternative_and_rejects_three_known_errors(pack, tmp_path):
    key = json.loads((pack / 'answer-key.json').read_text())
    data = json.loads((pack / 'dataset.json').read_text())
    answers = {t['id']: key['tasks'][t['id']]['code_prompt'] + key['tasks'][t['id']]['canonical_solution'] for t in data['slow']['tasks']}
    correct = evaluate_batch(pack, 'slow', {'text': json.dumps(answers)}, tmp_path / 'references')
    assert correct['ok'] and correct['metrics']['task_pass_rate'] == 1
    assert correct['evidence'][0]['version'] == '6'
    assert correct['evidence'][0]['qualification'] == 'CUSTOM_RUNNER_PARTIAL_DEVELOPMENT_CONTRACT_REPAIR'
    # Reuse the independently frozen diagnostic inputs, not model answers.
    for name in ['alternative-local-rng-counter', 'wrong-all-a', 'wrong-fixed-seed', 'wrong-value-mismatch']:
        source = json.loads((GOAL / '862-controls' / (name + '-original/input.json')).read_text())['code']
        row = run_case(source, key['tasks'][TASK]['test'], tmp_path / name)
        assert row['status'] == 'completed'
        assert row['taskPassed'] == name.startswith('alternative')
        if name.startswith('wrong'):
            assert any(t['status'] == 'failed' and 'public_seed' in t['name'] for t in row['tests'])
    answers[TASK] = json.loads((GOAL / '862-controls/wrong-all-a-original/input.json').read_text())['code']
    wrong = evaluate_batch(pack, 'slow', {'text': json.dumps(answers)}, tmp_path / 'wrong-batch')
    assert wrong['ok'] and wrong['metrics']['task_pass_rate'] == 11 / 12


def test_added_example_assertions_equal_the_literal_public_doctests(pack):
    """Prevent a repeat of the diagnostic's handwritten m-count typo."""
    row = json.loads((pack / 'answer-key.json').read_text())['tasks'][TASK]
    function = next(n for n in ast.parse(row['complete_prompt']).body if isinstance(n, ast.FunctionDef))
    examples = doctest.DocTestParser().get_examples(ast.get_docstring(function))
    wanted = [ast.literal_eval(e.want[e.want.index('{'):e.want.rindex('}') + 1]) for e in examples]
    # Execute only the added trusted assertions with the literal public oracle.
    import unittest
    seen = []
    def public_example(n, seed=None):
        seen.append((n, seed))
        return wanted[{(5, 123): 0, (30, 1): 1}[(n, seed)]]
    old = json.loads((GOAL / 'benchmark-v5-dev-contract2/answer-key.json').read_text())['tasks'][TASK]
    scope = {'TestCases': unittest.TestCase, 'task_func': public_example}
    exec(row['test'][len(old['test']):], scope)
    result = unittest.TestResult()
    unittest.defaultTestLoader.loadTestsFromTestCase(scope['TestCases']).run(result)
    assert result.wasSuccessful() and result.testsRun == 2
    assert set(seen) == {(5, 123), (30, 1)}


def test_previous_v5_pack_byte_identity_and_seed_prompt_drift_guard(tmp_path):
    out = tmp_path / 'v5'
    prepare(SOURCE, out, prompt_format='complete', test_suite='dev-contract-v2')
    for name in ['dataset.json', 'answer-key.json', 'control-task.json', 'manifest.json']:
        assert (out / name).read_bytes() == (GOAL / 'benchmark-v5-dev-contract2' / name).read_bytes()
    rows = list(map(json.loads, SOURCE.read_text().splitlines()))
    next(r for r in rows if r['task_id'] == TASK)['complete_prompt'] += '\n# changed public examples\n'
    source = tmp_path / 'changed.jsonl'
    source.write_text(''.join(json.dumps(r) + '\n' for r in rows))
    with pytest.raises(ValueError, match='public prompt identity'):
        prepare(source, tmp_path / 'bad', prompt_format='complete', test_suite='dev-contract-v3')
    assert not (tmp_path / 'bad').exists()
