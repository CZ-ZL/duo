"""Zero-model baseline-repair acceptance through the packaged DSH CLI.

Functional controls over local text; no business benchmark or optimization claim.
Each profile is new, bounded and caller-owned. Existing experiments are not read.
"""
import argparse
import json
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--dsh-package', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    cli = args.package.resolve() / 'bin/duo.mjs'
    commands, results = [], []

    def save(name, value):
        (out / name).write_text(json.dumps(value, indent=2) + '\n')

    def command(*argv):
        completed = subprocess.run(['node', str(cli), *argv], capture_output=True,
                                   text=True, timeout=75)
        number = len(commands) + 1
        (out / f'{number:03}.stdout').write_text(completed.stdout)
        (out / f'{number:03}.stderr').write_text(completed.stderr)
        commands.append({'argv': argv, 'exitCode': completed.returncode})
        save('commands.json', commands)
        assert completed.returncode == 0, (argv, completed.stderr, completed.stdout)
        return json.loads(completed.stdout)

    def call(root, tool, parameters=None):
        response = command('call', '--root', str(root), '--tool', tool,
                           '--args', json.dumps(parameters or {}))
        assert response.get('isError') is False, response
        return response['value']

    try:
        for case, example in [('basic', 'optimize'), ('expanded', 'dual'),
                              ('custom', 'custom'), ('unrepairable', 'optimize'),
                              ('budget-stop', 'optimize')]:
            root = out / case
            command('init', '--root', str(root), '--dsh-package',
                    str(args.dsh_package.resolve()), '--example', example)
            path = root / 'experiment.json'
            draft = json.loads(path.read_text())
            # Known functional controls: trimming achieves 1; >1 is impossible.
            draft['constraints'] = [{'metric': 'quality', 'op': '>' if case == 'unrepairable' else '==', 'value': 1}]
            draft['generations'] = 1
            if case == 'budget-stop':
                draft['budget']['maxSessions'] = 2
            path.write_text(json.dumps(draft, indent=2) + '\n')
            original = (root / 'target.txt').read_bytes()
            discovery = call(root, 'dualloop_describe')
            assert discovery['capabilities']['baselinePolicy']['qualityConstraintViolation'] == 'continue_repair'
            plan = call(root, 'dualloop_plan', {'view': 'summary'})
            assert plan['baselinePolicy']['qualityConstraintViolation'] == 'continue_repair'
            if case == 'basic':
                paused = call(root, 'dualloop_run', {'planDigest': plan['planDigest'], 'pauseAfter': 'baseline'})
                assert paused['status'] == 'paused', paused
                run_args = {'planDigest': plan['planDigest'], 'resumeFrom': paused['checkpointDigest']}
            else:
                run_args = {'planDigest': plan['planDigest']}
            result = call(root, 'dualloop_run', run_args)
            report = call(root, 'dualloop_report', {'runId': plan['runId'], 'includeEvents': True, 'view': 'summary'})
            save(case + '-report.json', report)
            assert result['baselineAssessment']['fast']['verdict'] == 'constraint_violation'
            assert result['baselineAssessment']['fast']['searchAllowed'] is True
            assert report['baselineAssessment'] == result['baselineAssessment']
            assert (root / 'target.txt').read_bytes() == original
            assert result['budget']['costCny'] == 0 and not result['improvementProven']
            events = [json.loads(row) for row in report['journalJsonl'].splitlines()]
            if case == 'budget-stop':
                assert result['status'] == 'failed' and result['stopReason'] == 'DUO_BUDGET_EXHAUSTED', result
                assert result['budget']['operations'] == 2
                assert not any(e['kind'] == 'generation' for e in events)
            else:
                assert result['status'] == 'completed', result
                assert result['selectionOutcome'] == ('no_feasible_candidate' if case == 'unrepairable' else 'feasible_candidate')
                if case == 'unrepairable':
                    assert result['selectedOverlay'] is None and result['proxyLeaderId'] is None
                else:
                    assert result['selectedOverlay'] is not None
                    assert any(e['kind'] == 'comparison' and 'constraint_feasibility' in e['comparison'].get('decisionBasis', {}).values() for e in events)
                assert result['budget']['operations'] == (9 if case == 'expanded' else 5)
            results.append({'case': case, 'runId': plan['runId'], 'result': result})
        save('RESULT.json', {'status': 'PASS', 'cases': len(results), 'commands': len(commands),
                             'modelRequests': 0, 'costCny': 0, 'runs': results,
                             'scope': 'Scripted packaged DSH product controls; not an independent Caller or method experiment'})
        print(json.dumps({'status': 'PASS', 'cases': len(results), 'commands': len(commands)}))
    except Exception as error:
        save('RESULT.json', {'status': 'FAIL', 'error': str(error), 'completedRuns': results,
                             'commands': len(commands), 'modelRequests': 0})
        raise


if __name__ == '__main__':
    main()
