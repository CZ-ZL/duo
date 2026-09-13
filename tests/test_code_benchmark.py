"""Behavioral tests for the executable evaluator; no model or paid calls."""
import importlib.util
import hashlib
import json
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('code_evaluation', ROOT / 'scripts/code_evaluation.py')
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)

TESTS = '''import unittest
class TestCases(unittest.TestCase):
    def test_positive(self): self.assertEqual(task_func(3), 3)
    def test_negative(self): self.assertEqual(task_func(-3), 3)
    def test_zero(self): self.assertEqual(task_func(0), 0)
'''


@pytest.mark.parametrize('code,passed', [
    ('def task_func(x): return abs(x)', 3),
    ('def task_func(x): return x', 2),
    ('def task_func(x): return 99', 0),
    ('def task_func(x): raise ValueError("broken")', 0),
])
def test_real_execution_distinguishes_quality(tmp_path, code, passed):
    row = evaluation.run_case(code, TESTS, tmp_path / 'case')
    assert row['status'] == 'completed', row
    assert row['passed'] == passed
    assert row['planned'] == 3
    assert row['taskPassed'] is (passed == 3)
    assert len(row['tests']) == 3


def test_syntax_error_and_timeout_are_failures(tmp_path):
    row = evaluation.run_case('def broken(:', TESTS, tmp_path / 'syntax')
    assert row['status'] == 'syntax_error', row
    assert not row['taskPassed']
    row = evaluation.run_case('while True: pass', TESTS, tmp_path / 'loop', timeout=2)
    assert row['status'] == 'timeout', row
    assert not row['taskPassed']


def test_candidate_cannot_access_host_files_network_processes_or_environment(tmp_path, monkeypatch):
    canary = tmp_path / 'host-only.txt'
    canary.write_text('nonsecret control marker')
    monkeypatch.setenv('DUO_TEST_ENV_CANARY', 'nonsecret control marker')
    code = f'''import os, socket
def task_func(x):
    assert not os.path.exists({str(canary)!r})
    assert os.getenv('DUO_TEST_ENV_CANARY') is None
    for operation in [lambda: socket.socket(), lambda: os.fork(), lambda: open('/usr/duo-write-control', 'w')]:
        try: operation()
        except OSError: pass
        else: raise AssertionError('isolation failure')
    return abs(x)
'''
    row = evaluation.run_case(code, TESTS, tmp_path / 'isolation')
    assert row['status'] == 'completed' and row['taskPassed'], row
    assert canary.read_text() == 'nonsecret control marker'


def test_empty_test_suite_is_not_a_pass(tmp_path):
    row = evaluation.run_case('def task_func(x): return x', 'import unittest', tmp_path / 'empty')
    assert not row['taskPassed']


def test_worker_start_failure_retains_bounded_diagnostic_without_scoring(tmp_path, monkeypatch):
    class FailedNamespace:
        returncode = 1

        def __init__(self, command, **kwargs):
            kwargs['stderr'].write(b'x' * 10000 + b'\nunshare: Operation not permitted\n')

        def communicate(self, *args, **kwargs):
            return None, None

    monkeypatch.setattr(evaluation.subprocess, 'Popen', FailedNamespace)
    row = evaluation.run_case('def task_func(x): return abs(x)', TESTS, tmp_path / 'denied')
    assert row['status'] == 'execution_error' and not row['taskPassed']
    assert row['executionError']['stderrTail'].endswith('unshare: Operation not permitted\n')
    assert len(row['executionError']['stderrTail'].encode()) <= 4096
    assert row['executionError']['stderrTruncated'] is True
    assert (tmp_path / 'denied/stderr.txt').stat().st_size > 10000


def test_large_wrong_dictionary_is_a_measured_failure_not_a_diff_timeout(tmp_path):
    tests = '''import unittest
class TestCases(unittest.TestCase):
    def test_small(self): self.assertEqual(task_func(3), {i: 1 for i in range(3)})
    def test_large(self): self.assertEqual(task_func(1000), {i: 2 for i in range(1000)})
'''
    row = evaluation.run_case('def task_func(n): return {i: 1 for i in range(n)}', tests, tmp_path / 'large-diff')
    assert row['status'] == 'completed', row
    assert row['passed'] == 1 and row['planned'] == 2


def test_original_tests_can_patch_their_current_module(tmp_path):
    code = 'def helper(x): return x\ndef task_func(x): return helper(x)'
    tests = '''import unittest
from unittest.mock import patch
class TestCases(unittest.TestCase):
    @patch(__name__ + '.helper', return_value=9)
    def test_patch(self, helper): self.assertEqual(task_func(3), 9)
'''
    row = evaluation.run_case(code, tests, tmp_path / 'module-patch')
    assert row['taskPassed'], row


@pytest.mark.parametrize('artifact', [
    {'text': '{"t": "def task_func(x): return abs(x)"}', 'status': 'failed'},
    {'text': '{"t": "def task_func(x): return abs(x)"}', 'tier': 'final'},
])
def test_failed_or_wrong_tier_artifact_cannot_be_scored(tmp_path, artifact):
    pack = tmp_path / 'pack'
    pack.mkdir()
    evaluation.save(pack / 'dataset.json', {'fast': {'tasks': [{'id': 't', 'input': 'abs'}]}})
    evaluation.save(pack / 'answer-key.json', {'datasetSha256': hashlib.sha256((pack / 'dataset.json').read_bytes()).hexdigest(), 'tasks': {'t': {'test': TESTS}}})
    result = evaluation.evaluate_batch(pack, 'fast', artifact, tmp_path / 'unused-output')
    assert not result['ok'] and result['metrics'] == {}
    assert not (tmp_path / 'unused-output').exists()
