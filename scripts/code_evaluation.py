"""Bounded local Python test execution for a caller-owned native evaluator.

Uses existing Linux namespaces, a disposable chroot and libseccomp. Never falls
back to executing candidate code on the host. Not a general security audit or
the official BigCodeBench evaluator. Pack identity records original tests and
any separately versioned development assertions.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import tempfile
import time


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def run_case(code, tests, output, timeout=6):
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    payload = {'code': code, 'test': tests}
    save(output / 'input.json', payload)
    started = time.monotonic()
    row = {'status': 'unavailable', 'taskPassed': False, 'passed': 0, 'planned': 0, 'tests': []}
    if not isinstance(code, str) or not isinstance(tests, str) or len(code.encode()) > 65536 or len(tests.encode()) > 65536:
        row['status'] = 'invalid_input'
        save(output / 'receipt.json', row)
        return row
    with tempfile.TemporaryDirectory(prefix='duo-code-root-') as root:
        command = ['/usr/bin/unshare', '--user', '--map-root-user', '--mount', '--net',
                   '--pid', '--fork', '--kill-child', '/usr/bin/python3', '-I', '-S',
                   str(Path(__file__).with_name('code_worker.py')), root]
        with (output / 'stdout.txt').open('wb') as stdout, (output / 'stderr.txt').open('wb') as stderr:
            try:
                process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=stdout, stderr=stderr,
                                           env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'}, start_new_session=True)
                try:
                    process.communicate(json.dumps(payload).encode(), timeout=timeout)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.communicate()
                    row['status'] = 'timeout'
                except BaseException:
                    if process.poll() is None:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.communicate()
                    raise
                if row['status'] != 'timeout':
                    if process.returncode in [-signal.SIGXCPU, -signal.SIGKILL, 128 + signal.SIGXCPU, 128 + signal.SIGKILL]:
                        row['status'] = 'timeout'
                    elif process.returncode == 0:
                        try:
                            value = json.loads((output / 'stdout.txt').read_text())
                            if value['codeSha256'] != hashlib.sha256(code.encode()).hexdigest() or value['testSha256'] != hashlib.sha256(tests.encode()).hexdigest():
                                raise ValueError('Input identity mismatch')
                            row = value
                        except (ValueError, KeyError):
                            row['status'] = 'invalid_receipt'
                    else:
                        row['status'] = 'execution_error'
                row['exitCode'] = process.returncode
            except OSError as error:
                row['error'] = str(error)
    if row['status'] == 'execution_error':
        # Keep startup/isolation failures distinct from measured candidate
        # failures, and surface enough context to diagnose a different host.
        # The complete stderr stays in its existing artifact; never load an
        # unbounded worker output into the receipt.
        with (output / 'stderr.txt').open('rb') as stderr:
            size = stderr.seek(0, os.SEEK_END)
            stderr.seek(max(0, size - 4096))
            row['executionError'] = {
                'stage': 'namespace_worker',
                'stderrTail': stderr.read(4096).decode('utf-8', errors='replace'),
                'stderrTruncated': size > 4096,
            }
    row.update({'wallTimeMs': round((time.monotonic() - started) * 1000, 3),
                'codeSha256': hashlib.sha256(code.encode()).hexdigest(),
                'testSha256': hashlib.sha256(tests.encode()).hexdigest(),
                'isolation': 'linux-user-mount-pid-net-chroot-seccomp-v1', 'modelRequests': 0,
                'receiptPath': str(output / 'receipt.json')})
    save(output / 'receipt.json', row)
    return row


def evaluate_batch(pack, tier, artifact, output):
    pack, output = Path(pack), Path(output)
    dataset_bytes = (pack / 'dataset.json').read_bytes()
    dataset = json.loads(dataset_bytes)
    key = json.loads((pack / 'answer-key.json').read_text())
    if key['datasetSha256'] != hashlib.sha256(dataset_bytes).hexdigest():
        raise ValueError('Dataset/key identity mismatch')
    actual_environment = {'platform': sys.platform, 'machine': platform.machine()}
    if key.get('executionRequirements') and key['executionRequirements'] != actual_environment:
        return {'ok': False, 'metrics': {}, 'currency': 'CNY', 'costCny': 0,
                'evidence': [{'kind': 'unsupported_evaluator_environment',
                              'required': key['executionRequirements'], 'actual': actual_environment}]}
    if artifact.get('status', 'completed') != 'completed' or artifact.get('tier', tier) != tier:
        return {'ok': False, 'metrics': {}, 'currency': 'CNY', 'costCny': 0,
                'evidence': [{'kind': 'invalid_execution_artifact', 'status': artifact.get('status'), 'tier': artifact.get('tier')}]}
    planned = dataset[tier]['tasks']
    try:
        answers = json.loads(artifact.get('text', ''))
    except (ValueError, TypeError):
        answers = None
    valid = isinstance(answers, dict) and set(answers) == {r['id'] for r in planned} and all(isinstance(v, str) for v in answers.values())
    rows = []
    for index, task in enumerate(planned):
        if valid:
            row = run_case(answers[task['id']], key['tasks'][task['id']]['test'], output / f'task-{index:03d}')
        else:
            row = {'status': 'invalid_answer_format', 'taskPassed': False, 'passed': 0, 'planned': 0, 'tests': [], 'wallTimeMs': 0}
        rows.append({'taskId': task['id'], **row})
    # Infrastructure/receipt failures are not measured task failure scores.
    measured = all(r['status'] in ['completed', 'syntax_error', 'runtime_error', 'timeout', 'invalid_answer_format'] for r in rows)
    result = {'ok': measured, 'metrics': {
        'task_pass_rate': sum(r['taskPassed'] for r in rows) / len(planned),
        'test_pass_rate': sum(r['passed'] / r['planned'] if r['planned'] else 0 for r in rows) / len(planned),
        'syntax_valid_rate': sum(r['status'] in ['completed', 'runtime_error', 'timeout'] for r in rows) / len(planned),
        'timeout_rate': sum(r['status'] == 'timeout' for r in rows) / len(planned),
        'format_valid': valid, 'sample_size': len(planned)},
        'currency': 'CNY', 'costCny': 0,
        'evidence': [{'kind': 'executed_python_unittest', 'version': key.get('evaluatorVersion', '3'), 'tier': tier,
                      **({'testSuiteVersion': key['version']} if 'evaluatorVersion' in key else {}),
                      'qualification': ('BOUNDED_PROPERTY_METAMORPHIC_CHECKS'
                                        if key.get('measurementKind') == 'bounded-properties-v1' and tier in key.get('propertyTiers', []) else
                                        'CUSTOM_RUNNER_PARTIAL_DEVELOPMENT_CONTRACT_REPAIR'
                                        if key.get('measurementKind') == 'bounded-properties-v1' or key.get('evaluatorVersion') in ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24'] else
                                        'CUSTOM_RUNNER_ORIGINAL_BENCHMARK_TESTS'), 'rows': rows}],
        'costEvidence': {'currency': 'CNY', 'knownCostCny': 0, 'unknownCost': False, 'modelRequests': 0,
                         'localWallTimeMs': sum(r['wallTimeMs'] for r in rows),
                         'localComputePricing': 'NOT_PRICED; zero is provider API expense only'}}
    output.mkdir(parents=True, exist_ok=True)
    save(output / 'evaluation.json', result)
    return result


if __name__ == '__main__':
    def stop(signum, frame):
        raise KeyboardInterrupt('Evaluation cancelled; drain namespace child')
    signal.signal(signal.SIGTERM, stop)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pack', type=Path, required=True)
    parser.add_argument('--tier', choices=['fast', 'slow', 'final'], required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(evaluate_batch(args.pack, args.tier, json.load(sys.stdin), args.output)))
    except Exception as error:
        print(json.dumps({'ok': False, 'metrics': {}, 'currency': 'CNY', 'costCny': 0,
                          'evidence': [{'kind': 'local_evaluator_error', 'error': str(error)}]}))
        raise SystemExit(1)
