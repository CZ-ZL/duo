"""Validate explicit settled maturation receipts before preparing a continuation.

This reads existing authorization/receipts; it does not allocate money, dispatch
work, or resume an experiment. The native runtime still owns request admission.
"""
import json
from decimal import Decimal
from pathlib import Path
from dsh_model_profile import ROOT, sha, manifest_digest
from run_caller_format_probe import parent_allocation, number, SCOPE as PROBE_SCOPE


def continuation_allocation(path, _depth=0):
    if _depth >= 8:
        raise ValueError('Continuation receipt chain exceeds its bounded audit depth')
    path = Path(path).resolve()
    read = lambda p: json.loads(p.read_text())
    spec = read(path)
    if isinstance(spec, dict) and 'priorContinuation' in spec:
        if 'requestCapAmendment' in spec:
            return _request_cap_amendment(path, spec, _depth)
        return _settled_continuation(path, spec, _depth)
    names = ['parentRun', 'parentAuthorization', 'parentSummary', 'probeRun', 'probeAuthorization', 'batchSummary']
    if set(spec) != set(names) or any(not isinstance(spec[k], str) or not spec[k] for k in names):
        raise ValueError('Explicit parent, diagnostic and cumulative receipts required')
    paths = {k: (path.parent / spec[k]).resolve() for k in names}
    parent = parent_allocation(paths['parentRun'], paths['parentAuthorization'], paths['parentSummary'])
    summary = read(paths['batchSummary'])
    probe = paths['probeRun']
    auth, result, budget, rows, receipts, prepared = [read(p) for p in [paths['probeAuthorization'], *[probe / n for n in ['result.json', 'total-budget.json', 'requests.json', 'total-cost-receipts.json', 'prepared.json']]]]
    if (auth.get('scope') != PROBE_SCOPE or auth.get('approvedBy') != 'user' or not auth.get('authorizationText')
            or auth.get('batch') != parent['batch'] or auth.get('currency') != 'CNY'
            or auth.get('maxCostCny') != .5 or auth.get('maxModelRequests') != 2
            or result.get('evidenceKind') != 'real_model_format_probe' or result.get('status') not in ['completed', 'failed']
            or result.get('parent') != parent or result.get('runId') != auth.get('planDigest')
            or result.get('planDigest') != auth.get('planDigest') or prepared.get('planDigest') != auth.get('planDigest')
            or prepared.get('manifestDigest') != auth.get('manifestDigest') or manifest_digest(prepared) != auth.get('manifestDigest')):
        raise ValueError('Diagnostic identity or authorization does not match the settled parent batch')
    if not isinstance(rows, list) or not 1 <= len(rows) <= 2 or len({r['id'] for r in rows}) != len(rows):
        raise ValueError('Bounded unique diagnostic requests required')
    if len(receipts) != len(rows) or len({r['operationId'] for r in receipts}) != len(rows):
        raise ValueError('Every diagnostic request needs a distinct cost receipt')
    by_id = {r['operationId']: r for r in receipts}
    cost = Decimal(0)
    for r in rows:
        usage = r.get('usage') or {}
        if (r.get('kind') != 'caller_format_diagnostic'
                or not all(type(usage.get(k)) is int and usage[k] >= 0 for k in ['inputTokens', 'cacheReadTokens', 'outputTokens', 'totalTokens'])
                or usage['inputTokens'] + usage['cacheReadTokens'] + usage['outputTokens'] != usage['totalTokens']
                or number(r.get('costCny')) != number(by_id.get(r['id'], {}).get('cost')) / Decimal(10**9)):
            raise ValueError('Diagnostic usage or receipt cost cannot be reconciled')
        cost += number(r['costCny'])
    if (any(number(v) != cost for v in [result.get('costCny'), budget.get('costCny')])
            or any(v != len(rows) for v in [result.get('modelRequests'), budget.get('operations')])
            or budget.get('blockedReason') or number(budget.get('reservedCostCny')) != 0 or cost > Decimal('.5')):
        raise ValueError('Diagnostic accounting is unresolved or exceeded its authorization')
    prior_cost = number(parent['priorCostCny']) + cost
    prior_count = parent['priorRequests'] + len(rows)
    caller_used = parent['priorCallerRequests'] + len(rows)
    inner_used = parent['priorInnerRequests']
    max_cost, max_requests = number(parent['batchMaxCostCny']), parent['batchMaxRequests']
    caller_cap = parent['priorCallerRequests'] + parent['callerRemaining']
    inner_cap = parent['priorInnerRequests'] + parent['innerRemaining']
    expected_kinds = {'caller': {'used': caller_used, 'cap': caller_cap, 'remaining': caller_cap - caller_used},
                      'inner': {'used': inner_used, 'cap': inner_cap, 'remaining': inner_cap - inner_used}}
    if (summary.get('batch') != parent['batch'] or summary.get('currency') != 'CNY'
            or summary.get('allUsageKnown') is not True or number(summary.get('reservedCostCny')) != 0
            or summary.get('usedModelRequests') != prior_count or number(summary.get('usedCostCny')) != prior_cost
            or summary.get('maxModelRequests') != max_requests or number(summary.get('maxCostCny')) != max_cost
            or summary.get('remainingModelRequests') != max_requests - prior_count
            or number(summary.get('remainingCostCny')) != max_cost - prior_cost or summary.get('byKind') != expected_kinds):
        raise ValueError('Cumulative summary must include BOTH the parent and diagnostic consumption')
    source_files = [Path(k) for k in parent['sourceHashes']] + [paths['probeAuthorization'], *[probe / n for n in ['result.json', 'requests.json', 'total-budget.json', 'total-cost-receipts.json']]]
    declared = {(ROOT / k).resolve(): v for k, v in summary.get('sourceHashes', {}).items()}
    if set(declared) != set(source_files) or any(sha(p) != declared[p] for p in source_files):
        raise ValueError('Cumulative source receipts omitted, added, or changed')
    if caller_cap - caller_used < 1 or inner_cap - inner_used < 1 or max_requests <= prior_count or max_cost <= prior_cost:
        raise ValueError('No remaining Caller/inner continuation allowance')
    source_files += [probe / 'prepared.json', path, paths['batchSummary']]
    return {'batch': parent['batch'], 'priorRequests': prior_count, 'priorCostCny': float(prior_cost),
            'priorCallerRequests': caller_used, 'priorInnerRequests': inner_used,
            'batchMaxRequests': max_requests, 'batchMaxCostCny': float(max_cost),
            'callerRemaining': caller_cap - caller_used, 'innerRemaining': inner_cap - inner_used,
            'maxModelRequests': max_requests - prior_count, 'maxCostCny': float(max_cost - prior_cost),
            'sourceHashes': {str(p): sha(p) for p in source_files}}


