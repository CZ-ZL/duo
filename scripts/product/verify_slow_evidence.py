"""Bounded zero-model product acceptance through shipped DSH/DUO public tools.
No candidate benchmark, credentials, historic inputs or method-benefit claim.
"""
import argparse
import json
from pathlib import Path
import subprocess


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--package', type=Path, required=True)
    p.add_argument('--dsh-package', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    out = a.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    cli = a.package.resolve() / 'bin/duo.mjs'
    commands, checks, results = [], [], []

    def save(name, value):
        (out / name).write_text(json.dumps(value, indent=2) + '\n')

    def command(args):
        r = subprocess.run(['node', str(cli), *args], capture_output=True, text=True, timeout=75)
        i = len(commands) + 1
        (out / f'{i:03}.stdout').write_text(r.stdout)
        (out / f'{i:03}.stderr').write_text(r.stderr)
        commands.append({'args': args, 'exitCode': r.returncode})
        save('commands.json', commands)
        assert r.stdout, (args, r.stderr)
        return json.loads(r.stdout)

    def call(root, tool, args=None):
        return command(['call', '--root', str(root), '--tool', tool, '--args', json.dumps(args or {})])

    def value(response):
        assert response.get('isError') is False, response
        return response['value']

    def check(label, condition):
        assert condition, label
        checks.append(label)
        save('checks.json', checks)

    try:
        for mode in ['basic', 'expanded', 'auto-unavailable', 'dual-unavailable']:
            root = out / mode
            command(['init', '--root', str(root), '--dsh-package', str(a.dsh_package.resolve()), '--example', 'dual' if mode == 'expanded' else 'optimize'])
            path = root / 'experiment.json'
            draft = json.loads(path.read_text())
            if mode.endswith('unavailable'):
                draft['preset'] = 'optimize-auto' if mode.startswith('auto') else 'optimize-dual'
                draft['slow'] = {**draft['fast'], 'evaluatorId': 'local-slow', 'dataId': 'local-text-slow'}
                path.write_text(json.dumps(draft, indent=2) + '\n')
            original = (root / 'target.txt').read_bytes()
            description = value(call(root, 'dualloop_describe'))
            check(mode + ': describes current evidence availability', 'slow_mode' in description['evidenceStrategy'])
            check(mode + ': discovers public modes', 'optimize-basic' in description['presets'] and 'optimize-dual' in description['presets'])
            prepared = value(call(root, 'dualloop_design', {'draft': draft, 'experimentPath': str(path)}))
            if mode == 'dual-unavailable':
                check('forced dual gives preparation', not prepared['readyForPlan'] and prepared['evidenceStrategy']['recommended_mode'] == 'preparation_required')
                refused = call(root, 'dualloop_plan')
                check('forced dual refuses before execution', refused['isError'] and 'DUO_ADDITIONAL_EVIDENCE_REQUIRED' in json.dumps(refused))
                check('forced dual did not create a run ledger', not list((root / 'journal').rglob('journal.sqlite')))
                continue
            plan = value(call(root, 'dualloop_plan', {'view': 'summary'}))
            expected = 'expanded_evidence' if mode == 'expanded' else 'unavailable'
            check(mode + ': prepare and plan agree', prepared['readyForPlan'] and prepared['evidenceStrategy']['slow_mode'] == plan['evidenceStrategy']['slow_mode'] == expected)
            result = value(call(root, 'dualloop_run', {'planDigest': plan['planDigest']}))
            report = value(call(root, 'dualloop_report', {'runId': plan['runId'], 'includeEvents': True, 'view': 'summary'}))
            check(mode + ': actual run and report agree', result['status'] == 'completed' and result['slow_mode'] == report['slow_mode'] == expected)
            check(mode + ': no owner target writes or fees', (root / 'target.txt').read_bytes() == original and result['budget']['costCny'] == 0)
            check(mode + ': no efficacy claim', not result['improvementProven'] and not report['improvementProven'])
            events = [json.loads(row) for row in report['journalJsonl'].splitlines()]
            check(mode + ': Journal source/version receipts', any(e['kind'] == 'evidence_acquired' and e['receipt']['source']['version'] == '1' for e in events))
            if mode == 'expanded':
                requests = [e for e in events if e['kind'] == 'evidence_decision' and e['decision']['action'] == 'request_more_evidence']
                check('expanded: acquisition requested before Slow work', requests and events.index(requests[0]) < next(i for i,e in enumerate(events) if e['kind'] == 'evidence_acquired' and e['receipt']['tier'] == 'slow'))
                check('expanded: actual extra coverage and decision', result['additional_evidence_acquired'] and any('required-template' in r['coverage'] for r in result['additional_evidence_acquired']) and result['decision_basis'])
            else:
                check(mode + ': no redundant Slow execution', result['budget']['slowAttempts'] == 0 and result['additional_evidence_acquired'] == [])
            if mode == 'auto-unavailable':
                check('auto: no silent downgrade', plan['evidenceStrategy']['downgrade']['to'] == result['downgrade']['to'] == 'single_fidelity' and any(e['kind'] == 'evidence_strategy' and e['strategy']['downgrade'] for e in events))
            results.append({'mode': mode, 'runId': plan['runId'], 'result': result})
            save(mode + '-report.json', report)
        save('report.json', {'status': 'PASS', 'checks': checks, 'steps': len(commands), 'runs': results, 'modelRequests': 0, 'costCny': 0, 'scope': 'Deterministic scripted product behavior; not independent Caller or method proof'})
        print(json.dumps({'status': 'PASS', 'checks': len(checks), 'steps': len(commands)}))
    except Exception as error:
        save('report.json', {'status': 'FAIL', 'checks': checks, 'steps': len(commands), 'completedRuns': results, 'error': str(error), 'modelRequests': 0})
        raise


if __name__ == '__main__':
    main()
