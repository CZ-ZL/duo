"""Offline cost-evidence regressions. Provider/process boundaries are substituted."""
import json
import subprocess
from types import SimpleNamespace

import pytest

from dualloop.runtime.budget import BudgetExhausted, SessionBudget, estimate_cost_usd, trace_cost_usd
from dualloop.runtime import session_trace
from dualloop.plugins import dsh_executor, llm_generator


@pytest.mark.parametrize('tokens', [
    {}, None, {'input': 1}, {'output': 1},
    {'input': True, 'output': 1}, {'input': -1, 'output': 1},
    {'input': 1, 'output': float('nan')}, {'input': 1, 'output': float('inf')},
    {'input': '10', 'output': 1}, {'input': 1, 'output': 1, 'cache_read': -1},
])
def test_incomplete_or_invalid_tokens_are_unknown(tokens):
    assert estimate_cost_usd(tokens) is None


def test_explicit_zero_usage_is_distinct_from_missing_usage():
    assert estimate_cost_usd({'input': 0, 'output': 0}) == 0
    assert estimate_cost_usd({'input': 100, 'output': 20}) > 0


@pytest.mark.parametrize('cost', [None, True, -1, float('nan'), float('inf'), 10**400])
def test_unknown_charge_survives_reload_and_blocks_more_sessions(tmp_path, cost):
    path = tmp_path / 'budget.json'
    budget = SessionBudget(path, cap=10)
    budget.acquire()
    budget.charge(0.04)
    budget.acquire()
    budget.charge(cost)
    assert budget.cost_usd is None
    assert budget.known_cost_usd == pytest.approx(0.04)
    assert json.loads(path.read_text())['cost_usd'] is None
    assert 'unknown' in budget.status_line()
    restored = SessionBudget(path, cap=10)
    assert restored.cost_usd is None
    assert restored.known_cost_usd == pytest.approx(0.04)
    with pytest.raises(BudgetExhausted, match='unknown'):
        restored.acquire()
    assert restored.sessions_used == 2


def test_omitted_charge_is_unknown_not_free(tmp_path):
    budget = SessionBudget(tmp_path / 'budget.json')
    budget.acquire()
    budget.charge()
    assert budget.cost_usd is None


def test_late_known_charge_cannot_clear_prior_unknown_cost(tmp_path):
    budget = SessionBudget(tmp_path / 'budget.json')
    budget.acquire()
    budget.acquire()  # another already-admitted concurrent session
    budget.charge(None)
    budget.charge(0.02)
    assert budget.cost_usd is None
    assert budget.known_cost_usd == pytest.approx(0.02)
    with pytest.raises(BudgetExhausted, match='unknown'):
        budget.acquire()


def parse_events(tmp_path, monkeypatch, events):
    (tmp_path / 'session.jsonl.zstd').touch()
    stdout = '\n'.join(json.dumps(e) if isinstance(e, dict) else e for e in events)
    monkeypatch.setattr(session_trace.subprocess, 'run', lambda *a, **k:
                        SimpleNamespace(returncode=0, stdout=stdout, stderr=''))
    return session_trace.parse_session(tmp_path)


def event(kind, turn=0, step=0, **data):
    return {'type': kind, 'data': {'turn': turn, 'step': step, **data}}


def message(usage, turn=0, step=0, **data):
    return event('assistant/message', turn, step, usage=usage, **data)


def complete_events(usage):
    return [event('turn/start'), event('step/start'), message(usage),
            event('step/end'), event('turn/end')]


VALID_USAGE = {'inputTokens': 10, 'outputTokens': 5, 'totalTokens': 15}


@pytest.mark.parametrize('events', [
    [{'type': 'session/header'}],
    complete_events({}),
    complete_events({'inputTokens': 10}),
    complete_events({'inputTokens': 10, 'outputTokens': True}),
    [event('turn/start'), event('step/start'), message(VALID_USAGE), event('step/start', step=1)],
    complete_events(VALID_USAGE) + ['{truncated'],
])
def test_trace_does_not_certify_absent_partial_or_corrupt_usage(tmp_path, monkeypatch, events):
    trace = parse_events(tmp_path, monkeypatch, events)
    assert trace.get('usage_complete') is False


@pytest.mark.parametrize('usage', [
    {'inputTokens': 0, 'outputTokens': 0, 'totalTokens': 0},
    {'inputTokens': 0, 'outputTokens': 0, 'cacheReadTokens': 0, 'cacheWriteTokens': 0},
])
def test_trace_accepts_explicit_zero_usage_for_a_completed_step(tmp_path, monkeypatch, usage):
    trace = parse_events(tmp_path, monkeypatch, complete_events(usage))
    assert trace['usage_complete'] is True
    assert trace_cost_usd(trace) == 0


