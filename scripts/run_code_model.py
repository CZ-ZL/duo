"""Compose the existing native model runner and code Evaluator, without core changes.

offline uses explicitly synthetic transport; prepare-live only discovers/plans.
After explicit allocation, execute the sealed run with run_dsh_model.py. No
historical funds or authorization are inferred. Final is never evaluated here.
"""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys

import yaml

from dsh_model_profile import ROOT, save, sha, seal_manifest

PERSONA = ('You are a careful Python programmer. Implement the requested behavior completely '
           'using Python 3.12 and its standard library. Preserve function signatures and specified '
           'return types. Handle edge cases described in each task. Return only the requested JSON '
           'object of complete source strings.\n')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--mode', choices=['offline', 'prepare-live'], required=True)
    p.add_argument('--benchmark-pack', type=Path, required=True)
    p.add_argument('--dsh-package', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--pricing', type=Path, help='Current, frozen official CNY table for prepare-live')
    p.add_argument('--fixture-scenario', choices=['reference', 'wrong'], default='reference')
    args = p.parse_args()
    live = args.mode == 'prepare-live'
    if live and not args.pricing:
        p.error('A current explicit CNY tariff is required for live preparation')
    source = args.benchmark_pack.resolve()
    data = json.loads((source / 'dataset.json').read_text())
    key = json.loads((source / 'answer-key.json').read_text())
    if data.get('responseMode') != 'python-code-v1' or key['datasetSha256'] != sha(source / 'dataset.json'):
        p.error('A matching frozen code dataset/key is required')
    if any(not data.get(tier, {}).get('tasks') for tier in ['fast', 'slow', 'final']):
        p.error('This pilot requires nonempty frozen Fast/Slow/final splits')
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    pack = out / 'pack'
    pack.mkdir()
    for name in ['dataset.json', 'answer-key.json', 'manifest.json']:
        shutil.copyfile(source / name, pack / name)
    run = out / 'run'
    profile = run / 'dsh-home/profiles/duo-model-minimum'
    persona = out / 'persona.txt'
    persona.write_text(PERSONA)
    spec = json.loads((ROOT / 'examples/native/evaluation-experiment.json').read_text())
    objective = lambda tier: {'evaluatorId': 'code-unittest-' + tier, 'version': key.get('evaluatorVersion', '3'),
        'dataId': data[tier]['id'], 'weights': {'task_pass_rate': 1}, 'direction': 'maximize', 'metric': 'task_pass_rate'}
    spec.update(id='code-baseline-pilot-v1', target={'kind': 'dsh-persona', 'path': str(persona)},
                fast=objective('fast'), slow=objective('slow'), final=None, constraints=[], minSamples=2,
                permissions={'paid': True, 'network': live, 'externalSideEffects': False},
                budget={'maxSessions': 4, 'maxFastEvals': 1, 'maxSlowEvals': 1,
                        'maxWallTimeMs': 360000, 'currency': 'CNY', 'maxCostCny': .8})
    save(out / 'experiment.json', spec)
    # One request per split, no generation/Caller/auxiliary model work. At the
    # current peak tariff the byte+framing and output envelope is CNY .270336.
    # .4 also covers the intentionally synthetic 3/0.1/9 offline test tariff.
    model = {'maxTokens': 16384, 'maxInputBytes': 65536, 'reservationCny': .4,
             'timeoutMs': 120000 if live else 10000}
    if live:
        model['model'] = 'deepseek-flash'
    save(out / 'model-config.json', model)
    policy = {'script': str(profile / 'code_evaluation.py'), 'pack': str(pack),
              'artifactRoot': str(run / 'executions'), 'tiers': ['fast', 'slow'], 'maxCalls': 2}
    patches = [
        {'id': 'duo-controller', 'disabled': True},
        {'id': 'model-generator', 'disabled': True},
        {'id': 'model-evaluator', 'disabled': True},
        # The default bundle wires the bundled offline fixture; the code
        # evaluator below replaces it (duplicate registration fails boot).
        {'id': 'duo-offline-fixture', 'disabled': True},
        {'insert': [
            {'id': 'code-controller', 'name': '@dual-loop/dsh-plugin/evaluation-controller'},
            {'id': 'code-evaluator', 'name': './dsh_code_evaluator.js',
             'config': {'pack': str(pack), 'artifactRoot': str(run / 'executions')}},
        ]},
        {'id': 'model-entry', 'config': {'output': str(run), 'live': live, 'maxModelRequests': 2,
         'requiredGenerations': 0, 'arm': 'code-baseline-pilot', 'evaluatorProcess': policy}},
    ]
    scripts = ['dsh_code_evaluator.js', 'code_evaluation.py', 'code_worker.py']
    if not live:
        ids = [t['id'] for tier in ['fast', 'slow'] for t in data[tier]['tasks']]
        save(out / 'fixture-answers.json', {i: key['tasks'][i]['code_prompt'] + key['tasks'][i]['canonical_solution']
             if args.fixture_scenario == 'reference' else 'def task_func(*args, **kwargs): return None' for i in ids})
        patches += [{'id': 'fixture', 'disabled': True}, {'insert': [
            {'id': 'code-fixture', 'name': './dsh_code_model_fixture.js',
             'config': {'answersPath': str(out / 'fixture-answers.json')}}]}]
        scripts.append('dsh_code_model_fixture.js')
    (out / 'providers.patch.yml').write_text(yaml.safe_dump(patches, sort_keys=False))
    save(out / 'protocol.json', {'version': 1, 'mode': args.mode, 'kind': 'baseline_pilot_not_method_comparison',
        'sourcePack': str(source), 'packHashes': {f.name: sha(f) for f in pack.iterdir()},
        'personaSha256': sha(persona), 'personaOrigin': 'Neutral coding baseline frozen before any model answers; not a pre-existing deployed Agent',
        'tiers': ['fast', 'slow'], 'final': 'NOT_RUN', 'currency': 'CNY', 'maxCostCny': .8, 'maxModelRequests': 2,
        'hiddenRetries': 0, 'independentCaller': 'NOT_RUN', 'modelConfig': model,
        'stops': ['unknown cost', 'request cap', 'budget cap', 'input/output cap', 'failed run; no automatic repair/retry'],
        'qualification': 'At least one pass and one failure across 18 development tasks, with valid format and no infrastructure failure; otherwise diagnose without changing rules or selecting another task from final results',
        'metric': 'task_pass_rate; test_pass_rate and syntax/timeout rates are diagnostic',
        'fixtureScenario': None if live else args.fixture_scenario,
        'authorization': 'Preparation is not spending permission; requires separately recorded finite allocation. No deployment.',
        'limitations': ['Custom stdlib subset, not official leaderboard', 'Local compute time measured but unpriced',
                       'Candidate and unittest share a worker; anti-judge-tampering security not independently audited']})
    command = [sys.executable, str(ROOT / 'scripts/run_dsh_model.py'), '--mode', args.mode,
        '--dsh-package', str(args.dsh_package.resolve()), '--output', str(run), '--arm', 'baseline',
        '--dataset', str(pack / 'dataset.json'), '--contract', str(out / 'experiment.json'),
        '--profile-patch', str(out / 'providers.patch.yml'), '--model-config', str(out / 'model-config.json'),
        '--max-cost-cny', '.8', '--max-model-requests', '2']
    for name in scripts:
        command += ['--profile-file', str(ROOT / 'scripts' / name)]
    if live:
        command += ['--pricing', str(args.pricing.resolve())]
    result = subprocess.run(command, text=True, capture_output=True, timeout=420)
    (out / 'entry.stdout.txt').write_text(result.stdout)
    (out / 'entry.stderr.txt').write_text(result.stderr)
    save(out / 'entry.json', {'command': command, 'exitCode': result.returncode, 'mode': args.mode,
                             'paidRequests': 0, 'apiCostCny': 0})
    if live and result.returncode == 0:
        # The public runner freezes modules and immediate file config values.
        # This provider also owns a directory: bind every input file explicitly.
        frozen = json.loads((run / 'prepared.json').read_text())
        frozen['fileHashes'].update({str(f): sha(f) for f in [*pack.iterdir(),
            out / 'protocol.json', Path(__file__).resolve()]})
        save(run / 'prepared.json', seal_manifest(frozen))
    print(json.dumps({'exitCode': result.returncode, 'output': str(out), 'mode': args.mode}))
    return result.returncode


if __name__ == '__main__':
    raise SystemExit(main())