def _settled_continuation(path, spec, depth):
    names = ['priorContinuation', 'settledRun', 'settledAuthorization', 'batchSummary']
    if set(spec) != set(names) or any(not isinstance(spec[k], str) or not spec[k] for k in names):
        raise ValueError('Explicit prior continuation, terminal run, authorization and latest summary required')
    paths = {k: (path.parent / spec[k]).resolve() for k in names}
    prior = continuation_allocation(paths['priorContinuation'], depth + 1)
    read = lambda p: json.loads(p.read_text())
    run = paths['settledRun']
    names = ['prepared.json', 'result.json', 'requests.json', 'total-budget.json', 'total-cost-receipts.json']
    prepared, result, rows, budget, receipts = [read(run / n) for n in names]
    auth, summary = read(paths['settledAuthorization']), read(paths['batchSummary'])
    if (auth.get('scope') != 'native-maturation-caller-warm-start' or auth.get('approvedBy') != 'user'
            or not auth.get('authorizationText') or auth.get('currency') != 'CNY' or auth.get('batch') != prior['batch']
            or prepared.get('scope') != auth['scope'] or prepared.get('batchCarry') != prior
            or prepared.get('planDigest') != auth.get('planDigest') or result.get('planDigest') != auth.get('planDigest')
            or result.get('runId') != auth.get('planDigest') or prepared.get('manifestDigest') != auth.get('manifestDigest')
            or manifest_digest(prepared) != auth.get('manifestDigest')
            or result.get('status') not in ['completed', 'failed']
            or result.get('evidenceKind') != 'real_caller_real_inner_custom_schema_evaluation'):
        raise ValueError('Settled continuation identity or authority does not match prior consumption')
    caps = {'maxCostCny': prior['maxCostCny'], 'maxModelRequests': prior['maxModelRequests'],
            'callerRequestCap': prior['callerRemaining'], 'innerRequestCap': prior['innerRemaining']}
    if any(auth.get(k) != v or prepared.get(k) != v for k, v in caps.items()):
        raise ValueError('Settled continuation reset or changed the remaining allocation')
    if (not isinstance(rows, list) or not 0 <= len(rows) <= prior['maxModelRequests']
            or len({r['id'] for r in rows}) != len(rows) or len(receipts) != len(rows)
            or len({r['operationId'] for r in receipts}) != len(rows)):
        raise ValueError('Every bounded continuation request requires a unique settlement')
    by_id = {r['operationId']: r for r in receipts}
    counts, cost = {'caller': 0, 'inner': 0}, Decimal(0)
    for row in rows:
        usage = row.get('usage') or {}
        if (row.get('kind') not in counts
                or not all(type(usage.get(k)) is int and usage[k] >= 0 for k in ['inputTokens', 'cacheReadTokens', 'outputTokens', 'totalTokens'])
                or usage['inputTokens'] + usage['cacheReadTokens'] + usage['outputTokens'] != usage['totalTokens']
                or number(row.get('costCny')) != number(by_id.get(row['id'], {}).get('cost')) / Decimal(10**9)):
            raise ValueError('Continuation usage or settlement cannot be reconciled')
        counts[row['kind']] += 1
        cost += number(row['costCny'])
    if (any(number(v) != cost for v in [result.get('costCny'), budget.get('costCny')])
            or result.get('modelRequests') != len(rows) or budget.get('operations') != len(rows)
            or result.get('requestCounts') != counts or budget.get('blockedReason') or number(budget.get('reservedCostCny')) != 0
            or cost > number(prior['maxCostCny']) or any(counts[k] > prior[k+'Remaining'] for k in counts)):
        raise ValueError('Continuation accounting is unresolved or exceeded its caps')
    used = prior['priorRequests'] + len(rows)
    used_cost = number(prior['priorCostCny']) + cost
    remaining = prior['maxModelRequests'] - len(rows)
    remaining_cost = number(prior['batchMaxCostCny']) - used_cost
    kinds = {k: {'used': prior['prior'+k.title()+'Requests'] + counts[k],
                 'cap': prior['prior'+k.title()+'Requests'] + prior[k+'Remaining'],
                 'remaining': prior[k+'Remaining'] - counts[k]} for k in counts}
    expected_batch = {'batch':prior['batch'], 'priorRequests':prior['priorRequests'], 'priorCostCny':prior['priorCostCny'],
                      'modelRequests':used, 'costCny':float(used_cost), 'remainingRequests':remaining,
                      'remainingCostCny':float(remaining_cost), 'callerRemaining':kinds['caller']['remaining'], 'innerRemaining':kinds['inner']['remaining']}
    if any(result.get('batchAccounting', {}).get(k) != v for k,v in expected_batch.items()):
        raise ValueError('Terminal result omitted or changed prior consumption')
    if (summary.get('batch') != prior['batch'] or summary.get('currency') != 'CNY' or summary.get('allUsageKnown') is not True
            or number(summary.get('reservedCostCny')) != 0 or summary.get('usedModelRequests') != used
            or number(summary.get('usedCostCny')) != used_cost or summary.get('remainingModelRequests') != remaining
            or number(summary.get('remainingCostCny')) != remaining_cost or summary.get('byKind') != kinds
            or summary.get('maxModelRequests') != prior['batchMaxRequests'] or number(summary.get('maxCostCny')) != number(prior['batchMaxCostCny'])):
        raise ValueError('Latest cumulative summary must include every settled attempt')
    sources = {Path(k) for k in prior['sourceHashes']} | {paths['settledAuthorization'], *[run / n for n in names]}
    declared = {(ROOT / k).resolve(): v for k,v in summary.get('sourceHashes', {}).items()}
    if not sources.issubset(declared) or any(sha(p) != h for p,h in declared.items()):
        raise ValueError('Latest summary source receipts are omitted or changed')
    sources |= set(declared) | {path, paths['batchSummary']}
    return {**prior, 'priorRequests':used, 'priorCostCny':float(used_cost),
            'priorCallerRequests':kinds['caller']['used'], 'priorInnerRequests':kinds['inner']['used'],
            'callerRemaining':kinds['caller']['remaining'], 'innerRemaining':kinds['inner']['remaining'],
            'maxModelRequests':remaining, 'maxCostCny':float(remaining_cost),
            'sourceHashes':{str(p):sha(p) for p in sorted(sources)}}