@pytest.mark.parametrize('events', [
    # Two messages for step 0 cannot cover missing usage for step 1.
    [event('turn/start'), event('step/start'), message(VALID_USAGE), message(VALID_USAGE),
     event('step/end'), event('step/start', step=1), event('step/end', step=1), event('turn/end')],
    [event('turn/start'), event('step/start'), message(VALID_USAGE, turn=1), event('step/end'), event('turn/end')],
    [event('turn/start'), event('step/start'), message(VALID_USAGE, interrupted=True), event('step/end'), event('turn/end')],
    complete_events(VALID_USAGE)[:-1],
    complete_events(VALID_USAGE)[:3] + [event('turn/end')],
    complete_events(VALID_USAGE)[1:],
    [event('turn/start'), event('step/start'),
     event('assistant/chunk', chunk={'type': 'usage', 'usage': VALID_USAGE}),
     event('assistant/chunk', chunk={'type': 'finish', 'reason': {'kind': 'error'}}),
     event('llm/retry'), event('llm/retry-started'), message(VALID_USAGE),
     event('step/end'), event('turn/end')],
    [event('turn/start'), event('step/start'),
     event('assistant/chunk', chunk={'type': 'finish', 'reason': {'kind': 'aborted'}}),
     message(VALID_USAGE), event('step/end'), event('turn/end')],
    complete_events(VALID_USAGE) + complete_events(VALID_USAGE),
])
def test_incomplete_or_ambiguous_attempt_lifecycle_is_unknown(tmp_path, monkeypatch, events):
    trace = parse_events(tmp_path, monkeypatch, events)
    assert trace['usage_complete'] is False
    assert trace_cost_usd(trace) is None


@pytest.mark.parametrize('usage', [
    {'inputTokens': 0, 'outputTokens': 0},  # absent cache buckets and exact total
    {'inputTokens': 0, 'outputTokens': 0, 'totalTokens': 100},
    {**VALID_USAGE, 'totalTokens': 14},
    {**VALID_USAGE, 'reasoningTokens': 6},
    {**VALID_USAGE, 'cacheReadTokens': True},
    {**VALID_USAGE, 'cacheWriteTokens': -1},
    {**VALID_USAGE, 'totalTokens': True},
    {**VALID_USAGE, 'inputTokens': 2**53},
])
def test_unexplained_or_invalid_usage_buckets_are_unknown(tmp_path, monkeypatch, usage):
    trace = parse_events(tmp_path, monkeypatch, complete_events(usage))
    assert trace['usage_complete'] is False
    assert trace_cost_usd(trace) is None


def test_cache_write_is_recorded_but_not_priced_with_an_unsupported_tariff(tmp_path, monkeypatch):
    trace = parse_events(tmp_path, monkeypatch, complete_events({
        'inputTokens': 0, 'outputTokens': 0, 'cacheWriteTokens': 100, 'totalTokens': 100}))
    assert trace['tokens']['cache_write'] == 100
    assert trace_cost_usd(trace) is None
    assert estimate_cost_usd({'input': 0, 'output': 0, 'cache_write': 100}) is None


def test_complete_multiturn_usage_counts_final_samples_once(tmp_path, monkeypatch):
    events = [event('turn/start')]
    for step in (0, 1):
        events += [event('step/start', step=step),
                   event('assistant/chunk', step=step, chunk={'type': 'usage', 'usage': VALID_USAGE}),
                   message(VALID_USAGE, step=step), event('step/end', step=step)]
    events += [event('turn/end'), event('turn/start', turn=1), event('step/start', turn=1),
               message({**VALID_USAGE, 'cacheReadTokens': 3, 'totalTokens': 18}, turn=1),
               event('step/end', turn=1), event('turn/end', turn=1)]
    trace = parse_events(tmp_path, monkeypatch, events)
    assert trace['usage_complete'] is True
    assert trace['tokens'] == {'input': 30, 'output': 15, 'cache_read': 3, 'cache_write': 0, 'reasoning': 0}
    assert trace_cost_usd(trace) == estimate_cost_usd({'input': 30, 'output': 15, 'cache_read': 3})


GOOD_TRACE = {'usage_complete': True, 'tokens': {'input': 100, 'output': 20}}


@pytest.mark.parametrize('trace', [None, {'error': 'unreadable'}, {},
                                  {'usage_complete': False, 'tokens': {'input': 0, 'output': 0}},
                                  RuntimeError('decoder failed')])
