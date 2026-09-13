"""Actual cached DSH runtime with bounded scripted transport; zero real calls."""
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize('invalid', [False, True])
def test_terminal_warm_run_preserves_consumption_accounting_and_strict_acceptance(tmp_path, invalid):
    dsh = os.environ.get('DUO_DSH_PACKAGE')
    if not dsh:
        pytest.skip('Requires explicitly selected existing cached DSH package')
    output = tmp_path / 'host'
    cmd = [sys.executable, str(ROOT / 'scripts/run_maturation_calling.py'), '--mode', 'offline',
           '--output', str(output), '--dsh-package', dsh]
    if invalid:
        cmd.append('--fixture-invalid-warm-proposal')
    process = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=100)
    result = json.loads((output / 'result.json').read_text())
    assert process.returncode == (1 if invalid else 0), process.stdout + process.stderr
    assert result['modelRequests'] == result['costCny'] == 0
    calls = json.loads((output / 'tool-calls.json').read_text())
    before = next(c['result']['value'] for c in calls if c['name'] == 'dualloop_describe')
    assert before['runtimeAvailability']['services'] == {
        'duoGenerator': 'PRESENT', 'duoExecutor': 'PRESENT',
        'duoEvaluators': 'ABSENT', 'duoController': 'ABSENT'}
    assert any(c['name'] == 'cordis_inspect_query' and c['arguments'].get('input') == {'service': 'answerSchemaMeasurement'}
               and c['result'].get('isError') for c in calls)
    assert result['checks']['warmStartConsumed'] is True
    assert result['checks']['innerAccounting'] is True
    assert result['checks']['totalAccounting'] is True
    assert result['checks']['twoReports'] is True
    assert result['checks']['interpretationValid'] is True
    assert result['checks']['twoCompletedNativeRuns'] is (not invalid)
    assert result['status'] == ('failed' if invalid else 'completed')
    assert result['independentRealCallerVerified'] is False
    assert result['improvementProven'] is False
    assert len(result['attemptedInnerRunIds']) == 2
    assert len(result['innerRunIds']) == (1 if invalid else 2)
    if invalid:
        failed = result['candidateReports'][1]
        assert failed['status'] == 'failed'
        assert failed['stopReason'] == 'DUO_CANDIDATES_INVALID'
        failed_run = [c['result']['value'] for c in calls if c['name'] == 'dualloop_run'][-1]
        assert 'missing persona' in failed_run['error']['message']
        assert failed_run['final'] == []
        assert result['syntheticRequests'] == 24  # 15 Caller + 6 first (duplicate skipped) + 3 failed warm
        assert result['failure']['facts']['failedChecks'] == ['twoCompletedNativeRuns']
    else:
        assert all(result['checks'].values())
