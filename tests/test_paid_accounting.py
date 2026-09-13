"""Monetary ledger integration with real adapters and offline process substitutes."""
import inspect
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace

import pytest

from dualloop.runtime.budget import BudgetExhausted, SessionBudget
from dualloop.runtime import session_trace
from dualloop.plugins import llm_generator, dsh_executor
from dualloop.controller import build_controller
from test_controller import config


GOOD = {'usage_complete': True, 'tokens': {'input': 100, 'output': 20}}


def paid_budget(tmp_path, limit=1):
    return SessionBudget(tmp_path / 'budget.json', cap=20, max_cost_usd=limit)


@pytest.mark.parametrize('caller', ['proposer', 'executor'])
@pytest.mark.parametrize('outcome', [0, 1, 'timeout', 'spawn_error'])
def test_adapters_reserve_before_spawn_and_settle_each_known_outcome(tmp_path, monkeypatch, caller, outcome):
    budget = paid_budget(tmp_path)
    klass = llm_generator.ProposerRunner if caller == 'proposer' else dsh_executor.DshDocsQaExecutor
    assert 'reservation_usd' in inspect.signature(klass).parameters, 'adapter needs an explicit reservation bound'
    calls = []
    def run(*a, **k):
        snapshot = budget.snapshot()
        assert snapshot['reserved_cost_usd'] == 0.1
        assert snapshot['sessions_used'] == 1
        calls.append(1)
        if outcome == 'timeout':
            raise subprocess.TimeoutExpired('fake', 1)
        if outcome == 'spawn_error':
            raise OSError('fake spawn failure')
        return SimpleNamespace(returncode=outcome, stdout='answer', stderr='fake failure')
    monkeypatch.setattr(llm_generator.subprocess, 'run', run)
    monkeypatch.setattr(session_trace, 'new_session_dir', lambda *a: tmp_path)
    monkeypatch.setattr(session_trace, 'parse_session', lambda *a: GOOD)
    if caller == 'proposer':
        runner = klass(sandbox=tmp_path / 'sandbox', budget=budget, reservation_usd=0.1)
        invoke = lambda: runner.run('prompt', operation_id='test-op')
    else:
        runner = klass(corpus_dir=tmp_path, budget=budget, reservation_usd=0.1)
        sandbox = tmp_path / 'sandbox'
        sandbox.mkdir()
        monkeypatch.setattr(runner, '_fresh_sandbox', lambda label: sandbox)
        monkeypatch.setattr(runner, '_grab_trace', lambda *a: GOOD)
        invoke = lambda: runner.run_question('question', operation_id='test-op')
    if outcome == 'spawn_error' or caller == 'proposer' and outcome != 0:
        with pytest.raises((RuntimeError, OSError)):
            invoke()
    else:
        invoke()
    snapshot = budget.snapshot()
    assert snapshot['cost_usd'] == pytest.approx(0.000049)
    assert snapshot['reserved_cost_usd'] == 0
    assert snapshot['operations']['test-op']['status'] == 'settled'
    with pytest.raises(BudgetExhausted, match='already'):
        invoke()
    assert calls == [1]


def test_unknown_adapter_cost_retains_reservation_and_refuses_retry(tmp_path, monkeypatch):
    assert 'reservation_usd' in inspect.signature(llm_generator.ProposerRunner).parameters
    budget = paid_budget(tmp_path)
    monkeypatch.setattr(session_trace, 'new_session_dir', lambda *a: None)
    calls = []
    monkeypatch.setattr(llm_generator.subprocess, 'run', lambda *a, **k:
                        calls.append(1) or SimpleNamespace(returncode=0, stdout='x', stderr=''))
    runner = llm_generator.ProposerRunner(sandbox=tmp_path / 'sandbox', budget=budget, reservation_usd=0.1)
    with pytest.raises(BudgetExhausted, match='unknown'):
        runner.run('prompt')
    with pytest.raises(BudgetExhausted):
        runner.run('prompt')
    assert calls == [1]
    assert budget.snapshot()['reserved_cost_usd'] == 0.1
    assert budget.cost_usd is None