def test_proposer_missing_cost_stops_before_a_second_spawn(tmp_path, monkeypatch, trace):
    budget = SessionBudget(tmp_path / 'budget.json')
    calls = []
    monkeypatch.setattr(llm_generator.subprocess, 'run', lambda *a, **k:
                        calls.append(1) or SimpleNamespace(returncode=0, stdout='proposal', stderr=''))
    monkeypatch.setattr(session_trace, 'new_session_dir', lambda *a, **k: tmp_path if trace is not None else None)
    def parse(*args):
        if isinstance(trace, Exception):
            raise trace
        return trace
    monkeypatch.setattr(session_trace, 'parse_session', parse)
    runner = llm_generator.ProposerRunner(sandbox=tmp_path / 'sandbox', budget=budget)
    with pytest.raises(BudgetExhausted, match='unknown'):
        runner.run('test prompt')
    assert budget.cost_usd is None
    with pytest.raises(BudgetExhausted, match='unknown'):
        runner.run('second prompt')
    assert calls == [1]


@pytest.mark.parametrize('failure', [subprocess.TimeoutExpired('fake', 1), OSError('spawn failed')])
def test_proposer_exception_still_marks_unreconciled_cost(tmp_path, monkeypatch, failure):
    def fail(*a, **k):
        raise failure
    monkeypatch.setattr(llm_generator.subprocess, 'run', fail)
    monkeypatch.setattr(session_trace, 'new_session_dir', lambda *a, **k: None)
    budget = SessionBudget(tmp_path / 'budget.json')
    runner = llm_generator.ProposerRunner(sandbox=tmp_path / 'sandbox', budget=budget)
    with pytest.raises(BudgetExhausted, match='unknown'):
        runner.run('test prompt')
    assert budget.cost_usd is None


def test_proposer_keeps_a_valid_usage_estimate(tmp_path, monkeypatch):
    monkeypatch.setattr(llm_generator.subprocess, 'run', lambda *a, **k:
                        SimpleNamespace(returncode=0, stdout='proposal', stderr=''))
    monkeypatch.setattr(session_trace, 'new_session_dir', lambda *a, **k: tmp_path)
    monkeypatch.setattr(session_trace, 'parse_session', lambda *a, **k: GOOD_TRACE)
    budget = SessionBudget(tmp_path / 'budget.json')
    runner = llm_generator.ProposerRunner(sandbox=tmp_path / 'sandbox', budget=budget)
    assert runner.run('test prompt') == 'proposal'
    assert budget.cost_usd == pytest.approx(round(estimate_cost_usd(GOOD_TRACE['tokens']), 6))


def executor_fixture(tmp_path, monkeypatch, trace, outcome):
    budget = SessionBudget(tmp_path / 'budget.json')
    executor = dsh_executor.DshDocsQaExecutor(corpus_dir=tmp_path, budget=budget)
    sandbox = tmp_path / 'sandbox'
    sandbox.mkdir()
    monkeypatch.setattr(executor, '_fresh_sandbox', lambda label: sandbox)
    monkeypatch.setattr(executor, '_grab_trace', lambda *a: trace)
    calls = []
    def run(*args, **kwargs):
        calls.append(1)
        if isinstance(outcome, Exception):
            raise outcome
        return SimpleNamespace(returncode=outcome, stdout='answer', stderr='fixture failure')
    monkeypatch.setattr(dsh_executor.subprocess, 'run', run)
    return executor, budget, calls


@pytest.mark.parametrize('outcome', [0, 1, subprocess.TimeoutExpired('fake', 1), OSError('spawn failed')])
def test_executor_missing_usage_never_charges_zero(tmp_path, monkeypatch, outcome):
    executor, budget, calls = executor_fixture(tmp_path, monkeypatch, {'error': 'no trace'}, outcome)
    with pytest.raises(BudgetExhausted, match='unknown'):
        executor.run_question('question')
    assert budget.cost_usd is None
    with pytest.raises(BudgetExhausted, match='unknown'):
        executor.run_question('question')
    assert calls == [1]


def test_nonzero_executor_exit_still_charges_observed_usage(tmp_path, monkeypatch):
    executor, budget, _ = executor_fixture(tmp_path, monkeypatch, GOOD_TRACE, 1)
    result = executor.run_question('question')
    assert result.ok is False
    assert result.cost_usd == estimate_cost_usd(GOOD_TRACE['tokens'])
    assert budget.cost_usd == pytest.approx(round(result.cost_usd, 6))


def test_budget_refusal_is_not_retried_as_a_bad_proposal():
    calls = []
    class Runner:
        def run(self, prompt):
            calls.append(1)
            raise BudgetExhausted('unknown session cost')
    generator = llm_generator.LlmDocsQaGenerator(runner=Runner(), families=['wording'])
    with pytest.raises(BudgetExhausted, match='unknown'):
        generator._propose_one('prompt')
    assert calls == [1]


