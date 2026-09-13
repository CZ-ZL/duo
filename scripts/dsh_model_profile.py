"""Stage a new named profile using a cached DSH; no install or user profile changes."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import tarfile
import time
import yaml

ROOT = Path(__file__).resolve().parents[1]


def save(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def manifest_digest(value):
    return hashlib.sha256(json.dumps({k:v for k,v in value.items() if k != 'manifestDigest'},
        sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def seal_manifest(value):
    return {**value, 'manifestDigest': manifest_digest(value)}


def module_inventory(roots):
    """Freeze lookup directories without following borrowed runtime symlinks.

    Names and link targets detect newly introduced nearer packages. JavaScript
    and package manifests are hashed; secret/config file contents are not read.
    First-party borrowed runtime code is fingerprinted separately by the runner.
    """
    inventory = {}
    for value in roots:
        root = Path(value)
        row = {'exists': root.exists() or root.is_symlink(), 'entries': {}}
        inventory[str(root)] = row
        if root.is_symlink():
            row['linkTarget'] = os.readlink(root)
            continue
        if not root.is_dir():
            continue
        for directory, dirs, files in os.walk(root, followlinks=False):
            for name in sorted(dirs + files):
                p = Path(directory) / name
                relative = str(p.relative_to(root))
                if p.is_symlink():
                    row['entries'][relative] = {'linkTarget': os.readlink(p)}
                elif p.is_dir():
                    row['entries'][relative] = {'kind': 'directory'}
                else:
                    item = {'kind': 'file'}
                    if p.name == 'package.json' or p.suffix in ('.js', '.mjs', '.cjs'):
                        item['sha256'] = sha(p)
                    row['entries'][relative] = item
    return inventory


class Profile:
    def __init__(self, dsh, output):
        self.dsh = Path(dsh).resolve()
        self.output = Path(output).resolve()
        if not (self.dsh / 'lib/bin.js').is_file():
            raise ValueError('Provide an existing cached DSH package. No automatic install.')
        self.output.mkdir(parents=True, exist_ok=False)
        self.node, self.npm = shutil.which('node'), shutil.which('npm')
        if not self.node or not self.npm:
            raise ValueError('Existing Node and npm required')
        self.env = {'PATH': str(Path(self.node).parent) + os.pathsep + os.defpath,
                    'DSH_HOME': str(self.output / 'dsh-home'), 'DSH_TELEMETRY_DISABLED': '1'}
        self.commands = []
        self.sources = {}

    def execute(self, label, command, cwd=None, timeout=45):
        started = time.monotonic()
        r = subprocess.run(command, cwd=cwd or self.output, env=self.env, text=True,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
        (self.output / (label + '.stdout.txt')).write_text(r.stdout)
        (self.output / (label + '.stderr.txt')).write_text(r.stderr)
        self.commands.append({'label': label, 'command': command, 'exitCode': r.returncode,
                              'wallTimeSeconds': time.monotonic() - started})
        save(self.output / 'commands.json', self.commands)
        return r

    def pack(self):
        manifest = json.loads((ROOT / 'dsh-plugin/package.json').read_text())
        self.files = ['package.json', *manifest['files']]
        source = self.output / 'pack-source'
        for name in self.files:
            dest = source / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / 'dsh-plugin' / name, dest)
            self.sources['dsh-plugin/' + name] = sha(dest)
        for name in ['user.npmrc', 'global.npmrc']:
            (self.output / name).write_text('')
        r = self.execute('pack', [self.npm, 'pack', '--offline', '--ignore-scripts', '--json',
                         '--userconfig', str(self.output / 'user.npmrc'), '--globalconfig', str(self.output / 'global.npmrc'),
                         '--cache', str(self.output / 'npm-cache'), '--pack-destination', str(self.output)], cwd=source)
        if r.returncode:
            raise RuntimeError('Offline packaging failed; inspect retained stderr')
        self.archive = self.output / json.loads(r.stdout)[0]['filename']

    def stage(self, name, entries, scripts, bundles=()):
        profile = Path(self.env['DSH_HOME']) / 'profiles' / name
        profile.mkdir(parents=True)
        with tarfile.open(self.archive) as tar:
            for file in self.files:
                dest = profile / 'node_modules/@dual-loop/dsh-plugin' / file
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(tar.extractfile('package/' + file).read())
                assert sha(dest) == self.sources['dsh-plugin/' + file]
        for file in scripts:
            shutil.copyfile(ROOT / 'scripts' / file, profile / file)
            self.sources['scripts/' + file] = sha(ROOT / 'scripts' / file)
        save(profile / 'package.json', {'name': name, 'private': True, 'type': 'module',
             'dependencies': {'@dual-loop/dsh-plugin': 'file:' + str(self.archive)},
             'dsh': {'profile': {'bundles': list(bundles), 'patchReload': 'startup'}}})
        (profile / 'cordis.patch.yml').write_text(yaml.safe_dump(entries, sort_keys=False))
        save(self.output / 'source-hashes.json', self.sources)
        return profile

    def boot(self, name, timeout=45, patches=(), cwd=None):
        command = [self.node, str(self.dsh / 'lib/bin.js'), '--profile', name]
        for patch in patches:
            command += ['--patch', str(patch)]
        config = self.execute(name + '-config', [*command, '--dump-config'], cwd=cwd)
        if config.returncode:
            raise RuntimeError('DSH config validation failed; inspect retained stderr')
        return self.execute(name + '-boot', command, timeout=timeout, cwd=cwd)


def agent_entries():
    # Avoid auxiliary model calls (titles, retry, etc.) from broad presets.
    names = ['agent', 'session', 'session-projection', 'llm', 'tools', 'system-prompt', 'agent-loop']
    entries = [{'id': 'model-' + n, 'name': '@deepseek-ai/dsh-' + n} for n in names]
    entries[-2]['config'] = {'includeHarnessIdentity': False, 'includeRuntimeContext': False}
    entries[-1]['config'] = {'agents': []}
    return entries


def freeze_profile_inputs(host, profile, inputs):
    """Snapshot isolated launch inputs and the existing runtime, without credentials."""
    absent = [host.output / '.env', host.output / 'dsh-home/.env', host.output / 'dsh-home/cordis.patch.yml']
    if any(p.exists() or p.is_symlink() for p in absent):
        raise ValueError('Unexpected ambient configuration in isolated profile')
    files = list(inputs) + [profile / 'package.json', profile / 'cordis.patch.yml',
        *[profile / 'node_modules/@dual-loop/dsh-plugin' / f for f in host.files],
        ROOT / 'scripts/run_dsh_model.py', ROOT / 'scripts/dsh_model_profile.py']
    packages = ['dsh', 'cordis', 'schemastery', 'dsh-app-boot', 'dsh-agent', 'dsh-agent-loop',
        'dsh-deepseek-llm-api-extensions', 'dsh-session', 'dsh-session-projection', 'dsh-llm', 'dsh-llm-deepseek',
        'dsh-tools', 'dsh-system-prompt', 'dsh-scope', 'dsh-launch-environment', 'dsh-home-paths', 'dsh-anonymous-user-id']
    for package in packages:
        base = host.dsh.parent / package
        files += [base / 'package.json', *sorted((base / 'lib').rglob('*.js'))]
    return {'absentPaths': [str(p) for p in absent],
        'moduleInventory': module_inventory([profile / '.lib/node_modules', *[p / 'node_modules' for p in [profile, *profile.parents]]]),
        'fileHashes': {str(p): sha(p) for p in files}}
