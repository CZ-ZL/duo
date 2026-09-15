#!/usr/bin/env python3
"""Read retained reports in the original Caller event context, without new DUO work.

offline uses scripted transport. prepare-live seals a proposed subcap transfer,
without applying it. execute needs an explicit approval bound to that proposal.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import sqlite3

from dsh_model_profile import (Profile, ROOT, agent_entries, save, sha,
                               freeze_profile_inputs, seal_manifest, manifest_digest, module_inventory)
from maturation_batch import continuation_allocation

READ = lambda p: json.loads(p.read_text())


def validate_authorization(auth, prepared, carry):
    before = {'maxModelRequests': carry['batchMaxRequests'], 'maxCostCny': carry['batchMaxCostCny'],
              'callerRequestCap': carry['priorCallerRequests'] + carry['callerRemaining'],
              'innerRequestCap': carry['priorInnerRequests'] + carry['innerRemaining']}
    after = {**before, 'callerRequestCap': before['callerRequestCap'] + 4, 'innerRequestCap': before['innerRequestCap'] - 4}
    if (carry != prepared['batchCarry'] or manifest_digest(prepared) != prepared['manifestDigest']
            or carry['callerRemaining'] != 0 or carry['innerRemaining'] < 4 or carry['maxCostCny'] < 1
            or prepared.get('maxModelRequests') != 4 or prepared.get('maxCostCny') != 1
            or prepared.get('before') != before or prepared.get('after') != after
            or auth.get('approvedBy') != 'user' or not auth.get('authorizationText')
            or auth.get('scope') != 'native-maturation-report-delivery' or auth.get('currency') != 'CNY'
            or auth.get('batch') != carry['batch']
            or any(auth.get(k) != prepared[k] for k in ['planDigest', 'manifestDigest', 'maxModelRequests', 'maxCostCny', 'before', 'after'])):
        raise ValueError('Delivery approval must bind unchanged consumption, proposal and sealed inputs')


def retained_source(directory):
    names = ['result.json', 'session-events.json', 'requests.json', 'resources.json', 'PUBLIC_GUIDE.md']
    hashes = {str(directory / n): sha(directory / n) for n in names}
    result = READ(directory / 'result.json')
    target = Path(READ(directory / 'resources.json')['targetPath'])
    hashes[str(target)] = sha(target)
    required = ['twoCompletedNativeRuns', 'callerAttachedCustomEvaluator', 'warmStartConsumed',
                'originalUnchanged', 'totalAccounting', 'innerAccounting', 'boundedRequests']
    if (result.get('status') != 'failed' or result.get('failure', {}).get('code') != 'DUO_CALLER_REQUEST_LIMIT'
            or not all(result.get('checks', {}).get(k) is True for k in required)
            or len(result.get('innerRunIds', [])) != 2 or len(result.get('candidateReports', [])) != 1):
        raise ValueError('Only the retained two-completed-run report-limit case supports this delivery entry')
    sessions = {r['sessionId'] for r in READ(directory / 'requests.json') if r['kind'] == 'caller'}
    if len(sessions) != 1:
        raise ValueError('A single retained Caller identity is required')
    statuses = []
    for run_id in result['innerRunIds']:
        db_path = directory / 'journal' / run_id / 'duo.sqlite'
        hashes[str(db_path)] = sha(db_path)
        with sqlite3.connect(db_path.as_uri() + '?mode=ro', uri=True) as db:
            meta = {k: json.loads(v) for k, v in db.execute('SELECT key,value FROM meta')}
            events = [json.loads(v) for (v,) in db.execute('SELECT payload FROM events ORDER BY seq')]
            operations = [json.loads(v) for (v,) in db.execute('SELECT payload FROM operations')]
        if (meta['result']['status'] != 'completed' or meta['result']['generationsRun'] != 2
                or any(v['status'] != 'settled' for v in operations)):
            raise ValueError('Completed, settled native artifacts required')
        statuses.append({'apiVersion': 2, 'runtime': 'dsh-native', 'runId': run_id,
                         'run': meta['run'], 'result': meta['result'],
                         'budget': meta['result']['budget'], 'events': events})
    source = {'runId': result['runId'], 'directory': str(directory), 'eligible': True,
              'callerSessionId': sessions.pop(), 'innerRunIds': result['innerRunIds'],
              'candidateReports': result['candidateReports']}
    return source, statuses, hashes


def execute(args, parser):
    # Do not even inspect credentials until every authorization/input check passes.
    if not args.authorization:
        parser.error('Explicit report-delivery authorization required')
    out = args.output.resolve()
    prepared = READ(out / 'prepared.json')
    auth = READ(args.authorization)
    if (out / 'result.json').exists() or (out / 'execution-claim.json').exists():
        parser.error('Retained delivery already attempted; no replay')
    carry = continuation_allocation(Path(prepared['continuationInput']))
    try:
        validate_authorization(auth, prepared, carry)
    except ValueError as error:
        parser.error(str(error))
    for path, expected in prepared['fileHashes'].items():
        if sha(Path(path)) != expected:
            parser.error('Prepared or retained input changed: ' + path)
    if any(Path(p).exists() or Path(p).is_symlink() for p in prepared['absentPaths']):
        parser.error('Unexpected launch configuration appeared')
    if module_inventory(prepared['moduleInventory']) != prepared['moduleInventory']:
        parser.error('Module resolution changed')
    if not os.environ.get('DEEPSEEK_API_KEY'):
        parser.error('DEEPSEEK_API_KEY is absent; no dispatch')
    host = object.__new__(Profile)
    host.output, host.dsh, host.node = out, Path(prepared['dshPackage']), shutil.which('node')
    host.env = {'PATH': str(Path(host.node).parent) + os.pathsep + os.defpath,
                'DSH_HOME': str(out / 'dsh-home'), 'DSH_TELEMETRY_DISABLED': '1',
                'DUO_MODEL_RUN_ENABLED': '1', 'DEEPSEEK_API_KEY': os.environ['DEEPSEEK_API_KEY']}
    host.commands = READ(out / 'commands.json')
    with (out / 'execution-claim.json').open('x') as file:
        json.dump({'pid': os.getpid(), 'planDigest': prepared['planDigest'], 'authorizationSha256': sha(args.authorization)}, file)
        file.flush()
        os.fsync(file.fileno())
    save(out / 'authorization-used.json', auth)
    process = host.execute('authorized-delivery', [host.node, str(host.dsh / 'lib/bin.js'), '--profile', prepared['profile']], timeout=150)
    print('Delivery exit:', process.returncode, 'output:', out)
    return process.returncode


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['offline', 'prepare-live', 'execute'], required=True)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--dsh-package', type=Path)
    parser.add_argument('--continuation-input', type=Path)
    parser.add_argument('--pricing', type=Path)
    parser.add_argument('--authorization', type=Path)
    parser.add_argument('--fixture-missing-usage', action='store_true')
    args = parser.parse_args()
    if args.fixture_missing_usage and args.mode != 'offline':
        parser.error('Fixture controls are offline only')
    if args.mode == 'execute':
        return execute(args, parser)
    if not args.source or not args.dsh_package:
        parser.error('--source and --dsh-package required')
    directory = args.source.resolve()
    source, statuses, source_hashes = retained_source(directory)
    live = args.mode == 'prepare-live'
    carry = None
    if live:
        if not args.continuation_input or not args.pricing:
            parser.error('Verified consumption and frozen CNY pricing required')
        carry = continuation_allocation(args.continuation_input.resolve())
        if carry['callerRemaining'] != 0 or carry['innerRemaining'] < 4 or carry['maxCostCny'] < 1:
            parser.error('This proposal transfers exactly four unused inner slots; no automatic expansion')
        latest = READ(directory / 'result.json')['batchAccounting']
        if (carry['batch'] != latest['batch'] or carry['priorRequests'] != latest['modelRequests']
                or carry['priorCostCny'] != latest['costCny']):
            parser.error('Retained source and latest cumulative consumption differ')
        pricing = READ(args.pricing)
        if pricing.get('currency') != 'CNY' or pricing.get('verifiedDate') != datetime.now(timezone.utc).date().isoformat():
            parser.error('Refresh official CNY pricing for this UTC date')
    else:
        pricing = {'id': 'delivery-fixture', 'currency': 'CNY', 'inputCnyPerMillion': 2, 'cacheReadCnyPerMillion': .04, 'outputCnyPerMillion': 8}
    envelope = ((327680 + 4096) * max(pricing['inputCnyPerMillion'], pricing['cacheReadCnyPerMillion']) + 2048 * pricing['outputCnyPerMillion']) / 1e6
    if envelope > .7:
        parser.error('Frozen tariff exceeds the bounded request reservation')
    host = Profile(args.dsh_package, args.output)
    host.pack()
    save(host.output / 'source.json', source)
    save(host.output / 'statuses.json', statuses)
    shutil.copyfile(directory / 'session-events.json', host.output / 'seed.json')
    config = {'output': str(host.output), 'sourcePath': str(host.output / 'source.json'),
              'seedPath': str(host.output / 'seed.json'), 'statusesPath': str(host.output / 'statuses.json'),
              'sourceHashes': source_hashes, 'live': live, 'provider': 'deepseek-official' if live else 'duo-delivery-fixture',
              'model': 'deepseek-v4-flash' if live else 'fixture', 'maxModelRequests': 4, 'maxCostCny': 1,
              'maxInputBytes': 327680, 'reservationCny': .7, 'pricing': pricing, 'missingUsage': args.fixture_missing_usage}
    if carry:
        config['batchCarry'] = {k: carry[k] for k in ['batch', 'priorRequests', 'priorCostCny',
            'priorCallerRequests', 'priorInnerRequests', 'batchMaxRequests', 'batchMaxCostCny']}
        config['batchCarry']['callerCapAfterApproval'] = carry['priorCallerRequests'] + 4
        config['batchCarry']['innerCapAfterApproval'] = carry['priorInnerRequests'] + carry['innerRemaining'] - 4
    entries = [*agent_entries(),
               {'id': 'delivery-json-extension', 'name': '@deepseek-ai/dsh-deepseek-llm-api-extensions'},
               {'id': 'delivery-json', 'name': '@dual-loop/dsh-plugin/json-output',
                'config': {'artifactRoot': str(host.output / 'json-output'), 'includeCallerSessions': True}},
               {'id': 'delivery-journal', 'name': '@dual-loop/dsh-plugin/journal', 'config': {'root': str(host.output / 'journal')}},
               {'id': 'delivery-budget', 'name': '@dual-loop/dsh-plugin/budget'},
               {'id': 'delivery-app', 'name': './dsh_maturation_delivery.js', 'config': config},
               {'id': 'delivery-report-tool', 'name': '@dual-loop/dsh-plugin/observer-tools'}]
    if live:
        entries.append({'id': 'delivery-provider', 'name': '@deepseek-ai/dsh-llm-deepseek',
                        'config': {'apiKeyEnv': 'DEEPSEEK_API_KEY', 'thinking': 'disabled', 'maxTokens': 2048,
                                   'retryPolicy': {'mode': 'normal', 'maxRetries': 0}}})
    profile_name = 'duo-retained-caller-delivery'
    profile = host.stage(profile_name, [{'insert': entries}], ['dsh_maturation_delivery.js'])
    process = host.boot(profile_name, timeout=60)
    if process.returncode == 0 and live:
        before = {'maxModelRequests': carry['batchMaxRequests'], 'maxCostCny': carry['batchMaxCostCny'],
                  'callerRequestCap': carry['priorCallerRequests'] + carry['callerRemaining'],
                  'innerRequestCap': carry['priorInnerRequests'] + carry['innerRemaining']}
        after = {**before, 'callerRequestCap': before['callerRequestCap'] + 4, 'innerRequestCap': before['innerRequestCap'] - 4}
        inputs = [host.output / name for name in ['source.json', 'seed.json', 'statuses.json', 'prepare-plan.json']]
        inputs += [ROOT / 'scripts/research/run_maturation_delivery.py', ROOT / 'scripts/research/maturation_batch.py', profile / 'dsh_maturation_delivery.js', *map(Path, source_hashes), *map(Path, carry['sourceHashes']), args.pricing.resolve()]
        prepared = seal_manifest({'status': 'PREPARED_NOT_AUTHORIZED', 'scope': 'native-maturation-report-delivery',
                    'currency': 'CNY', 'maxModelRequests': 4, 'maxCostCny': 1, 'batchCarry': carry,
                    'continuationInput': str(args.continuation_input.resolve()), 'before': before, 'after': after,
                    'profile': profile_name, 'dshPackage': str(host.dsh),
                    'planDigest': READ(host.output / 'prepare-plan.json')['planDigest'],
                    **freeze_profile_inputs(host, profile, inputs)})
        save(host.output / 'prepared.json', prepared)
        save(host.output / 'authorization-template.json', {k: prepared[k] for k in ['scope', 'currency', 'maxModelRequests', 'maxCostCny', 'before', 'after', 'planDigest', 'manifestDigest']} | {'batch': carry['batch'], 'approvedBy': '', 'authorizationText': ''})
    print(args.mode, 'delivery exit:', process.returncode, 'output:', host.output)
    return process.returncode


if __name__ == '__main__':
    raise SystemExit(main())