def test_unknown_proposer_cost_reaches_controller_stop_and_summary(tmp_path, monkeypatch):
    from test_controller import config
    from dualloop.controller import build_controller
    budget = SessionBudget(tmp_path / 'budget.json')
    calls = []
    monkeypatch.setattr(llm_generator.subprocess, 'run', lambda *a, **k:
                        calls.append(1) or SimpleNamespace(returncode=0, stdout='proposal', stderr=''))
    monkeypatch.setattr(session_trace, 'new_session_dir', lambda *a, **k: None)
    controller = build_controller(config(generations=3), tmp_path / 'journal')
    controller.generator = llm_generator.LlmDocsQaGenerator(
        runner=llm_generator.ProposerRunner(sandbox=tmp_path / 'sandbox', budget=budget), families=['wording'])
    summary = controller.run()
    assert summary.stop_reason == 'budget:unknown_cost'
    assert summary.cost_usd is None
    assert calls == [1]
    assert any(entry.fast is not None and entry.fast.cost_usd is None
               for entry in controller.journal.latest().values())


@pytest.mark.parametrize('caller', ['proposer', 'executor'])
@pytest.mark.parametrize('receipt_mode', ['existing_only', 'delayed_old', 'one_new', 'two_new', 'one_new_and_pending'])
def test_cost_receipt_belongs_to_the_current_invocation(tmp_path, monkeypatch, caller, receipt_mode):
    sessions = tmp_path / 'session-store'
    sessions.mkdir()
    old = sessions / 'old-session'
    old.mkdir()
    if receipt_mode != 'delayed_old':
        (old / 'session.jsonl.zstd').touch()
    # Use actual directory discovery and a complete zero-usage receipt. An old
    # valid receipt must never make the current missing receipt look free.
    monkeypatch.setattr(session_trace, '_project_dir_for_cwd', lambda cwd: sessions)
    trace = {'usage_complete': True, 'tokens': {'input': 0, 'output': 0}}
    monkeypatch.setattr(session_trace, 'parse_session', lambda *a, **k: dict(trace))
    monkeypatch.setattr(dsh_executor, 'parse_session', lambda *a, **k: dict(trace))
    monkeypatch.setattr(dsh_executor.time, 'sleep', lambda *a: None)
    calls = []
    def run(*args, **kwargs):
        calls.append(1)
        if receipt_mode == 'delayed_old':
            (old / 'session.jsonl.zstd').touch()
        if receipt_mode in ('one_new', 'two_new', 'one_new_and_pending'):
            new = sessions / 'new-session'
            new.mkdir()
            (new / 'session.jsonl.zstd').touch()
        if receipt_mode in ('two_new', 'one_new_and_pending'):
            extra = sessions / 'extra-session'
            extra.mkdir()
            if receipt_mode == 'two_new':
                (extra / 'session.jsonl.zstd').touch()
        return SimpleNamespace(returncode=0, stdout='answer', stderr='')
    monkeypatch.setattr(llm_generator.subprocess, 'run', run)
    budget = SessionBudget(tmp_path / 'budget.json')
    if caller == 'proposer':
        runner = llm_generator.ProposerRunner(sandbox=tmp_path / 'sandbox', budget=budget)
        invoke = lambda: runner.run('prompt')
    else:
        executor = dsh_executor.DshDocsQaExecutor(corpus_dir=tmp_path, budget=budget)
        sandbox = tmp_path / 'sandbox'
        sandbox.mkdir()
        monkeypatch.setattr(executor, '_fresh_sandbox', lambda label: sandbox)
        invoke = lambda: executor.run_question('question')
    if receipt_mode == 'one_new':
        result = invoke()
        assert budget.cost_usd == 0
        if caller == 'executor':
            assert result.session_dir == str(sessions / 'new-session')
    else:
        with pytest.raises(BudgetExhausted, match='unknown'):
            invoke()
        assert budget.cost_usd is None
        with pytest.raises(BudgetExhausted, match='unknown'):
            invoke()
    assert calls == [1]


@pytest.mark.parametrize('marker', ['session/title-llm-request', 'web/deepseek-search-llm-request',
                                  'compaction/start', 'compaction/summary'])
def test_unaccounted_auxiliary_model_requests_are_unknown(tmp_path, monkeypatch, marker):
    events = complete_events(VALID_USAGE)
    events.insert(2, event(marker))
    trace = parse_events(tmp_path, monkeypatch, events)
    assert trace['usage_complete'] is False
    assert trace_cost_usd(trace) is None


@pytest.mark.parametrize('name', ['subagent', 'subagent_fork', 'send_message'])
def test_default_child_agent_requests_need_separate_cost_receipts(tmp_path, monkeypatch, name):
    events = complete_events(VALID_USAGE)
    events.insert(3, event('tool/call', name=name, arguments='{}'))
    trace = parse_events(tmp_path, monkeypatch, events)
    assert trace['usage_complete'] is False
    assert trace_cost_usd(trace) is None
