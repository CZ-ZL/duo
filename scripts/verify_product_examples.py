"""Acceptance of installed public examples through actual DSH CLI/ToolRuntime.

Deterministic scripted product acceptance; not autonomous Caller judgment or method
benefit. No source imports, private profiles, credentials or historical ledgers.
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
    commands, checks = [], []

    def save(name, value):
        (out / name).write_text(json.dumps(value, indent=2) + '\n')

    def execute(command, expected_error=False):
        r = subprocess.run(['node', str(cli), *command], text=True, capture_output=True, timeout=75)
        i = len(commands) + 1
        (out / f'{i:03}-stdout.txt').write_text(r.stdout)
        (out / f'{i:03}-stderr.txt').write_text(r.stderr)
        commands.append({'step': i, 'args': command, 'exitCode': r.returncode, 'expectedError': expected_error})
        save('commands.json', commands)
        assert (r.returncode != 0) == expected_error, (command, r.stderr[-2000:], r.stdout[-2000:])
        return json.loads(r.stdout)

    def call(root, tool, payload=None, error=False, cancel=None):
        command = ['call', '--root', str(root), '--tool', tool, '--args', json.dumps(payload or {})]
        if cancel is not None:
            command += ['--cancel-after-ms', str(cancel)]
        r = execute(command, error)
        return r if error else r['value']

    def check(label, condition):
        assert condition, label
        checks.append(label)
        save('checks.json', checks)

    def init(example, label=None):
        root = out / (label or example)
        execute(['init', '--root', str(root), '--dsh-package', str(args.dsh_package.resolve()), '--example', example])
        return root

    try:
        for example in ['setup', 'evaluate', 'optimize', 'byo', 'replace', 'warm', 'custom']:
            root = init(example)
            description = call(root, 'dualloop_describe')
            check(example + ': catalog includes config support', 'dsh-plugin-config' in description['targetKinds'])
            schemas = call(root, 'schemas')
            if example == 'setup':
                check('default setup has no work providers or run tool', not any(s['name'] == 'dualloop_run' for s in schemas))
                continue
            original = (root / 'target.txt').read_bytes()
            plan = call(root, 'dualloop_plan', {'view': 'summary'})
            check(example + ': CNY0 authorized local scope', plan['spec']['budget']['maxCostCny'] == 0 and not plan['spec']['permissions']['paid'])
            if example == 'byo':
                check('BYO function wired', plan['providers']['evaluators'][0]['implementationDigest'] == 'byo-text-check-v1')
            if example == 'replace':
                check('history component replaced', plan['providers']['policies']['duoFeedback']['historyOrder'] == 'recent_failures_first')
            if example == 'custom':
                check('custom target does not require persona/config', 'content' in plan['baseline'] and 'persona' not in plan['baseline'])
            result = call(root, 'dualloop_run', {'planDigest': plan['planDigest']})
            report = call(root, 'dualloop_report', {'runId': plan['runId']})
            before = call(root, 'dualloop_budget_status', {'runId': plan['runId']})
            call(root, 'dualloop_report', {'runId': plan['runId']})
            replay = call(root, 'dualloop_run', {'planDigest': plan['planDigest']})
            after = call(root, 'dualloop_budget_status', {'runId': plan['runId']})
            check(example + ': complete and retained target', result['status'] == 'completed' and (root / 'target.txt').read_bytes() == original)
            check(example + ': report/replay does not charge again', before == after and replay['reusedArtifacts'])
            check(example + ': actual known zero cost', before['budget']['costCny'] == 0 and before['budget']['reservedCostCny'] == 0)
            check(example + ': no method-benefit claim', not report['improvementProven'])
            check(example + ': correct generation mode', result['generationsRun'] == (0 if example == 'evaluate' else 2))
            if example == 'warm':
                contract = json.loads((root / 'experiment.json').read_text())
                contract.update(id='second-warm-run', warmStart={'runIds': [plan['runId']]})
                (root / 'experiment.json').write_text(json.dumps(contract))
                warm = call(root, 'dualloop_plan')
                check('warm plan uses screened local history', warm['warmStart']['mode'] == 'warm_start' and bool(warm['warmStart']['context']['records']))
                second = call(root, 'dualloop_run', {'planDigest': warm['planDigest']})
                report = call(root, 'dualloop_report', {'runId': warm['runId']})
                check('warm generation receives and records historical ids', any('Historical ideas received:' in (c['hypothesis'] or '') for c in report['candidates']))
                check('warm does not import costs', second['historyReuse']['priorCostsImported'] is False and second['budget']['costCny'] == 0)

        root = init('optimize', 'recovery')
        plan = call(root, 'dualloop_plan')
        paused = call(root, 'dualloop_run', {'planDigest': plan['planDigest'], 'pauseAfter': 'baseline'})
        state = call(root, 'dualloop_status', {'runId': plan['runId']})
        refusal = call(root, 'dualloop_run', {'planDigest': plan['planDigest']}, error=True)
        details = json.loads(refusal['content'][0]['text'])['error']
        check('structured failure carries cause/action/recovery/cost/effects', all(k in details for k in ['cause', 'nextAction', 'recoverability', 'costState', 'sideEffectState']))
        resumed = call(root, 'dualloop_run', {'planDigest': plan['planDigest'], 'resumeFrom': paused['checkpointDigest']})
        final_state = call(root, 'dualloop_status', {'runId': plan['runId']})
        check('checkpoint recovers without renewed deadline', resumed['status'] == 'completed' and state['checkpoint']['deadlineAt'] == final_state['checkpoint']['deadlineAt'])
        check('baseline execution not duplicated on resume', resumed['stageAttempts']['fast'] == 2 and resumed['budget']['costCny'] == 0)

        root = init('optimize', 'budget-stop')
        contract = json.loads((root / 'experiment.json').read_text())
        contract['budget']['maxSessions'] = 1
        (root / 'experiment.json').write_text(json.dumps(contract))
        plan = call(root, 'dualloop_plan')
        result = call(root, 'dualloop_run', {'planDigest': plan['planDigest']})
        check('finite operation budget stops safely', result['status'] == 'failed' and result['budget']['operations'] == 1 and result['budget']['costCny'] == 0)

        root = init('optimize', 'cancel')
        plan = call(root, 'dualloop_plan')
        call(root, 'dualloop_run', {'planDigest': plan['planDigest']}, error=True, cancel=0)
        state = call(root, 'dualloop_status', {'runId': plan['runId']})
        check('pre-dispatch cancellation creates no run/cost', state['run'] is None and state['budget'] is None)
        save('report.json', {'status': 'PASS', 'checks': checks, 'steps': len(commands), 'profiles': 10,
            'modelRequests': 0, 'costCny': 0, 'implementerInterventionsDuringRun': 0,
            'evidenceKind': 'SCRIPTED_ACTUAL_DSH_PUBLIC_PACKAGE_ACCEPTANCE',
            'notClaimed': ['Independent Agent judgment', 'Model quality improvement', 'Registry install', 'Method superiority']})
        print(json.dumps({'status': 'PASS', 'checks': len(checks), 'steps': len(commands)}))
    except Exception as error:
        save('report.json', {'status': 'FAIL', 'checks': checks, 'steps': len(commands), 'error': str(error), 'modelRequests': 0, 'costCny': 0})
        raise


if __name__ == '__main__':
    main()