def test_reservation_save_failure_does_not_spawn_or_delete_previous_sandbox(tmp_path, monkeypatch):
    assert 'reservation_usd' in inspect.signature(llm_generator.ProposerRunner).parameters
    budget = paid_budget(tmp_path)
    sandbox = tmp_path / 'sandbox'
    sandbox.mkdir()
    evidence = sandbox / 'previous.txt'
    evidence.write_text('retain')
    def fail(*a):
        raise OSError('injected ledger write failure')
    monkeypatch.setattr(budget, '_save', fail)
    monkeypatch.setattr(llm_generator.subprocess, 'run', lambda *a, **k: pytest.fail('must not spawn'))
    runner = llm_generator.ProposerRunner(sandbox=sandbox, budget=budget, reservation_usd=0.1)
    with pytest.raises(BudgetExhausted):
        runner.run('prompt')
    assert evidence.read_text() == 'retain'


def test_real_wiring_requires_explicit_bounds_without_changing_old_configuration(tmp_path):
    from dualloop.real_wiring import build_real_controller
    cfg = config()
    with pytest.raises(ValueError, match='reservation'):
        build_real_controller(cfg, tmp_path / 'journal')
    assert not (tmp_path / 'journal').exists()


def test_real_wiring_uses_contract_limit_and_one_phase_ledger(tmp_path):
    from dualloop.real_wiring import build_real_controller
    cfg = config()
    cfg['session_reservations_usd'] = {'generation': 0.1, 'evaluation': 0.2}
    cfg['session_budget_file'] = str(tmp_path / 'budget.json')
    cfg['contract']['budget']['max_cost'] = 0.5
    controller = build_real_controller(cfg, tmp_path / 'journal')
    assert getattr(controller, 'budget_ledger', None) is not None, 'real controller needs the shared ledger'
    assert controller.budget_ledger is controller.generator.runner.budget
    assert controller.budget_ledger is controller.executor.budget
    assert controller.budget_ledger.snapshot()['max_cost_usd'] == 0.5


def test_final_generator_cost_and_early_stop_use_cumulative_ledger(tmp_path):
    budget = paid_budget(tmp_path)
    budget.reserve('prior', 0.2, phase='evaluation')
    budget.settle('prior', 0.1, receipt_id='prior-receipt')
    controller = build_controller(config(generations=1), tmp_path / 'journal')
    controller.budget_ledger = budget
    class Generator:
        def propose(self, *args):
            budget.reserve('generation', 0.2, phase='generation')
            budget.settle('generation', 0.15, receipt_id='generation-receipt')
            return []
    controller.generator = Generator()
    summary = controller.run()
    assert summary.stop_reason == 'no_candidates'
    assert summary.cost_usd == 0.25
    assert summary.cost_accounting['phases']['generation']['cost_usd'] == 0.15
    assert summary.cost_accounting['phases']['evaluation']['cost_usd'] == 0.1


def test_evaluation_cost_not_counted_twice_and_later_failure_keeps_receipt(tmp_path):
    budget = paid_budget(tmp_path)
    controller = build_controller(config(generations=0), tmp_path / 'journal')
    controller.budget_ledger = budget
    def evaluate(*args):
        budget.reserve('evaluation', 0.2, phase='evaluation')
        budget.settle('evaluation', 0.1, receipt_id='evaluation-receipt')
        raise OSError('details file write failed after settled usage')
    controller.fast_evaluator.evaluate = evaluate
    summary = controller.run()
    assert summary.cost_usd == 0.1
    assert summary.cost_accounting['known_cost_usd'] == 0.1


def test_admission_refusal_does_not_invent_unknown_cost(tmp_path):
    budget = paid_budget(tmp_path, limit=0.1)
    controller = build_controller(config(generations=2), tmp_path / 'journal')
    controller.budget_ledger = budget
    class Generator:
        def propose(self, *args):
            budget.reserve('too-large', 0.2, phase='generation')
            pytest.fail('reservation should be refused')
    controller.generator = Generator()
    summary = controller.run()
    assert summary.stop_reason.startswith('budget:')
    assert summary.cost_usd == 0
    assert budget.sessions_used == 0


