#!/usr/bin/env python3
"""Offline ExecutorService acceptance through actual named DSH profiles."""
import argparse
import json
from pathlib import Path
from dsh_model_profile import Profile, agent_entries, save


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dsh-package', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    host = Profile(args.dsh_package, args.output)
    host.pack()
    dataset = {'version': 1}
    for tier in ['fast', 'slow', 'final']:
        dataset[tier] = {'id': tier + '-v1', 'tasks': [{'id': tier + '-1', 'input': 'FINAL_HELD_OUT' if tier == 'final' else tier.upper() + '_INPUT', 'expected': 'SECRET_KEY_' + tier}]}
    dataset_path = host.output / 'dataset.json'
    save(dataset_path, dataset)
    results = []
    for scenario in ['normal', 'missing-usage', 'cancel']:
        name = 'duo-executor-' + scenario
        out = host.output / name
        out.mkdir()
        config = {'provider': 'duo-offline', 'model': 'fixture', 'datasetPath': str(dataset_path),
                  'artifactRoot': str(out / 'sessions'), 'maxTokens': 64, 'timeoutMs': 5000,
                  'reservationUsd': .01, 'evidenceKind': 'fixture',
                  'pricing': {'id': 'synthetic-test-only', 'inputUsdPerMillion': 1, 'cacheReadUsdPerMillion': .1, 'outputUsdPerMillion': 2}}
        entries = agent_entries() + [
            {'id': 'fixture', 'name': './dsh_model_fixture.js', 'config': {'scenario': scenario}},
            {'id': 'executor', 'name': '@dual-loop/dsh-plugin/model-executor', 'config': config},
            {'id': 'journal', 'name': '@dual-loop/dsh-plugin/journal', 'config': {'root': str(out / 'journal')}},
            {'id': 'budget', 'name': '@dual-loop/dsh-plugin/budget'},
            {'id': 'acceptance', 'name': './dsh_model_executor_host.js', 'config': {'scenario': scenario, 'output': str(out)}}]
        host.stage(name, [{'insert': entries}], ['dsh_model_fixture.js', 'dsh_model_executor_host.js'])
        r = host.boot(name)
        receipt_path = out / 'receipt.json'
        receipt = json.loads(receipt_path.read_text()) if receipt_path.exists() else {'status': 'NO_RECEIPT'}
        results.append({'scenario': scenario, 'exitCode': r.returncode, 'receipt': receipt})
        print(name, r.returncode, receipt['status'], flush=True)
    passed = all(r['exitCode'] == 0 and r['receipt']['status'] == 'PASS' for r in results)
    save(host.output / 'report.json', {'status': 'PASS' if passed else 'FAIL', 'profiles': results,
        'sourceHashes': host.sources, 'paidCalls': 0, 'evidenceKind': 'fixture',
        'limitation': 'Actual DSH CLI and Agent lifecycle, deterministic external model adapter, synthetic usage and prices. No real optimization or expense.'})
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
