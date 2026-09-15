#!/usr/bin/env python3
"""Verify native DUO services through cached DSH with child-process calls forbidden during tool execution.

No registry install/download and no model request. Requires an existing DSH
installation; --dsh-package is its package directory, not an executable URL.
Uses the actual CLI, loader, schemas and ToolRuntime with a test application.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import time

import yaml


ROOT = Path(__file__).resolve().parents[2]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dsh-package', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--scenario', action='append', help='Run only these named offline scenarios; default runs all.')
    args = parser.parse_args()
    dsh = args.dsh_package.resolve()
    cli = dsh / 'lib/bin.js'
    if not cli.is_file():
        parser.error('Provide an already-installed DSH package with lib/bin.js; no automatic install.')
    node, npm = shutil.which('node'), shutil.which('npm')
    if not node or not npm:
        parser.error('Existing node and npm executables are required.')
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    isolated_home = out / 'dsh-home'
    # Construct a bounded environment; do not inherit provider credentials or
    # read user dotenv files. DSH reads only this new cwd and isolated DSH_HOME.
    child_env = {
        'PATH': str(Path(node).parent) + os.pathsep + os.defpath,
        'DSH_HOME': str(isolated_home), 'DSH_TELEMETRY_DISABLED': '1',
        'PYTHONDONTWRITEBYTECODE': '1',
    }
    commands = []

    def execute(label, command, cwd=out, timeout=45):
        started = time.monotonic()
        result = subprocess.run(command, cwd=cwd, env=child_env, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
        (out / f'{label}.stdout.txt').write_text(result.stdout)
        (out / f'{label}.stderr.txt').write_text(result.stderr)
        commands.append({'label': label, 'command': command, 'cwd': str(cwd),
                         'exit_code': result.returncode, 'wall_time_s': time.monotonic() - started})
        write_json(out / 'commands.json', commands)
        print(f'{label}: exit {result.returncode}', flush=True)
        return result

    package_manifest = json.loads((ROOT / 'dsh-plugin/package.json').read_text())
    source_files = ['package.json', *package_manifest['files']]
    pack_source = out / 'pack-source'
    pack_source.mkdir()
    for name in source_files:
        target = pack_source / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / 'dsh-plugin' / name, target)
    for name in ['user.npmrc', 'global.npmrc']:
        (out / name).write_text('')
    packed = execute('pack', [npm, 'pack', '--ignore-scripts', '--offline', '--json',
                             '--userconfig', str(out / 'user.npmrc'), '--globalconfig', str(out / 'global.npmrc'),
                             '--cache', str(out / 'npm-cache'), '--pack-destination', str(out)], pack_source)
    if packed.returncode:
        return 1
    archive = out / json.loads(packed.stdout)[0]['filename']
    source_hashes = {f'dsh-plugin/{name}': sha(ROOT / 'dsh-plugin' / name) for name in source_files}
    source_hashes.update({f'scripts/product/{name}': sha(ROOT / 'scripts/product' / name)
                          for name in ['verify_dsh_native.py', 'dsh_native_host_driver.js', 'dsh_embedded_host_driver.js', 'dsh_adoption_host_driver.js']})
    source_hashes.update({str(path.relative_to(ROOT)): sha(path)
                          for path in sorted((ROOT / 'examples/native').rglob('*')) if path.is_file()})
    source_hashes['dsh-plugin/AGENT_GUIDE.md'] = sha(ROOT / 'dsh-plugin/AGENT_GUIDE.md')
    fixture = out / 'fixture'
    shutil.copytree(ROOT / 'examples/native', fixture)
    results = []
    scenarios = [
        ('duo-native-packaged', 'packaged', False),
        ('duo-native-check', 'functional', False),
        ('duo-native-alternate', 'alternate', False),
        ('duo-native-cancel', 'cancel', False),
        ('duo-native-base', 'functional', True),
        ('duo-native-onboarding', 'onboarding', False),
        ('duo-native-byo', 'byo', False),
        ('duo-native-three-stage', 'three-stage', False),
        ('duo-native-resume', 'resume', False),
        ('duo-native-evaluate', 'evaluate', False),
        ('duo-native-controls', 'controls', False),
        ('duo-native-constant-controls', 'constant-controls', False),
        ('duo-native-missing-dependency', 'missing-dependency', False),
        ('duo-native-noise-repeat', 'noise-repeat', False),
        ('duo-native-warm-start', 'warm-start', False),
        ('duo-native-missing-interface', 'missing-interface', False),
        ('duo-native-no-progress', 'no-progress', False),
        ('duo-native-evaluation-failure', 'evaluation-failure', False),
        ('duo-native-embedded', 'embedded', False),
        ('duo-native-embedded-denied', 'embedded-denied', False),
        ('duo-native-adoption', 'adoption', False),
    ]
    if args.scenario and set(args.scenario) - {s for _, s, _ in scenarios}:
        parser.error('Unknown offline scenario')
    for profile_name, scenario, base_backed in scenarios:
        if args.scenario and scenario not in args.scenario:
            continue
        control_case = scenario in {'controls', 'constant-controls', 'missing-dependency'}
        packaged_case = scenario == 'packaged'
        embedded_case = scenario in {'embedded', 'embedded-denied'}
        byo_case = scenario in {'byo', 'three-stage'}
        profile = isolated_home / 'profiles' / profile_name
        profile.mkdir(parents=True)
        package = profile / 'node_modules/@dual-loop/dsh-plugin'
        package.mkdir(parents=True)
        with tarfile.open(archive) as tar:
            for name in source_files:
                member = tar.getmember('package/' + name)
                assert member.isfile(), name
                target = package / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(tar.extractfile(member).read())
                assert sha(target) == source_hashes[f'dsh-plugin/{name}'], name
        driver = profile / 'host-check.js'
        shutil.copyfile(ROOT / 'scripts/product' / ('dsh_adoption_host_driver.js' if scenario == 'adoption' else 'dsh_embedded_host_driver.js' if embedded_case else 'dsh_native_host_driver.js'), driver)
        experiment = fixture / ('stopping-experiment.json' if scenario in {'no-progress', 'evaluation-failure'} else 'warm-start-experiment.json' if scenario == 'warm-start' else 'noise-repeat-experiment.json' if scenario == 'noise-repeat' else 'evaluator-controls-experiment.json' if control_case else 'evaluation-experiment.json' if scenario == 'evaluate' or embedded_case else 'byo-experiment.json' if scenario == 'byo' else 'experiment.json')
        if packaged_case:
            experiment = package / 'examples/experiment.json'
        if scenario == 'three-stage':
            experiment = fixture / 'three-stage-experiment.json'
        if scenario == 'adoption':
            experiment = profile / 'adoption-experiment.json'
            spec = json.loads((fixture / 'experiment.json').read_text())
            if 'maxCostUsd' in spec['budget']:
                spec['budget']['maxCostCny'] = spec['budget'].pop('maxCostUsd')
            spec['budget']['currency'] = 'CNY'
            spec['target']['path'] = str(fixture / 'persona.txt')
            write_json(experiment, spec)
        if scenario == 'adoption':
            shutil.copyfile(ROOT / 'examples/native/adoption.js', profile / 'adoption.js')
        if embedded_case:
            shutil.copyfile(ROOT / 'examples/native/embedded-task.js', profile / 'embedded-task.js')
            shutil.copyfile(ROOT / 'dsh-plugin/AGENT_GUIDE.md', profile / 'PUBLIC_GUIDE.md')
        if not packaged_case:
            shutil.copyfile(ROOT / 'examples/native/fixture-provider.js', profile / 'fixture-provider.js')
        if byo_case:
            shutil.copyfile(ROOT / 'examples/native/byo-evaluator.js', profile / 'byo-evaluator.js')
        if control_case:
            shutil.copyfile(ROOT / 'examples/native/evaluator-controls.js', profile / 'evaluator-controls.js')
        case_out = out / profile_name
        case_out.mkdir()
        run_dir = case_out / 'experiment-run'
        bundles = (['@deepseek-ai/dsh-base'] if base_backed else []) + ([] if scenario == 'onboarding' else ['@dual-loop/dsh-plugin'])
        write_json(profile / 'package.json', {
            'name': profile_name, 'private': True, 'type': 'module',
            'dependencies': {'@dual-loop/dsh-plugin': 'file:' + str(archive)},
            'dsh': {'profile': {'bundles': bundles, 'patchReload': 'startup'}},
        })
        patches = [] if base_backed else [{'insert': [
            {'id': 'system-prompt', 'name': '@deepseek-ai/dsh-system-prompt'},
            {'id': 'tools', 'name': '@deepseek-ai/dsh-tools'},
        ]}]
        patches += ([] if scenario == 'onboarding' else [
            {'id': 'duo-contract', 'config': {'experiment': str(experiment)}},
            {'id': 'duo-journal', 'config': {'root': str(run_dir)}},
        ]) + ([] if packaged_case else [
            # The default bundle wires the bundled offline fixture; every verifier
            # scenario either replaces it or tests its absence (duplicate service
            # registration would fail boot).
            {'id': 'duo-offline-fixture', 'disabled': True},
        ]) + [
            {'insert': ([] if scenario == 'onboarding' or packaged_case else [
                        {'id': 'duo-fixture-provider', 'name': './evaluator-controls.js' if control_case else './byo-evaluator.js' if byo_case else './fixture-provider.js',
                         'config': {'empty': scenario == 'alternate', 'waitForAbort': scenario == 'cancel', 'currency': 'CNY', **({'generator': False} if scenario == 'evaluate' or embedded_case else {}),
                                    **({'review': True} if scenario == 'three-stage' else {}),
                                    **({'noiseRepeat': True} if scenario == 'noise-repeat' else {}),
                                    **({'observeWarmStart': True} if scenario == 'warm-start' else {}),
                                    **({'missingGeneratorMethod': True} if scenario == 'missing-interface' else {}),
                                    **({'distinctCandidates': True, 'tieAll': scenario == 'no-progress', 'failCandidates': scenario == 'evaluation-failure'} if scenario in {'no-progress', 'evaluation-failure'} else {}),
                                    **({'constant': scenario == 'constant-controls', 'missingDependency': scenario == 'missing-dependency'} if control_case else {})}}]) + [
                        {'id': 'duo-host-check', 'name': './host-check.js',
                         'config': {'outputDir': str(case_out), 'runsRoot': str(run_dir), 'scenario': 'functional' if packaged_case else scenario, 'experimentPath': str(experiment), **({'guidePath': str(profile / 'PUBLIC_GUIDE.md')} if embedded_case else {})}}]},
        ]
        if scenario != 'onboarding':
            patches += [{'id': 'duo-runtime', 'disabled': True}] + [
                {'id': key, 'disabled': False} for key in
                ['duo-controller', 'duo-observer', 'duo-observer-tools', 'dualloop']]
            if packaged_case:
                patches += [{'id': 'duo-offline-fixture', 'disabled': False}]
        if byo_case:
            patches += [{'id': 'duo-feedback', 'disabled': True},
                        {'insert': [{'id': 'duo-history-feedback', 'name': '@dual-loop/dsh-plugin/history-feedback'}]}]
        if scenario == 'onboarding':
            patches.append({'insert': [{'id': 'duo-onboarding', 'name': '@dual-loop/dsh-plugin/onboarding'}]})
        if embedded_case or scenario == 'adoption':
            patches += [{'insert': [
                *[{'id': 'embedded-' + name, 'name': '@deepseek-ai/dsh-' + name}
                  for name in ['agent', 'session', 'session-projection', 'llm']],
                {'id': 'embedded-agent-loop', 'name': '@deepseek-ai/dsh-agent-loop', 'config': {'agents': []}},
                *([{'id': 'embedded-consumer', 'name': './embedded-task.js'}] if embedded_case else [
                    {'id': 'adoption-fs', 'name': '@deepseek-ai/dsh-fs-local', 'config': {'cwd': str(case_out)}},
                    {'id': 'adoption-fs-policy', 'name': '@deepseek-ai/dsh-fs-observation-policy'},
                    {'id': 'adoption-fs-tools', 'name': '@deepseek-ai/dsh-tool-fs'},
                ]),
            ]}]
        if scenario == 'evaluate' or control_case or embedded_case:
            patches += [{'id': 'duo-controller', 'disabled': True},
                        {'insert': [{'id': 'duo-evaluation-controller', 'name': '@dual-loop/dsh-plugin/evaluation-controller'}]}]
        (profile / 'cordis.patch.yml').write_text(yaml.safe_dump(patches, sort_keys=False))
        dumped = execute(profile_name + '-config', [node, str(cli), '--profile', profile_name, '--dump-config'])
        booted = execute(profile_name + '-boot', [node, str(cli), '--profile', profile_name])
        receipt_path = case_out / 'receipt.json'
        receipt = json.loads(receipt_path.read_text()) if receipt_path.exists() else {'status': 'NO_RECEIPT'}
        results.append({'profile': profile_name, 'base_backed': base_backed,
                        'config_exit': dumped.returncode, 'boot_exit': booted.returncode, 'receipt': receipt})
    report = {
        'status': 'PASS' if all(r['config_exit'] == r['boot_exit'] == 0 and r['receipt']['status'] == 'PASS' for r in results) else 'FAIL',
        'dsh_package': str(dsh), 'dsh_version': json.loads((dsh / 'package.json').read_text())['version'],
        'isolated_dsh_home': str(isolated_home), 'archive': str(archive), 'archive_sha256': sha(archive),
        'source_hashes': source_hashes, 'profiles': results,
        'staging': 'npm pack offline without scripts; unpack identical package files into isolated profile node_modules; native DSH heals its cached module fallback.',
        'limitations': ['Actual DSH CLI/loader/ToolRuntime; most profiles invoke tools from a test app. Embedded profiles use a real AgentLoop with a bounded scripted offline adapter, not autonomous model judgment.',
                        'Native in-process controller with explicit trusted zero-cost fixture providers; no optimization efficacy evidence.',
                        'Control profiles run the actual installed Schemastery validator on frozen outputs; external format checking is not business-quality or independent final qualification.',
                        'Warm-start profile uses two explicitly free fixture experiments, public tools and an isolated contract copy. Real independent Caller use remains separately unverified.',
                        'Adoption profile uses actual guarded DSH filesystem tools on an isolated persona copy; no active user profile load, deployment or model judgment is inferred.',
                        'No registry download, package-manager dependency install or existing user profile mutation.'],
    }
    write_json(out / 'report.json', report)
    print(json.dumps({'status': report['status'], 'report': str(out / 'report.json')}))
    return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