def test_budget_status_cli_is_read_only_and_reconcile_replays_no_work(tmp_path):
    import sys
    budget = paid_budget(tmp_path)
    budget.reserve('completed', 0.2, phase='generation')
    receipt = budget.stage_receipt('completed', 0.1, receipt_id='durable-completion')
    original = budget.path.read_bytes()
    files = {p.relative_to(tmp_path) for p in tmp_path.rglob('*')}
    status = subprocess.run([sys.executable, '-m', 'dualloop', 'budget-status', '--budget-file', str(budget.path)],
                            text=True, capture_output=True)
    assert status.returncode == 0, status.stderr
    assert json.loads(status.stdout)['cost_usd'] is None
    assert budget.path.read_bytes() == original
    assert files == {p.relative_to(tmp_path) for p in tmp_path.rglob('*')}
    # Reservation owner is this test process. A different still-live process
    # must not reconcile its active request through the CLI.
    rejected = subprocess.run([sys.executable, '-m', 'dualloop', 'budget-reconcile', '--budget-file', str(budget.path),
                               '--receipt', str(receipt)], text=True, capture_output=True)
    assert rejected.returncode == 2
    budget.reconcile(receipt)
    replay = subprocess.run([sys.executable, '-m', 'dualloop', 'budget-reconcile', '--budget-file', str(budget.path),
                            '--receipt', str(receipt)], text=True, capture_output=True)
    assert replay.returncode == 0, replay.stdout + replay.stderr
    assert json.loads(replay.stdout)['cost_usd'] == 0.1
    assert budget.sessions_used == 1


def test_initial_budget_stop_reports_prior_total_without_running_baseline(tmp_path):
    budget = paid_budget(tmp_path, limit=0.1)
    budget.reserve('prior', 0.1, phase='generation')
    budget.settle('prior', 0.1, receipt_id='prior-complete')
    cfg = config(generations=1)
    cfg['contract']['budget']['max_cost'] = 0.1
    controller = build_controller(cfg, tmp_path / 'journal')
    controller.budget_ledger = budget
    controller.fast_evaluator.evaluate = lambda *a: pytest.fail('budget must stop before baseline')
    summary = controller.run()
    assert summary.stop_reason == 'budget:max_cost'
    assert summary.cost_usd == 0.1
    assert summary.fast_evals == 0


def test_explore_generator_failure_retains_its_settled_cost(tmp_path):
    budget = paid_budget(tmp_path)
    cfg = config(generations=1)
    cfg['contract'].pop('comparison')
    controller = build_controller(cfg, tmp_path / 'journal')
    controller.budget_ledger = budget
    class Generator:
        def propose(self, *args):
            budget.reserve('explore', 0.2, phase='generation')
            budget.settle('explore', 0.1, receipt_id='explore-usage')
            raise ValueError('no valid proposal after billed attempt')
    controller.generator = Generator()
    summary = controller.run()
    assert summary.mode == 'explore'
    assert summary.cost_usd == 0.1
    assert summary.stop_reason.startswith('failure:')


def test_resume_keeps_cumulative_receipts(tmp_path):
    budget = paid_budget(tmp_path)
    controller = build_controller(config(generations=0), tmp_path / 'journal')
    controller.run()
    budget.reserve('prior', 0.3, phase='selection')
    budget.settle('prior', 0.2, receipt_id='prior-selection')
    resumed = build_controller(config(generations=0), tmp_path / 'journal')
    resumed.budget_ledger = budget
    resumed._resume_state = (controller._champion, controller._champion_fast, controller._champion_slow)
    resumed.fast_evaluator.evaluate = lambda *a: pytest.fail('resume must not repeat baseline')
    summary = resumed.run()
    assert summary.cost_usd == 0.2
    assert summary.cost_accounting['phases']['selection']['cost_usd'] == 0.2


