"""Inspect the actual npm tarball without installing or contacting a provider."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile
from urllib.parse import unquote

root = Path(__file__).resolve().parents[1]
record = json.loads(Path(sys.argv[1]).read_text())[0]
archive = Path(sys.argv[2]) / record['filename']
manifest = json.loads((root / 'dsh-plugin/package.json').read_text())
with tarfile.open(archive) as handle:
    members = handle.getmembers()
    assert all(m.isfile() and m.name.startswith('package/') and '..' not in PurePosixPath(m.name).parts for m in members)
    packed = {m.name.removeprefix('package/'): handle.extractfile(m).read() for m in members}
assert set(packed) == {'package.json', *manifest['files']}, 'Unreviewed or missing archive members'
assert 'LICENSE' in packed and packed['LICENSE'] == (root / 'LICENSE').read_bytes()
assert not any('.env' in PurePosixPath(n).parts or n.endswith(('.test.js', '.sqlite', '.tgz')) for n in packed)
for name, data in packed.items():
    assert data == (root / 'dsh-plugin' / name).read_bytes(), name + ': packed bytes differ'
    if not name.endswith('.md'):
        continue
    for target in re.findall(r'\]\(([^)]+)\)', data.decode()):
        target = unquote(target.split('#', 1)[0])
        if not target or '://' in target or target.startswith(('mailto:', '#')):
            continue
        path = str(PurePosixPath(name).parent / target)
        assert path in packed, f'{name}: unshipped Markdown link {target}'
for export in manifest['exports'].values():
    for target in export.values() if isinstance(export, dict) else [export]:
        assert target.removeprefix('./') in packed, 'Export missing from tarball'
result = {'status': 'PASS', 'name': manifest['name'], 'version': manifest['version'],
          'archive': archive.name, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
          'files': sorted(packed), 'modelRequests': 0, 'costCny': 0,
          'scope': 'Actual tarball members, source bytes, license, exports and local Markdown links; no installation or model efficacy claim'}
with (Path(sys.argv[2]) / 'package-report.json').open('x') as out:
    json.dump(result, out, indent=2)
print(json.dumps(result))
