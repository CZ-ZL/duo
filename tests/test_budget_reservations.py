"""Offline reservation/receipt protocol; real local filesystem and processes."""
import inspect
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import pytest

from dualloop.runtime.budget import BudgetExhausted, SessionBudget


def ledger(path, cap=20, limit=1):
    assert 'max_cost_usd' in inspect.signature(SessionBudget).parameters, 'ledger must accept a monetary cap'
    assert callable(getattr(SessionBudget, 'reserve', None)), 'durable reservation API is missing'
    return SessionBudget(path, cap=cap, max_cost_usd=limit)


def test_reservation_is_durable_before_work_and_holds_money(tmp_path):
    budget = ledger(tmp_path / 'budget.json')
    budget.reserve('first', 0.6, phase='generation', metadata={'request': 'one'})
    other = ledger(budget.path)
    state = other.snapshot()
    assert state['cost_usd'] is None
    assert state['known_cost_usd'] == 0
    assert state['reserved_cost_usd'] == 0.6
    assert state['operations']['first']['status'] == 'reserved'
    with pytest.raises(BudgetExhausted, match='amount'):
        other.reserve('second', 0.5, phase='evaluation')
    assert other.sessions_used == 1


def test_duplicate_operation_cannot_authorize_another_execution(tmp_path):
    budget = ledger(tmp_path / 'budget.json')
    budget.reserve('same', 0.2, phase='generation')
    with pytest.raises(BudgetExhausted, match='already'):
        ledger(budget.path).reserve('same', 0.2, phase='generation')
    assert budget.sessions_used == 1


def test_limits_cannot_be_changed_when_reopening(tmp_path):
    budget = ledger(tmp_path / 'budget.json')
    with pytest.raises(ValueError, match='limit'):
        ledger(budget.path, limit=2)
    with pytest.raises(ValueError, match='limit'):
        ledger(budget.path, cap=21)
    assert ledger(budget.path).snapshot()['max_cost_usd'] == 1


@pytest.mark.parametrize('amount', [None, True, -1, float('nan'), float('inf')])
def test_invalid_reservation_never_uses_a_session(tmp_path, amount):
    budget = ledger(tmp_path / 'budget.json')
    with pytest.raises(ValueError):
        budget.reserve('invalid', amount, phase='evaluation')
    assert budget.sessions_used == 0


def test_legacy_calls_cannot_bypass_a_monetary_ledger(tmp_path):
    budget = ledger(tmp_path / 'budget.json')
    with pytest.raises(BudgetExhausted, match='reservation'):
        budget.acquire()
    with pytest.raises(BudgetExhausted, match='reservation'):
        budget.charge(0)
    assert budget.sessions_used == 0


def test_nonempty_legacy_ledger_is_not_silently_migrated(tmp_path):
    path = tmp_path / 'budget.json'
    original = json.dumps({'sessions_used': 1, 'cost_usd': 0.04, 'cap': 20})
    path.write_text(original)
    with pytest.raises(ValueError, match='legacy'):
        ledger(path)
    assert path.read_text() == original