def test_ledger_refuses_admission_when_controller_contract_is_looser(tmp_path):
    budget = paid_budget(tmp_path, limit=0.1)
    budget.reserve('prior', 0.1, phase='generation')
    budget.settle('prior', 0.1, receipt_id='prior')
    controller = build_controller(config(generations=0), tmp_path / 'journal')
    controller.budget_ledger = budget
    controller.fast_evaluator.evaluate = lambda *a: pytest.fail('ledger itself is already exhausted')
    summary = controller.run()
    assert summary.stop_reason == 'budget:max_cost'
    assert summary.fast_evals == 0
    assert summary.cost_usd == 0.1


def test_preparation_failure_is_a_proven_zero_cost_attempt(tmp_path, monkeypatch):
    budget = paid_budget(tmp_path)
    runner = llm_generator.ProposerRunner(sandbox=tmp_path / 'sandbox', budget=budget, reservation_usd=0.1)
    def fail():
        raise OSError('sandbox preparation failed before process startup')
    monkeypatch.setattr(runner, '_prepare_sandbox', fail)
    monkeypatch.setattr(llm_generator.subprocess, 'run', lambda *a, **k: pytest.fail('must not spawn'))
    with pytest.raises(OSError, match='preparation'):
        runner.run('prompt', operation_id='not-started')
    state = budget.snapshot()
    assert state['cost_usd'] == 0
    assert state['reserved_cost_usd'] == 0
    assert state['operations']['not-started']['status'] == 'settled'


def test_summary_observer_failure_still_returns_the_cost_snapshot(tmp_path):
    budget = paid_budget(tmp_path)
    budget.reserve('prior', 0.2, phase='evaluation')
    budget.settle('prior', 0.1, receipt_id='prior')
    controller = build_controller(config(generations=0), tmp_path / 'journal')
    controller.budget_ledger = budget
    def observe(kind, payload):
        if kind == 'run_summary':
            raise OSError('observer failed after cost accounting')
    controller.observer.on_event = observe
    summary = controller.run()
    assert summary.cost_usd == 0.1
    assert summary.stop_reason == 'failure:observer'
    assert 'observer failed' in summary.failure_reason


def test_executor_sandboxes_never_replace_previous_attempt_artifacts(tmp_path):
    corpus = tmp_path / 'corpus'
    corpus.mkdir()
    (corpus / 'doc.md').write_text('fixture')
    root = tmp_path / 'sandboxes'
    first = dsh_executor.DshDocsQaExecutor(corpus_dir=corpus, sandbox_root=root)._fresh_sandbox('q')
    sentinel = first / 'retained.txt'
    sentinel.write_text('previous attempt')
    second = dsh_executor.DshDocsQaExecutor(corpus_dir=corpus, sandbox_root=root)._fresh_sandbox('q')
    assert first != second
    assert sentinel.read_text() == 'previous attempt'


@pytest.mark.parametrize('payload', [[], None])
def test_malformed_receipt_cli_returns_structured_error(tmp_path, payload):
    import hashlib
    import sys
    budget = paid_budget(tmp_path)
    data = json.dumps(payload).encode()
    receipt = tmp_path / (hashlib.sha256(data).hexdigest() + '.json')
    receipt.write_bytes(data)
    original = budget.path.read_bytes()
    result = subprocess.run([sys.executable, '-m', 'dualloop', 'budget-reconcile', '--budget-file', str(budget.path),
                             '--receipt', str(receipt)], capture_output=True, text=True)
    assert result.returncode == 2
    assert json.loads(result.stdout)['error']['code'] == 'BUDGET_RECOVERY_FAILED'
    assert 'Traceback' not in result.stderr
    assert budget.path.read_bytes() == original


def test_cli_summary_discloses_phases_precision_and_failure(tmp_path, capsys):
    from dualloop.cli import _print_summary
    budget = paid_budget(tmp_path)
    budget.reserve('prior', 0.1, phase='generation')
    budget.settle('prior', 0.000049, receipt_id='small-cost')
    controller = build_controller(config(generations=0), tmp_path / 'journal')
    controller.budget_ledger = budget
    summary = controller.run()
    summary.failure_reason = 'receipt example failure'
    _print_summary(summary, controller)
    output = capsys.readouterr().out
    assert '$0.000049000' in output
    for phase in ('generation', 'selection', 'evaluation'):
        assert phase in output
    assert 'receipt example failure' in output
