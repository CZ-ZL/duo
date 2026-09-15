#!/usr/bin/env python3
"""Verify the explicitly retained Python bridge through cached DSH in isolated profiles.

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
    source_hashes.update({f'scripts/research/{name}': sha(ROOT / 'scripts/research' / name)
                          for name in ['verify_dsh_host.py', 'dsh_host_driver.js']})
    fixture = out / 'fixture'
    shutil.copytree(ROOT / 'examples/agent_native', fixture)
    # A dedicated local fixture makes in-flight cancellation observable without
    # a provider, arbitrary shell task or modifying the shipped adapter.
    cancel_adapter = fixture / 'cancel_adapter.py'
    cancel_adapter.write_text((fixture / 'adapter.py').read_text() + '''

_original_bindings = create_bindings
def create_bindings(**kwargs):
    import os
    import time
    bindings = _original_bindings(**kwargs)
    class SlowExecutor:
        def run(self, candidate, applied):
            (Path(kwargs["run_dir"]) / "cancel-entered.json").write_text(json.dumps({"pid": os.getpid()}))
            time.sleep(30)
            return applied
    bindings["executor"] = SlowExecutor()
    return bindings
''')
    cancel_config = yaml.safe_load((fixture / 'experiment.yml').read_text())
    cancel_config['agent']['adapter'] = 'cancel_adapter.py'
    (fixture / 'cancel.yml').write_text(yaml.safe_dump(cancel_config, sort_keys=False))
    results = []
    for profile_name, scenario, base_backed in [
        ('duo-tools-check', 'functional', False),
        ('duo-cancel-check', 'cancellation', False),
        ('duo-base-check', 'functional', True),
    ]:
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
        shutil.copyfile(ROOT / 'scripts/research/dsh_host_driver.js', driver)
        experiment = fixture / ('cancel.yml' if scenario == 'cancellation' else 'experiment.yml')
        case_out = out / profile_name
        case_out.mkdir()
        run_dir = case_out / 'experiment-run'
        bundles = (['@deepseek-ai/dsh-base'] if base_backed else []) + []
        write_json(profile / 'package.json', {
            'name': profile_name, 'private': True, 'type': 'module',
            'dependencies': {'@dual-loop/dsh-plugin': 'file:' + str(archive)},
            'dsh': {'profile': {'bundles': bundles, 'patchReload': 'startup'}},
        })
        patches = [] if base_backed else [{'insert': [
            {'id': 'system-prompt', 'name': '@deepseek-ai/dsh-system-prompt'},
            {'id': 'tools', 'name': '@deepseek-ai/dsh-tools'},
        ]}]
        patches += [
            {'insert': [{'id': 'dualloop', 'name': '@dual-loop/dsh-plugin/legacy', 'config': {'experiment': str(experiment), 'coreDir': str(ROOT),
                                         'python': sys.executable, 'journalDir': str(run_dir), 'runTimeoutMs': 15000}}]},
            {'insert': [{'id': 'duo-host-check', 'name': './host-check.js',
                         'config': {'outputDir': str(case_out), 'runDir': str(run_dir), 'scenario': scenario}}]},
        ]
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
        'limitations': ['Actual DSH CLI/loader/ToolRuntime; test app invokes tools without a model session.',
                        'Only trusted zero-cost static fixtures; no optimization efficacy evidence.',
                        'No registry download, package-manager dependency install or existing user profile mutation.'],
    }
    write_json(out / 'report.json', report)
    print(json.dumps({'status': report['status'], 'report': str(out / 'report.json')}))
    return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
