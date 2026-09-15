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
                design = call(root, 'dualloop_design', {
                    'preset': 'evaluate', 'experimentPath': str(root / 'experiment.json'),
                    'draft': {'id': 'missing-measurement', 'target': {'kind': 'dsh-persona', 'path': str(root / 'target.txt')}},
                })
                build = next(a for a in design['preparation']['actions'] if a['kind'] == 'build_evaluator')
                for field in ['example', 'controlExample', 'controlContract', 'controlProfile']:
                    check('installed preparation resource exists: ' + field, (args.package / build[field]).is_file())
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
                check('custom target owns its baseline identity', plan['baseline']['id'] == 'original')
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

        # Reuse the shipped custom adapter and public CLI, with its nonstandard
        # baseline ID. Final here is a local plumbing control, not unseen data.
        for label, generations, operation in [('retained', 0, 'optimize'),
                                                ('selected', 1, 'optimize'),
                                                ('evaluate-final', 0, 'evaluate')]:
            root = init('custom', 'custom-id-' + label)
            contract = json.loads((root / 'experiment.json').read_text())
            contract.update(generations=generations, operation=operation,
                            preset='evaluate' if operation == 'evaluate' else 'optimize-basic')
            if operation == 'evaluate':
                contract['quotas'] = {'exploit': 0, 'explore': 0, 'innovate': 0}
            contract['final'] = {**contract['fast'], 'evaluatorId': 'local-final', 'dataId': 'local-text-final'}
            (root / 'experiment.json').write_text(json.dumps(contract))
            plan = call(root, 'dualloop_plan')
            result = call(root, 'dualloop_run', {'planDigest': plan['planDigest']})
            report = call(root, 'dualloop_report', {'runId': plan['runId']})
            ids = ['original', 'dl-0001'] if generations else ['original']
            check(label + ': custom baseline final identity is measured once',
                  result['status'] == 'completed' and [r['candidateId'] for r in result['final']] == ids)
            check(label + ': exact zero-cost operation count',
                  result['budget']['operations'] == (9 if generations else 4) and result['budget']['costCny'] == 0)
            check(label + ': final report preserves the reference',
                  report['candidates'][0]['id'] == 'original' and report['candidates'][0]['final']['state'] == 'EVALUATED')

        root = init('evaluate', 'evaluator-controls')
        examples = args.package / 'examples/product'
        contract = json.loads((examples / 'evaluator-controls-experiment.json').read_text())
        contract['target']['path'] = str(root / 'target.txt')
        (root / 'experiment.json').write_text(json.dumps(contract))
        patch = root / 'dsh-home/profiles/duo-product/cordis.patch.yml'
        rows = json.loads(patch.read_text())
        rows += json.loads((examples / 'evaluator-controls-profile.patch.yml').read_text())
        patch.write_text(json.dumps(rows))
        plan = call(root, 'dualloop_plan')
        check('packaged controls have no generator or paid permission', plan['providers']['generator'] is None and not plan['spec']['permissions']['paid'])
        result = call(root, 'dualloop_run', {'planDigest': plan['planDigest']})
        report = call(root, 'dualloop_report', {'runId': plan['runId']})
        metrics = result['evaluations'][0]['metrics']
        check('actual packaged measurement distinguishes all four frozen controls', metrics == {'control_match_rate': 1, 'controls_distinguish': True, 'sample_size': 4})
        check('control constraints pass without a quality-benefit claim', result['measurementChecks']['fast']['verdicts']['baseline'] != 'constraint_violation' and not report['improvementProven'])
        check('controls settle two native operations at CNY0', result['status'] == 'completed' and result['budget']['operations'] == 2 and result['budget']['costCny'] == 0)

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
        save('report.json', {'status': 'PASS', 'checks': checks, 'steps': len(commands),
            'profiles': sum(c['args'][0] == 'init' for c in commands),
            'modelRequests': 0, 'costCny': 0, 'implementerInterventionsDuringRun': 0,
            'evidenceKind': 'SCRIPTED_ACTUAL_DSH_PUBLIC_PACKAGE_ACCEPTANCE',
            'notClaimed': ['Independent Agent judgment', 'Model quality improvement', 'Registry install', 'Method superiority']})
        print(json.dumps({'status': 'PASS', 'checks': len(checks), 'steps': len(commands)}))
    except Exception as error:
        save('report.json', {'status': 'FAIL', 'checks': checks, 'steps': len(commands), 'error': str(error), 'modelRequests': 0, 'costCny': 0})
        raise


if __name__ == '__main__':
    main()