def _request_cap_amendment(path, spec, depth):
    names = ['priorContinuation', 'requestCapAmendment']
    if set(spec) != set(names) or any(not isinstance(spec[k], str) or not spec[k] for k in names):
        raise ValueError('Explicit previous consumption and request-cap authorization required')
    previous, auth_path = [(path.parent / spec[k]).resolve() for k in names]
    prior = continuation_allocation(previous, depth + 1)
    auth = json.loads(auth_path.read_text())
    before = {'maxCostCny': prior['batchMaxCostCny'], 'maxModelRequests': prior['batchMaxRequests'],
              'callerRequestCap': prior['priorCallerRequests'] + prior['callerRemaining'],
              'innerRequestCap': prior['priorInnerRequests'] + prior['innerRemaining']}
    after = auth.get('after', {})
    if (auth.get('scope') != 'native-maturation-request-cap-amendment' or auth.get('approvedBy') != 'user'
            or not auth.get('authorizationText') or auth.get('batch') != prior['batch'] or auth.get('currency') != 'CNY'
            or auth.get('priorAllocation') != prior or auth.get('before') != before):
        raise ValueError('Request-cap amendment lacks matching approval and complete prior consumption')
    counts = ['maxModelRequests', 'callerRequestCap', 'innerRequestCap']
    if (not isinstance(after, dict) or set(after) != set(before)
            or number(after.get('maxCostCny')) != number(before['maxCostCny'])
            or any(type(after.get(k)) is not int or after[k] < before[k] for k in counts)
            or after['maxModelRequests'] != after['callerRequestCap'] + after['innerRequestCap']):
        raise ValueError('A request-cap amendment must retain CNY and explicitly cover integer total/subcaps')
    return {**prior, 'batchMaxRequests': after['maxModelRequests'],
            'maxModelRequests': after['maxModelRequests'] - prior['priorRequests'],
            'callerRemaining': after['callerRequestCap'] - prior['priorCallerRequests'],
            'innerRemaining': after['innerRequestCap'] - prior['priorInnerRequests'],
            'sourceHashes': {**prior['sourceHashes'], str(auth_path): sha(auth_path), str(path): sha(path)}}
