"""Check local Markdown targets/anchors, frozen exceptions and bilingual commands.

This is a repository Markdown checker, not an HTML renderer or external-URL probe.
Historical omissions require exact source bytes and target; no directory is exempt.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import unicodedata
from urllib.parse import unquote, urlsplit

EXCLUDED = {'node_modules', '.git', '__pycache__', '.pytest_cache', '.venv', 'npm-cache'}


def files(root):
    for directory, dirs, names in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in EXCLUDED)
        for name in sorted(names):
            yield Path(directory) / name


def prose(text):
    lines = []
    fence = None
    for line in text.splitlines():
        m = re.match(r'^\s*(`{3,}|~{3,})', line)
        if m:
            if fence is None:
                fence = m[1]
            elif m[1][0] == fence[0] and len(m[1]) >= len(fence):
                fence = None
            lines.append('')
        else:
            lines.append(line if fence is None else '')
    return '\n'.join(lines)


def anchors(text):
    body = prose(text)
    result = set(re.findall(r'<a\s+(?:id|name)=[\"\']([^\"\']+)', body))
    counts = {}
    for heading in re.findall(r'^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$', body, re.M):
        heading = re.sub(r'<[^>]+>', '', heading)
        heading = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', heading).replace('`', '')
        slug = ''.join(c for c in heading.lower() if c in '-_ ' or unicodedata.category(c)[0] in 'LN').replace(' ', '-')
        index = counts.get(slug, 0)
        counts[slug] = index + 1
        result.add(slug + (f'-{index}' if index else ''))
    return result


def targets(text):
    body = prose(text)
    # Inline links/images and reference definitions. Definitions are checked
    # even when unused so a renamed public reference cannot hide silently.
    pattern = r'\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+[\"\'][^\n]*?[\"\'])?\s*\)|^\s{0,3}\[[^\]]+\]:\s*(<[^>]+>|\S+)'
    for match in re.finditer(pattern, body, re.M):
        yield (match[1] or match[2]).strip('<>')
    for target in re.findall(r'<(?:a|img)\b[^>]*(?:href|src)=[\"\']([^\"\']+)', body):
        yield target


def scan(root, exceptions=None):
    root = Path(root).resolve()
    errors, found, links = [], [], 0
    for file in files(root):
        if file.suffix != '.md':
            continue
        text = file.read_text()
        source = file.relative_to(root).as_posix()
        for target in targets(text):
            url = urlsplit(target)
            if url.scheme or url.netloc:
                continue
            links += 1
            path = (file.parent / unquote(url.path)).resolve() if url.path else file
            kind = None
            if not path.is_relative_to(root) or not path.exists():
                kind = 'missing_file'
            elif url.fragment and path.suffix == '.md' and unquote(url.fragment) not in anchors(path.read_text()):
                kind = 'missing_anchor'
            if kind:
                found.append({'source': source, 'target': target, 'kind': kind})
    allowed = set()
    for item in exceptions or []:
        path = root / item['source']
        key = (item['source'], item['target'], item['kind'])
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != item['sha256']:
            errors.append({'kind': 'stale_exception', 'source': item['source'], 'target': item['target']})
        elif not any((r['source'], r['target'], r['kind']) == key for r in found):
            errors.append({'kind': 'unused_exception', 'source': item['source'], 'target': item['target']})
        else:
            allowed.add(key)
    errors.extend(r for r in found if (r['source'], r['target'], r['kind']) not in allowed)
    return {'errors': errors, 'links': links, 'exceptions': len(allowed)}


def check_bilingual(root, pairs):
    errors = []
    for a, b in pairs:
        blocks = [re.findall(r'^```(?:sh|bash)\n(.*?)^```', (root / file).read_text(), re.M | re.S) for file in (a, b)]
        if blocks[0] != blocks[1]:
            errors.append({'kind': 'bilingual_commands_differ', 'source': a, 'target': b})
    return errors


def check_inventory(root):
    manifest = json.loads((root / 'scripts/research/INVENTORY.json').read_text())
    expected = {f.relative_to(root).as_posix() for f in files(root / 'scripts/research') if f.name not in {'README.md', 'INVENTORY.json'}}
    records = manifest['files']
    errors = []
    if {r['path'] for r in records} != expected or len(records) != len(expected):
        errors.append({'kind': 'research_inventory_drift'})
    for r in records:
        if r['role'] not in {'shared_verification', 'retained_driver', 'retained_fixture', 'retained_support'}:
            errors.append({'kind': 'unknown_inventory_role', 'source': r['path']})
        for user in r['currentUsers']:
            if not (root / user).is_file():
                errors.append({'kind': 'missing_dependency_user', 'source': r['path'], 'target': user})
    a = json.loads((root / 'dsh-plugin/host/package.json').read_text())
    b = json.loads((root / '.github/verification-host/package.json').read_text())
    if a != b:
        errors.append({'kind': 'host_manifest_drift'})
    return errors


def main():
    root = Path(__file__).resolve().parents[2]
    exceptions = json.loads((root / 'docs/development/LINK_EXCEPTIONS.json').read_text())['exceptions']
    report = scan(root, exceptions)
    pairs = [(f'dsh-plugin/{name}.md', f'dsh-plugin/{name}.zh-CN.md') for name in ['QUICKSTART', 'guides/INSTALL', 'guides/MODEL_STARTER', 'guides/TROUBLESHOOTING']]
    report['errors'] += check_bilingual(root, pairs) + check_inventory(root)
    report['status'] = 'FAIL' if report['errors'] else 'PASS'
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return bool(report['errors'])


if __name__ == '__main__':
    sys.exit(main())
