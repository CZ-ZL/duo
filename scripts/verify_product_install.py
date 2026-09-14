"""Install a reviewed local tarball through DSH into a fresh, empty profile.

Package-manager dependency download is permitted; no model credentials are
inherited and no package lifecycle scripts are run. Never installs globally.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tarfile


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--archive', type=Path, required=True)
    p.add_argument('--dsh-package', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--cached-host-peers', action='store_true', help='Offline tarball install; rely on the existing DSH peer fallback, not a fresh registry install')
    p.add_argument('--registry', default='https://registry.npmjs.org', help='Explicit dependency registry; recorded in the receipt, no automatic fallback')
    args = p.parse_args()
    out, archive, dsh = args.output.resolve(), args.archive.resolve(), args.dsh_package.resolve()
    out.mkdir(parents=True, exist_ok=False)
    profile = out / 'dsh-home/profiles/install-check'
    profile.mkdir(parents=True)
    (profile / 'package.json').write_text(json.dumps({'name': 'duo-install-check', 'version': '1.0.0',
        'private': True, 'type': 'module', 'dsh': {'profile': {'bundles': [], 'patchReload': 'startup'}}}))
    for name in ['user.npmrc', 'global.npmrc']:
        (out / name).write_text('')
    env = {'PATH': os.environ.get('PATH', os.defpath), 'DSH_HOME': str(out / 'dsh-home'),
        'DSH_TELEMETRY_DISABLED': '1', 'CI': '1', 'NPM_CONFIG_USERCONFIG': str(out / 'user.npmrc'),
        'NPM_CONFIG_GLOBALCONFIG': str(out / 'global.npmrc'), 'NPM_CONFIG_CACHE': str(out / 'npm-cache'), 'NPM_CONFIG_REGISTRY': args.registry}
    node = shutil.which('node')
    commands = []

    def run(label, command):
        with (out / (label + '.stdout.txt')).open('w') as stdout, (out / (label + '.stderr.txt')).open('w') as stderr:
            process = subprocess.Popen(command, cwd=out, env=env, stdout=stdout, stderr=stderr, start_new_session=True)
            try:
                status = process.wait(timeout=180)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
                status = 'TIMEOUT'
        commands.append({'label': label, 'command': command, 'exitCode': status})
        (out / 'commands.json').write_text(json.dumps(commands, indent=2))
        assert status == 0, f'{label}: {status}; inspect retained stdout/stderr'

    try:
        run('install', [node, str(dsh / 'lib/bin.js'), 'plugin', '--profile', 'install-check', 'add',
            str(archive), '--registry', args.registry, '--ignore-scripts', '--store-dir', str(out / 'pnpm-store'), '--fetch-retries=0', '--fetch-timeout=15000',
            *(['--offline', '--config.auto-install-peers=false'] if args.cached_host_peers else [])])
        installed = profile / 'node_modules/@dual-loop/dsh-plugin'
        manifest = json.loads((installed / 'package.json').read_text())
        profile_manifest = json.loads((profile / 'package.json').read_text())
        assert manifest['name'] in profile_manifest['dsh']['profile']['bundles'], 'DSH did not automatically register bundle'
        with tarfile.open(archive) as tar:
            for member in tar.getmembers():
                assert member.isfile() and member.name.startswith('package/') and '..' not in Path(member.name).parts
                assert (installed / member.name.removeprefix('package/')).read_bytes() == tar.extractfile(member).read(), member.name
        run('composed-profile', [node, str(dsh / 'lib/bin.js'), '--profile', 'install-check', '--dump-config'])
        assert 'duo-onboarding' in (out / 'composed-profile.stdout.txt').read_text()
        run('installed-bin', [str(profile / 'node_modules/.bin/duo'), '--help'])
        # Exercise the package-manager-installed dependency graph itself. The
        # public example verifier also tests isolated file staging; it must not
        # stand in for loading this actual installed profile and its peers.
        probe = out / 'public-probe'
        run('prepare-public-probe', [node, str(installed / 'bin/duo.mjs'), 'init', '--root', str(probe),
            '--dsh-package', str(dsh), '--example', 'optimize'])
        shutil.copyfile(probe / 'dsh-home/profiles/duo-product/cordis.patch.yml', profile / 'cordis.patch.yml')
        values = {}
        for tool in ['plan', 'run', 'report']:
            request, response, patch = [out / (tool + suffix) for suffix in ['-request.json', '-response.json', '-patch.json']]
            payload = {} if tool == 'plan' else {'planDigest': values['plan']['planDigest']} if tool == 'run' else {'runId': values['plan']['runId']}
            request.write_text(json.dumps({'id': 'installed-' + tool, 'tool': 'dualloop_' + tool, 'args': payload}))
            patch.write_text(json.dumps([{'id': 'local-tool-app', 'config': {'requestPath': str(request), 'responsePath': str(response)}}]))
            run('installed-' + tool, [node, str(dsh / 'lib/bin.js'), '--profile', 'install-check', '--patch', str(patch)])
            returned = json.loads(response.read_text())
            assert not returned['isError'], returned
            values[tool] = returned['value']
        assert values['run']['status'] == 'completed' and values['run']['budget']['costCny'] == 0
        assert values['report']['improvementProven'] is False
        report = {'status': 'PASS', 'package': str(installed), 'version': manifest['version'],
            'archiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
            'scope': 'Actual DSH plugin add, automatic bundle registration, tarball byte equality, config composition and installed bin',
            'dependencyRegistry': args.registry,
            'dependencyMode': 'EXISTING_HOST_PEERS_OFFLINE' if args.cached_host_peers else 'FRESH_REGISTRY_DEPENDENCIES',
            'actualInstalledProfile': {'planRunReport': 'PASS', 'status': values['run']['status'],
                'operations': values['run']['budget']['operations'], 'costCny': 0},
            'modelRequests': 0, 'costCny': 0, 'privateProfilesRead': False, 'globalInstall': False}
    except Exception as error:
        report = {'status': 'FAIL', 'error': str(error), 'dependencyRegistry': args.registry, 'modelRequests': 0, 'costCny': 0}
        raise
    finally:
        (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