def test_process_contention_has_one_shared_admission_limit(tmp_path):
    budget = ledger(tmp_path / 'budget.json')
    script = '''
import json,sys,time
from pathlib import Path
from dualloop.runtime.budget import SessionBudget,BudgetExhausted
path,slot,root=sys.argv[1:]
b=SessionBudget(path,cap=20,max_cost_usd=1)
try:
 b.reserve(slot,0.25,phase='evaluation')
 result='admitted'
except BudgetExhausted:
 result='refused'
Path(root,slot+'.json').write_text(json.dumps(result))
while not Path(root,'release').exists(): time.sleep(0.01)
'''
    children = [subprocess.Popen([sys.executable, '-c', script, str(budget.path), str(i), str(tmp_path)],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for i in range(8)]
    try:
        deadline = time.monotonic() + 10
        while not all((tmp_path / f'{i}.json').exists() for i in range(8)):
            assert time.monotonic() < deadline, 'workers did not reach the admission barrier'
            time.sleep(0.01)
        outcomes = [json.loads((tmp_path / f'{i}.json').read_text()) for i in range(8)]
        assert outcomes.count('admitted') == 4
        state = budget.snapshot()
        assert state['sessions_used'] == 4
        assert state['reserved_cost_usd'] == 1
    finally:
        (tmp_path / 'release').touch()
        for child in children:
            stdout, stderr = child.communicate(timeout=5)
            assert child.returncode == 0, (stdout, stderr)


def test_crashed_owner_keeps_reservation_and_blocks_admission(tmp_path):
    budget = ledger(tmp_path / 'budget.json')
    script = '''
import os,sys
from dualloop.runtime.budget import SessionBudget
b=SessionBudget(sys.argv[1],cap=20,max_cost_usd=1)
b.reserve('crashed',0.2,phase='generation')
os._exit(23)
'''
    result = subprocess.run([sys.executable, '-c', script, str(budget.path)], capture_output=True, text=True)
    assert result.returncode == 23
    restored = ledger(budget.path)
    assert restored.snapshot()['reserved_cost_usd'] == 0.2
    assert restored.cost_usd is None
    with pytest.raises(BudgetExhausted, match='unresolved'):
        restored.reserve('new', 0.1, phase='evaluation')
    assert restored.sessions_used == 1


def test_known_settlement_releases_only_unused_reservation(tmp_path):
    budget = ledger(tmp_path / 'budget.json')
    budget.reserve('one', 0.7, phase='generation')
    assert callable(getattr(budget, 'settle', None)), 'receipt settlement is missing'
    receipt = budget.settle('one', 0.2, receipt_id='usage-one')
    budget.reconcile(receipt)  # acknowledged twice, billed once
    budget.reserve('two', 0.8, phase='evaluation')
    state = budget.snapshot()
    assert state['known_cost_usd'] == 0.2
    assert state['reserved_cost_usd'] == 0.8
    assert state['phases']['generation']['cost_usd'] == 0.2
    assert state['phases']['selection']['cost_usd'] == 0
    assert state['phases']['evaluation']['cost_usd'] is None


def test_receipts_reconcile_only_their_own_unknown_operation(tmp_path):
    budget = ledger(tmp_path / 'budget.json')
    budget.reserve('lost', 0.4, phase='generation')
    budget.reserve('other', 0.3, phase='evaluation')
    assert callable(getattr(budget, 'settle', None)), 'receipt settlement is missing'
    budget.settle('lost', None, receipt_id='missing-usage')
    budget.settle('other', 0.2, receipt_id='other-usage')
    assert budget.cost_usd is None
    assert budget.known_cost_usd == 0.2
    with pytest.raises(BudgetExhausted, match='unknown'):
        budget.reserve('new', 0.1, phase='evaluation')
    receipt = budget.stage_receipt('lost', 0.1, receipt_id='recovered-usage')
    ledger(budget.path).reconcile(receipt)
    state = budget.snapshot()
    assert state['cost_usd'] == 0.3
    assert state['reserved_cost_usd'] == 0
    assert len(state['operations']['lost']['receipts']) == 2
    budget.reserve('new', 0.7, phase='evaluation')


def test_overrun_records_full_cost_and_blocks_further_admission(tmp_path):
    budget = ledger(tmp_path / 'budget.json')
    budget.reserve('one', 0.2, phase='evaluation')
    assert callable(getattr(budget, 'settle', None)), 'receipt settlement is missing'
    with pytest.raises(BudgetExhausted, match='overrun'):
        budget.settle('one', 0.3, receipt_id='actual')
    assert ledger(budget.path).cost_usd == 0.3
    with pytest.raises(BudgetExhausted, match='overrun'):
        budget.reserve('two', 0.1, phase='generation')


def test_conflicting_or_reused_receipts_cannot_rewrite_cost(tmp_path):
    budget = ledger(tmp_path / 'budget.json')
    budget.reserve('one', 0.2, phase='evaluation')
    budget.reserve('two', 0.2, phase='generation')
    assert callable(getattr(budget, 'settle', None)), 'receipt settlement is missing'
    budget.settle('one', 0.1, receipt_id='same')
    with pytest.raises(ValueError, match='receipt|settled'):
        budget.settle('one', 0.05, receipt_id='changed')
    with pytest.raises(ValueError, match='receipt'):
        budget.settle('two', 0.1, receipt_id='same')
    assert budget.known_cost_usd == 0.1


def test_tampered_receipt_and_other_ledger_cannot_reconcile(tmp_path):
    budget = ledger(tmp_path / 'budget.json')
    budget.reserve('one', 0.2, phase='evaluation')
    assert callable(getattr(budget, 'stage_receipt', None)), 'durable receipt staging is missing'
    receipt = Path(budget.stage_receipt('one', 0.1, receipt_id='actual'))
    other = ledger(tmp_path / 'other.json')
    other.reserve('one', 0.2, phase='evaluation')
    with pytest.raises(ValueError, match='ledger'):
        other.reconcile(receipt)
    receipt.write_text(receipt.read_text().replace('100000000', '50000000'))
    with pytest.raises(ValueError, match='hash'):
        budget.reconcile(receipt)
    assert budget.cost_usd is None


def test_crash_after_receipt_before_settlement_recovers_without_execution(tmp_path):
    budget = ledger(tmp_path / 'budget.json')
    assert callable(getattr(budget, 'stage_receipt', None)), 'durable receipt staging is missing'
    script = '''
import os,sys
from pathlib import Path
from dualloop.runtime.budget import SessionBudget
b=SessionBudget(sys.argv[1],cap=20,max_cost_usd=1)
b.reserve('crashed',0.4,phase='generation')
p=b.stage_receipt('crashed',0.1,receipt_id='completed-request')
Path(sys.argv[2]).write_text(str(p))
os._exit(24)
'''
    ref = tmp_path / 'receipt-path'
    result = subprocess.run([sys.executable, '-c', script, str(budget.path), str(ref)], capture_output=True, text=True)
    assert result.returncode == 24
    restored = ledger(budget.path)
    with pytest.raises(BudgetExhausted, match='unresolved'):
        restored.reserve('other', 0.1, phase='evaluation')
    restored.reconcile(ref.read_text())
    restored.reconcile(ref.read_text())
    assert restored.cost_usd == 0.1
    assert restored.sessions_used == 1
    with pytest.raises(BudgetExhausted, match='already'):
        restored.reserve('crashed', 0.4, phase='generation')
    restored.reserve('other', 0.9, phase='evaluation')


def test_invalid_ledger_operation_cannot_create_negative_exposure(tmp_path):
    budget = ledger(tmp_path / 'budget.json')
    budget.reserve('one', 0.4, phase='generation')
    payload = json.loads(budget.path.read_text())
    payload['operations']['one']['reserved_units'] = -1
    budget.path.write_text(json.dumps(payload))
    with pytest.raises(ValueError, match='invalid'):
        ledger(budget.path).reserve('two', 1.1, phase='evaluation')


@pytest.mark.parametrize('version', [3, None])
def test_monetary_ledger_cannot_fall_back_to_legacy_api(tmp_path, version):
    budget = ledger(tmp_path / 'budget.json')
    budget.reserve('one', 0.2, phase='evaluation')
    budget.settle('one', 0.1, receipt_id='usage')
    state = json.loads(budget.path.read_text())
    if version is None:
        state.pop('version')
    else:
        state['version'] = version
    budget.path.write_text(json.dumps(state))
    original = budget.path.read_bytes()
    with pytest.raises(ValueError, match='version|schema'):
        SessionBudget(budget.path).acquire()
    assert budget.path.read_bytes() == original


@pytest.mark.parametrize('metadata', [[], ['bad'], 'text', 1])
def test_invalid_metadata_never_creates_an_unreadable_reservation(tmp_path, metadata):
    budget = ledger(tmp_path / 'budget.json')
    with pytest.raises(ValueError, match='metadata'):
        budget.reserve('bad', 0.1, phase='evaluation', metadata=metadata)
    assert budget.sessions_used == 0


def test_file_aliases_cannot_fork_the_same_budget(tmp_path):
    budget = ledger(tmp_path / 'budget.json')
    budget.reserve('first', 0.7, phase='generation')
    alias = tmp_path / 'alias.json'
    alias.symlink_to(budget.path)
    ledger(alias).reserve('second', 0.3, phase='evaluation')
    with pytest.raises(BudgetExhausted, match='amount'):
        budget.reserve('third', 0.3, phase='evaluation')
    assert alias.is_symlink()
    assert budget.snapshot()['reserved_cost_usd'] == 1


def test_hardlinked_ledger_is_rejected_before_atomic_replace(tmp_path):
    budget = ledger(tmp_path / 'budget.json')
    alias = tmp_path / 'alias.json'
    os.link(budget.path, alias)
    with pytest.raises(ValueError, match='hardlink'):
        budget.reserve('first', 0.1, phase='evaluation')
    assert budget.path.stat().st_ino == alias.stat().st_ino


def test_explicit_legacy_cap_cannot_be_silently_ignored(tmp_path):
    path = tmp_path / 'legacy.json'
    path.write_text(json.dumps({'cap': 3, 'sessions_used': 1, 'cost_usd': 0.1}))
    original = path.read_bytes()
    with pytest.raises(ValueError, match='limit'):
        SessionBudget(path, cap=1).acquire()
    assert path.read_bytes() == original


@pytest.mark.parametrize('after_replace', [False, True])
def test_process_crash_during_reservation_never_grants_unrecorded_work(tmp_path, after_replace):
    budget = ledger(tmp_path / 'budget.json')
    script = '''
import os,sys
from pathlib import Path
from dualloop.runtime.budget import SessionBudget
b=SessionBudget(sys.argv[1],cap=20,max_cost_usd=1)
replace=os.replace
def crash(source,target):
 if sys.argv[3]=='True': replace(source,target)
 os._exit(31)
os.replace=crash
b.reserve('crash-window',0.2,phase='generation')
Path(sys.argv[2]).write_text('work started')
'''
    started = tmp_path / 'started'
    result = subprocess.run([sys.executable, '-c', script, str(budget.path), str(started), str(after_replace)],
                            capture_output=True, text=True)
    assert result.returncode == 31, result.stderr
    assert not started.exists()
    restored = ledger(budget.path)
    if after_replace:
        assert restored.cost_usd is None
        assert restored.snapshot()['reserved_cost_usd'] == 0.2
        with pytest.raises(BudgetExhausted, match='unresolved'):
            restored.reserve('new', 0.1, phase='evaluation')
    else:
        assert restored.sessions_used == 0
        assert restored.cost_usd == 0
        restored.reserve('crash-window', 0.2, phase='generation')


def test_invalid_ledger_is_rejected_even_with_python_optimization(tmp_path):
    budget = ledger(tmp_path / 'budget.json')
    budget.reserve('one', 0.1, phase='evaluation')
    state = json.loads(budget.path.read_text())
    state['operations']['one']['reserved_units'] = -1
    budget.path.write_text(json.dumps(state))
    script = '''
import sys
from dualloop.runtime.budget import SessionBudget
try: SessionBudget(sys.argv[1])
except ValueError: sys.exit(0)
sys.exit(3)
'''
    result = subprocess.run([sys.executable, '-O', '-c', script, str(budget.path)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
