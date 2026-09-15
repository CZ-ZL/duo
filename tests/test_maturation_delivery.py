"""A retained Caller can finish reporting without rerunning native work."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'runs/native-maturation-v2-20260909/d4-readiness-live-prepared'


@pytest.mark.parametrize('missing_usage', [False, True])
def test_retained_caller_delivery_is_read_only_and_preserves_evidence(tmp_path, missing_usage):
    dsh = os.environ.get('DUO_DSH_PACKAGE')
    if not dsh or not SOURCE.exists():
        pytest.skip('Requires selected cached DSH and retained real acceptance evidence')
    before = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in SOURCE.rglob('*')
              if p.is_file() and ('journal' in p.parts or p.name in ['result.json', 'requests.json', 'session-events.json'])}
    out = tmp_path / 'delivery'
    cmd = [sys.executable, str(ROOT / 'scripts/research/run_maturation_delivery.py'), '--mode', 'offline',
           '--source', str(SOURCE), '--output', str(out), '--dsh-package', dsh]
    if missing_usage:
        cmd.append('--fixture-missing-usage')
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=60)
    assert p.returncode == (1 if missing_usage else 0), p.stdout + p.stderr
    result = json.loads((out / 'result.json').read_text())
    assert result['modelRequests'] == result['costCny'] == 0
    assert result['independentRealCallerVerified'] is False
    assert result['checks']['seedPreserved'] is True
    assert result['innerRequests'] == 0
    assert result['checks']['sourceUnchanged'] is True
    assert result['sourceStatus'] == 'failed'
    assert result['status'] == ('failed' if missing_usage else 'completed')
    if missing_usage:
        assert result['syntheticRequests'] == 1
        assert result['budget']['blockedReason'] == 'DUO_COST_UNKNOWN'
        assert result['checks']['interpretationValid'] is False
    else:
        assert result['syntheticRequests'] == 2
        assert all(result['checks'].values())
        assert len(result['reportRunIds']) == 2
        assert len(result['toolCalls']) == 2  # one denied new-run control, one actual report read
        assert result['toolCalls'][0]['result']['isError'] is True
        assert result['toolCalls'][1]['name'] == 'dualloop_report'
    assert all(hashlib.sha256(Path(p).read_bytes()).hexdigest() == h for p, h in before.items())


def test_delivery_rejects_live_without_bound_authorization_before_key_access(tmp_path):
    p = subprocess.run([sys.executable, str(ROOT / 'scripts/research/run_maturation_delivery.py'),
                        '--mode', 'execute', '--output', str(tmp_path)], capture_output=True, text=True)
    assert p.returncode == 2
    assert 'Explicit report-delivery authorization required' in p.stderr
    assert not (tmp_path / 'execution-claim.json').exists()


@pytest.mark.parametrize('case', ['valid', 'blank', 'reset_consumption', 'extra_total', 'extra_money', 'wrong_transfer'])
def test_delivery_transfer_requires_explicit_unchanged_caps(case):
    sys.path.insert(0, str(ROOT / 'scripts/research'))
    from dsh_model_profile import seal_manifest
    from run_maturation_delivery import validate_authorization
    carry = {'batch': 'test-only', 'priorRequests': 81, 'priorCostCny': .481069129,
             'batchMaxRequests': 87, 'batchMaxCostCny': 4, 'priorCallerRequests': 57,
             'priorInnerRequests': 24, 'callerRemaining': 0, 'innerRemaining': 6, 'maxCostCny': 3.518930871}
    before = {'maxModelRequests': 87, 'maxCostCny': 4, 'callerRequestCap': 57, 'innerRequestCap': 30}
    after = {**before, 'callerRequestCap': 61, 'innerRequestCap': 26}
    prepared = seal_manifest({'batchCarry': carry, 'planDigest': 'fixture', 'maxModelRequests': 4,
                             'maxCostCny': 1, 'before': before, 'after': after})
    auth = {'scope': 'native-maturation-report-delivery', 'currency': 'CNY', 'batch': carry['batch'],
            'approvedBy': 'user', 'authorizationText': 'Unit fixture only; never an execution receipt',
            **{k: prepared[k] for k in ['planDigest', 'manifestDigest', 'maxModelRequests', 'maxCostCny', 'before', 'after']}}
    auth = json.loads(json.dumps(auth))
    if case == 'blank': auth['approvedBy'] = ''
    if case == 'reset_consumption': carry = {**carry, 'priorRequests': 0}
    if case == 'extra_total': auth['after']['maxModelRequests'] = 91
    if case == 'extra_money': auth['after']['maxCostCny'] = 5
    if case == 'wrong_transfer': auth['after']['innerRequestCap'] = 30
    if case == 'valid':
        validate_authorization(auth, prepared, carry)
    else:
        with pytest.raises(ValueError, match='unchanged consumption'):
            validate_authorization(auth, prepared, carry)
