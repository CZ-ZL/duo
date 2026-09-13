#!/usr/bin/env python3
"""One-shot diagnostic profile; reuses DSH Agent, native Journal and budget services.

No optimization or Calling Agent acceptance is claimed by this entry. The parent
diagnostic directory contains a frozen contract, approval and an opening ledger.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
from dsh_model_profile import (Profile, ROOT, agent_entries, save, sha,
    seal_manifest, manifest_digest, module_inventory, freeze_profile_inputs)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--mode', choices=['offline', 'prepare-live', 'execute'], required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--diagnostic-root', type=Path, required=True)
    p.add_argument('--dsh-package', type=Path)
    p.add_argument('--missing-usage', action='store_true')
    p.add_argument('--evaluator-plugin', action='store_true', help='Prepare calibration through the optional /semantic-evaluators service')
    a = p.parse_args()
    parent, out = a.diagnostic_root.resolve(), a.output.resolve()
    if a.missing_usage and a.mode != 'offline':
        p.error('Missing usage is an offline control only')
    if a.mode == 'execute':
        f = json.loads((out / 'prepared.json').read_text())
        if f['diagnosticRoot'] != str(parent) or manifest_digest(f) != f['manifestDigest']:
            p.error('Frozen manifest/root mismatch')
        for file, expected in f['fileHashes'].items():
            if sha(Path(file)) != expected:
                p.error('Frozen input changed: ' + file)
        if any(Path(x).exists() or Path(x).is_symlink() for x in f['absentPaths']):
            p.error('Unexpected ambient configuration')
        if module_inventory(f['moduleInventory']) != f['moduleInventory']:
            p.error('Runtime module inventory changed')
        auth = json.loads((parent / 'authorization.json').read_text())
        allocation = json.loads((parent / 'paid-allocation.json').read_text())
        opening = json.loads((parent / 'opening-cost-summary.json').read_text())
        if (auth['approvedBy'] != 'user' or auth['maxAdditionalRequests'] < 1 or
                auth['maxAdditionalCostNanoCny'] < 150000000 or allocation['maxModelRequests'] != 1 or
                allocation['maxCostCny'] != .15 or opening['currentBatch']['modelRequests'] + 1 > 56 or
                opening['currentBatch']['costNanoCny'] + 150000000 > 4000000000):
            p.error('One-call allocation exceeds recorded batch authorization')
        if sha(Path(auth['priorLedger'])) != auth['priorLedgerSha256']:
            p.error('Opening ledger changed; reconcile current usage before calling')
        for file, expected in opening['sourceReceiptHashes'].items():
            if sha(ROOT / file) != expected:
                p.error('Prior batch receipt changed; reconcile first')
        if json.loads((parent / 'pricing.json').read_text())['verifiedDate'] != datetime.now(timezone.utc).date().isoformat():
            p.error('Pricing date stale')
        if not os.environ.get('DEEPSEEK_API_KEY'):
            p.error('DEEPSEEK_API_KEY absent; no request made')
        # A shared parent claim prevents spending a second call through a new output directory.
        with (parent / 'paid-execution-claim.json').open('x') as claim:
            json.dump({'manifestDigest': f['manifestDigest'], 'output': str(out), 'requestsReserved': 1,
                'reservedCostNanoCny': 150000000, 'pid': os.getpid()}, claim)
            claim.flush(); os.fsync(claim.fileno())
        host = object.__new__(Profile)
        host.output, host.dsh, host.node = out, Path(f['dshPackage']), shutil.which('node')
        host.commands = json.loads((out / 'commands.json').read_text())
        host.env = {'PATH': str(Path(host.node).parent) + os.pathsep + os.defpath,
            'DSH_HOME': str(out / 'dsh-home'), 'DSH_TELEMETRY_DISABLED': '1',
            'DUO_MODEL_RUN_ENABLED': '1', 'DEEPSEEK_API_KEY': os.environ['DEEPSEEK_API_KEY']}
        r = host.execute('authorized-live', [host.node, str(host.dsh / 'lib/bin.js'), '--profile', f['profile']], timeout=120)
        print('live exit:', r.returncode, 'retained output:', out)
        return r.returncode

    if not a.dsh_package:
        p.error('Use an existing cached DSH package')
    host = Profile(a.dsh_package, out)
    live = a.mode == 'prepare-live'
    prices = json.loads((parent / 'pricing.json').read_text())
    if live and prices['verifiedDate'] != datetime.now(timezone.utc).date().isoformat():
        p.error('Refresh official CNY pricing before live preparation')
    controls = json.loads((parent / 'controls.frozen.json').read_text())
    model = {'provider': 'deepseek-official' if live else 'duo-offline',
        'model': 'deepseek-v4-flash' if live else 'fixture', 'datasetPath': controls['taskSource'],
        'artifactRoot': str(out / 'sessions'), 'evidenceKind': 'model' if live else 'fixture',
        'maxTokens': 4096, 'maxInputBytes': 32768, 'timeoutMs': 90000 if live else 5000,
        'currency': 'CNY', 'reservationCny': .15, 'pricing': prices if live else {
            'id': 'synthetic-only', 'currency': 'CNY', 'inputCnyPerMillion': 3,
            'cacheReadCnyPerMillion': .1, 'outputCnyPerMillion': 9}}
    if a.evaluator_plugin:
        model.update(policyPath=str(parent / 'policy.json'), judgmentRoot=str(out / 'judgments'))
    entries = agent_entries() + [
        {'id': 'journal', 'name': '@dual-loop/dsh-plugin/journal', 'config': {'root': str(out / 'journal')}},
        {'id': 'budget', 'name': '@dual-loop/dsh-plugin/budget'},
    ]
    if live:
        entries += [
            {'id': 'deepseek-extensions', 'name': '@deepseek-ai/dsh-deepseek-llm-api-extensions'},
            {'id': 'duo-json-output', 'name': '@dual-loop/dsh-plugin/json-output', 'config': {'artifactRoot': str(out / 'request-formats')}},
            {'id': 'deepseek', 'name': '@deepseek-ai/dsh-llm-deepseek', 'config': {'apiKeyEnv': 'DEEPSEEK_API_KEY', 'thinking': 'disabled', 'maxTokens': 4096}},
        ]
    host_script = 'dsh_semantic_evaluator_host.js' if a.evaluator_plugin else 'dsh_semantic_diagnostic_host.js'
    if a.evaluator_plugin:
        entries.append({'id': 'semantic-evaluator', 'name': '@dual-loop/dsh-plugin/semantic-evaluators', 'config': model})
    entries.append({'id': 'diagnostic', 'name': './' + host_script, 'config': {
        'output': str(out), 'contractPath': str(parent / 'semantic-contract.frozen.json'),
        'offline': not live, 'missingUsage': a.missing_usage, 'model': model}})
    host.pack()
    name = 'duo-semantic-diagnostic'
    profile = host.stage(name, [{'insert': entries}], [host_script])
    result = host.boot(name, timeout=30)
    if live and result.returncode == 0:
        inputs = [parent / n for n in ['semantic-contract.frozen.json', 'authorization.json', 'paid-allocation.json',
            'opening-cost-summary.json', 'controls.frozen.json', 'pricing.json']]
        inputs += [Path(controls['taskSource']), profile / host_script, Path(__file__).resolve()]
        if a.evaluator_plugin:
            inputs.append(parent / 'policy.json')
        save(out / 'prepared.json', seal_manifest({'scope': 'one-request-semantic-diagnostic',
            'profile': name, 'diagnosticRoot': str(parent), 'dshPackage': str(host.dsh),
            'maxModelRequests': 1, 'maxCostCny': .15, 'currency': 'CNY',
            **freeze_profile_inputs(host, profile, inputs)}))
    print(a.mode, 'exit:', result.returncode, 'output:', out)
    return result.returncode


if __name__ == '__main__':
    raise SystemExit(main())
