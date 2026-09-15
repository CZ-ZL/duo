"""Run known code controls through a named DSH profile and public DUO tools.

No model calls, installs, user-profile changes or benchmark final evaluation.
"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path
from dsh_model_profile import Profile, save, ROOT


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument('--benchmark-pack', type=Path)
    inputs.add_argument('--calibration-pack', type=Path, help='Frozen code-properties production root; validate and exercise its control pack in Fast and Slow')
    parser.add_argument('--dsh-package', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.calibration_pack:
        from prepare_code_properties import validate
        validate(args.calibration_pack)
    else:
        task = json.loads((args.benchmark_pack / 'control-task.json').read_text())
        if task['task_id'] != 'BigCodeBench/4':
            raise ValueError('Controls and their predeclared expectations require BigCodeBench/4')
    host = Profile(args.dsh_package, args.output)
    host.pack()
    pack = host.output / 'control-pack'
    if args.calibration_pack:
        shutil.copytree(args.calibration_pack / 'calibration-pack', pack)
        dataset = json.loads((pack / 'dataset.json').read_text())
        version = json.loads((pack / 'answer-key.json').read_text())['evaluatorVersion']
    else:
        pack.mkdir()
        version = '3'
        dataset = {'version': 1, 'responseMode': 'python-code-v1',
                   'fast': {'id': 'bcb4-controls-v1', 'tasks': [{'id': task['task_id'], 'input': task['instruct_prompt']}]}}
        save(pack / 'dataset.json', dataset)
        save(pack / 'answer-key.json', {'version': 'bigcodebench-unittest-v1',
            'datasetSha256': hashlib.sha256((pack / 'dataset.json').read_bytes()).hexdigest(), 'tasks': {task['task_id']: task}})
        codes = [
            ('correct', task['code_prompt'] + task['canonical_solution'], 1, 1, 0),
            ('wrong', 'def task_func(d): return {"wrong": -1}', 0, 0, 0),
            ('missed-duplicates', 'def task_func(d): return {x: 1 for v in d.values() for x in v}', 0, .75, 0),
            ('empty-regression', 'from collections import Counter\ndef task_func(d):\n    if not any(d.values()): return None\n    return dict(Counter(x for v in d.values() for x in v))', 0, .75, 0),
            ('syntax-error', 'def task_func(:', 0, 0, 0),
            ('timeout', 'def task_func(d):\n    while True: pass', 0, 0, 1),
        ]
        controls = [{'id': name, 'purpose': 'control', 'artifact': {'text': json.dumps({task['task_id']: code})},
                     'expectedMetrics': {'task_pass_rate': passed, 'test_pass_rate': fraction, 'timeout_rate': timeout}}
                    for name, code, passed, fraction, timeout in codes]
        save(pack / 'controls.json', controls)
    persona = host.output / 'persona.txt'
    persona.write_text('Fixed control source for evaluator readiness. No optimization or model execution.\n')
    spec = json.loads((ROOT / 'examples/native/evaluation-experiment.json').read_text())
    spec.update(id='code-evaluator-controls-v1', target={'kind': 'dsh-persona', 'path': str(persona)}, constraints=[], minSamples=2)
    spec['fast'].update(evaluatorId='code-controls-fast', version=version, dataId=dataset['fast']['id'], metric='control_match_rate', weights={'control_match_rate': 1})
    if args.calibration_pack:
        spec['slow'] = {**spec['fast'], 'evaluatorId': 'code-controls-slow', 'dataId': dataset['slow']['id']}
    spec['budget']['maxWallTimeMs'] = 60000
    save(host.output / 'experiment.json', spec)
    entries = [{'id': 'system-prompt', 'name': '@deepseek-ai/dsh-system-prompt', 'config': {'includeHarnessIdentity': False, 'includeRuntimeContext': False}},
               {'id': 'tools', 'name': '@deepseek-ai/dsh-tools'}]
    for name in ['contract', 'target', 'comparator', 'gate', 'feedback', 'journal', 'budget', 'controller', 'observer', 'observer-tools']:
        entry = {'id': 'duo-' + name, 'name': '@dual-loop/dsh-plugin/' + name}
        if name == 'controller': entry['name'] = '@dual-loop/dsh-plugin/evaluation-controller'
        if name == 'contract': entry['config'] = {'experiment': str(host.output / 'experiment.json')}
        if name == 'journal': entry['config'] = {'root': str(host.output / 'journal')}
        entries.append(entry)
    entries += [
        {'id': 'code-evaluator', 'name': './dsh_code_evaluator.js', 'config': {'pack': str(pack), 'controlsPath': str(pack / 'controls.json'), 'artifactRoot': str(host.output / 'executions')}},
        {'id': 'duo-tools', 'name': '@dual-loop/dsh-plugin'},
        {'id': 'code-host', 'name': './dsh_code_control_host.js', 'config': {'output': str(host.output), 'persona': str(persona), 'expectedTiers': ['fast', 'slow'] if args.calibration_pack else ['fast']}}]
    host.stage('duo-code-readiness', [{'insert': entries}], ['dsh_code_evaluator.js', 'dsh_code_control_host.js', 'code_evaluation.py', 'code_worker.py'])
    result = host.boot('duo-code-readiness', timeout=60)
    save(host.output / 'commands.json', host.commands)
    receipt_path = host.output / 'receipt.json'
    receipt = json.loads(receipt_path.read_text()) if receipt_path.exists() else {'status': 'NO_RECEIPT'}
    print(json.dumps({'exitCode': result.returncode, 'receipt': receipt, 'output': str(host.output)}))
    return 0 if result.returncode == 0 and receipt['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
