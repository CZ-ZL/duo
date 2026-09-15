#!/usr/bin/env python3
"""Native original/single/dual comparison: prepare all arms before paid admission.

Uses the existing named-profile model entry, native controller and CNY ledger.
No result-driven arm selection, retries, budget transfer, or legacy orchestration.
"""
import argparse
from decimal import Decimal
import json
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone
from dsh_model_profile import ROOT, save, sha
from prepare_native_comparison import prepare_comparison


def read(path):
    return json.loads(path.read_text())


def digest(value):
    import hashlib
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def summarize(out, protocol):
    rows = []
    for arm in protocol['arms']:
        directory = out / arm['directory']
        result_path = directory / 'result.json'
        try:
            result, receipt = read(result_path), read(directory / 'run-receipt.json')
        except (OSError, ValueError):
            result = receipt = None
        if result is None or receipt is None:
            sessions, receipt_errors = [], []
            for path in sorted((directory / 'sessions').glob('*.json')):
                try:
                    s = read(path)
                    if not isinstance(s, dict):raise ValueError()
                    cost = s.get('costCny')
                    if cost is not None and (type(cost) not in [float, int] or not Decimal(str(cost)).is_finite() or cost < 0):raise ValueError()
                    attempts = s.get('costEvidence', {}).get('attempts', 0)
                    if type(attempts) != int or attempts < 0:raise ValueError()
                    sessions.append(s)
                except (OSError, ValueError, TypeError, AttributeError):
                    receipt_errors.append(path.name + ': invalid receipt JSON')
            known = sum((Decimal(str(s['costCny'])) for s in sessions if s.get('currency') == 'CNY' and s.get('costCny') is not None), Decimal(0))
            attempted = result_path.exists() or bool(sessions) or bool(receipt_errors) or (directory / 'execution-claim.json').exists() or (directory / 'journal').exists()
            rows.append({**arm, 'status': 'UNCERTAIN' if attempted else 'NOT_RUN', 'costCny': None,
                'knownCostCny': float(known) if protocol['live'] else 0,
                'knownPaidCalls': sum(s.get('costEvidence', {}).get('attempts', 0) for s in sessions) if protocol['live'] else 0,
                'paidCalls': None if attempted and protocol['live'] else 0, 'receiptErrors': receipt_errors,
                'accountingNote': 'Partial receipts are retained; missing terminal receipt cannot establish complete cost or request count.'})
            continue
        final = result.get('final', [])
        selected = result.get('proxyLeaderId') or result.get('championId') or 'baseline'
        by_id = {r['candidateId']: r for r in final}
        verdicts = result.get('independentFinal', {}).get('comparison', {}).get('verdicts', {}) if result.get('independentFinal') else {}
        valid_score = lambda id_: by_id.get(id_, {}).get('metrics', {}).get('quality') if verdicts.get(id_) in ['better', 'not_better'] else None
        score, base = valid_score(selected), valid_score('baseline')
        rows.append({**arm, 'status': result['status'], 'planDigest': result['planDigest'], 'selectedId': selected,
            'finalScore': score, 'baselineFinalScore': base,
            'deltaVsWithinArmBaseline': score-base if score is not None and base is not None else None,
            'independentFinal': result.get('independentFinal'), 'conclusion': result['conclusion'],
            'costCny': receipt['costCny'], 'syntheticCostCny': receipt['syntheticCostCny'],
            'knownCostCny': result['budget']['knownCostCny'] if protocol['live'] else 0,
            'modelRequests': receipt['modelRequests'], 'paidCalls': receipt['paidCalls'],
            'wallTimeMs': receipt['wallTimeMs'], 'phases': result['budget'].get('phases'),
            'runReceiptSha256': sha(directory / 'run-receipt.json')})
    complete = bool(rows) and all(r['status'] == 'completed' and r.get('finalScore') is not None and r.get('costCny') is not None for r in rows)
    known = [Decimal(str(r['knownCostCny'])) for r in rows]
    statistics = {}
    for name in ['baseline', 'single_loop', 'dual_loop']:
        selected = [r for r in rows if r['arm'] == name and r.get('finalScore') is not None]
        scores = [r['finalScore'] for r in selected]
        statistics[name] = {'validRepeats': len(scores), 'scores': scores,
            'mean': sum(scores)/len(scores) if scores else None, 'range': max(scores)-min(scores) if scores else None,
            'regressionsVsWithinArmBaseline': sum(r['deltaVsWithinArmBaseline'] < 0 for r in selected if r.get('deltaVsWithinArmBaseline') is not None),
            'resourcesAtThreshold': [{'repeat':r['repeat'],'costCny':r['costCny'],'modelRequests':r['modelRequests']} for r in selected if r['finalScore'] >= protocol.get('threshold', 1)]}
    report = {'status': 'COMPLETED' if complete else 'INCOMPLETE', 'evidenceKind': 'model' if protocol['live'] else 'fixture',
        'currency': 'CNY', 'knownCostCny': float(sum(known, Decimal(0))),
        'totalCostCny': float(sum(known, Decimal(0))) if complete else None,
        'paidCalls': sum(r.get('paidCalls', 0) for r in rows) if all(r.get('paidCalls') is not None for r in rows) else None,
        'knownPaidCalls': sum(r.get('paidCalls') or r.get('knownPaidCalls', 0) for r in rows), 'arms': rows, 'statistics': statistics,
        'improvementProven': False, 'protocolDigest': digest(protocol),
        'limitations': ['Two paired repetitions are descriptive, not statistically conclusive.',
            'Lexical supplied-context scoring is not general semantic or retrieval quality.',
            'Threshold resources are terminal totals, not first-hit cost during search.',
            'Baseline arm also measures fast/slow calibration; it generates no candidates.',
            'A failed/uncertain arm remains visible; no automatic repair or replacement batch.']}
    save(out / 'comparison-result.json', report)
    return report


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--mode', choices=['offline', 'prepare-live', 'execute', 'inspect'], required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--dsh-package', type=Path)
    p.add_argument('--pricing', type=Path)
    p.add_argument('--authorization', type=Path)
    args = p.parse_args()
    out = args.output.resolve()
    if args.mode in ['execute', 'inspect']:
        protocol = read(out / 'comparison-protocol.json')
        if args.mode == 'inspect':
            print(json.dumps(summarize(out, protocol), ensure_ascii=False));return 0
        frozen = read(out / 'comparison-prepared.json')
        if (out / 'comparison-result.json').exists() and read(out / 'comparison-result.json')['status'] == 'COMPLETED':
            print('Retained completed comparison; no new model calls');return 0
        if (out / 'execution-claim.json').exists():
            p.error('Existing batch claim: inspect every arm and its accounting; no automatic replay')
        if not args.authorization:
            p.error('Explicit CNY allocation required; review authorization-template.json')
        auth = read(args.authorization)
        if (auth.get('scope') != 'native-three-arm-comparison' or auth.get('approvedBy') != 'user' or
                not auth.get('authorizationText') or auth.get('currency') != 'CNY' or 'maxCostUsd' in auth or
                auth.get('planDigest') != frozen['planDigest'] or
                type(auth.get('maxCostCny')) not in [int, float] or auth['maxCostCny'] != 3 or
                type(auth.get('maxModelRequests')) != int or auth['maxModelRequests'] != 40):
            p.error('Authorization does not match the frozen CNY 3 / 40 request comparison allocation')
        if digest({k:v for k,v in frozen.items() if k != 'planDigest'}) != frozen['planDigest']:
            p.error('Prepared comparison manifest digest mismatch; no model calls')
        for path, expected in frozen['fileHashes'].items():
            if sha(Path(path)) != expected:p.error('Prepared comparison input changed: ' + path)
        if not os.environ.get('DEEPSEEK_API_KEY'):
            p.error('DEEPSEEK_API_KEY is absent; no model calls')
        with (out / 'execution-claim.json').open('x') as file:
            json.dump({'authorizationSha256': sha(args.authorization), 'planDigest': frozen['planDigest']}, file)
            file.flush();os.fsync(file.fileno())
        for row in protocol['arms']:
            directory = out / row['directory'];child = read(directory / 'prepared.json')
            child_auth = {**auth, 'scope': 'native-comparison-arm', 'planDigest': child['planDigest'],
                'manifestDigest': child['manifestDigest'],
                'maxCostCny': row['maxCostCny'], 'maxModelRequests': row['maxModelRequests'],
                'parentPlanDigest': frozen['planDigest'], 'parentAuthorizationSha256': sha(args.authorization)}
            save(directory / 'comparison-authorization.json', child_auth)
            cmd = [sys.executable, str(ROOT / 'scripts/research/run_dsh_model.py'), '--mode', 'execute', '--output', str(directory),
                   '--authorization', str(directory / 'comparison-authorization.json')]
            r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
            (directory / 'comparison-execute.stdout.txt').write_text(r.stdout)
            (directory / 'comparison-execute.stderr.txt').write_text(r.stderr)
            report = summarize(out, protocol)
            if r.returncode:return r.returncode
        return 0 if report['status'] == 'COMPLETED' else 2

    if not args.dsh_package:p.error('Use an existing cached --dsh-package; no install')
    live = args.mode == 'prepare-live'
    if live and not args.pricing:p.error('Provide a freshly verified official CNY --pricing file')
    out.mkdir(parents=True, exist_ok=False)
    prepare_comparison(out / 'inputs')
    arms = []
    caps = {'baseline': 3, 'single_loop': 7, 'dual_loop': 10}
    for repeat, order in [(1, ['baseline', 'single_loop', 'dual_loop']), (2, ['dual_loop', 'single_loop', 'baseline'])]:
        for arm in order:arms.append({'arm': arm, 'repeat': repeat, 'directory': f'repeat-{repeat}-{arm}', 'maxCostCny': .5, 'maxModelRequests': caps[arm]})
    protocol = {'version': 1, 'live': live, 'currency': 'CNY', 'maxCostCny': 3, 'maxModelRequests': 40,
        'arms': arms, 'metric': 'quality', 'direction': 'maximize', 'epsilon': .01, 'threshold': 1,
        'generations': 2, 'candidatesPerGeneration': 1, 'repeats': 2,
        'shared': ['initial persona', 'dataset splits', 'model', 'generator', 'evaluator', 'comparison rule', 'per-arm CNY cap'],
        'differences': {'baseline': 'No generation; fast and slow calibration plus final.',
            'single_loop': 'Fast-only search and incumbent update; no slow selection or feedback; independent final afterward.',
            'dual_loop': 'Existing fast/slow protocol and feedback; independent final afterward.'},
        'budgetPolicy': 'Identical .5 CNY monetary ceilings; request safety caps differ with protocol maximum work. Unused caps are not transferred.',
        'dataSha256': sha(out / 'inputs/dataset.json'), 'personaSha256': sha(out / 'inputs/persona.txt'),
        'finalPolicy': 'Same final questions across frozen arms/repeats; no cross-arm result input or post-result configuration changes.',
        'pricingSha256': sha(args.pricing) if args.pricing else None}
    save(out / 'comparison-protocol.json', protocol)
    for row in arms:
        cmd = [sys.executable, str(ROOT / 'scripts/research/run_dsh_model.py'), '--mode', args.mode, '--output', str(out / row['directory']),
               '--dsh-package', str(args.dsh_package.resolve()), '--dataset', str(out / 'inputs/dataset.json'),
               '--arm', row['arm'], '--candidates-per-generation', '1', '--max-cost-cny', '.5', '--max-model-requests', str(row['maxModelRequests'])]
        if args.pricing:cmd += ['--pricing', str(args.pricing.resolve())]
        r = subprocess.run(cmd, cwd=ROOT, env={'PATH': os.environ['PATH']}, capture_output=True, text=True)
        (out / (row['directory'] + '.stdout.txt')).write_text(r.stdout)
        (out / (row['directory'] + '.stderr.txt')).write_text(r.stderr)
        if r.returncode:return r.returncode
    if not live:
        report = summarize(out, protocol)
        print('Offline comparison:', report['status'], 'paid calls:', report['paidCalls'])
        return 0 if report['status'] == 'COMPLETED' else 2
    files = [out / 'comparison-protocol.json', *sorted((out / 'inputs').glob('*')),
             *[out / r['directory'] / 'prepared.json' for r in arms],
             ROOT / 'scripts/research/run_native_comparison.py', ROOT / 'scripts/research/prepare_native_comparison.py', ROOT / 'scripts/research/prepare_native_docs_mini.py']
    frozen = {'status': 'PREPARED_NOT_AUTHORIZED', 'scope': 'native-three-arm-comparison', 'currency': 'CNY',
        'maxCostCny': 3, 'maxModelRequests': 40, 'fileHashes': {str(path): sha(path) for path in files}}
    frozen['planDigest'] = digest(frozen)
    save(out / 'comparison-prepared.json', frozen)
    save(out / 'authorization-template.json', {'scope': frozen['scope'], 'planDigest': frozen['planDigest'], 'currency': 'CNY',
        'maxCostCny': 3, 'maxModelRequests': 40, 'approvedBy': None, 'authorizationText': None})
    print('Prepared all six native arms; zero model calls; CNY 3 / 40 requests pending allocation')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
