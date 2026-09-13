"""Derive a new fixed final while preserving qualified development data."""
import argparse
from pathlib import Path
import json
import hashlib
import copy
import ast


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def read(path):
    return json.loads(path.read_text())


def write(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def normalize_unittest_equals(source):
    """Replace only the removed self.assertEquals call name, byte-for-byte otherwise."""
    tree = ast.parse(source)
    lines = source.encode().splitlines(keepends=True)
    offsets = [0]
    for line in lines:
        offsets.append(offsets[-1] + len(line))
    edits = []
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and isinstance(node.func.value, ast.Name) and node.func.value.id == 'self'
                and node.func.attr == 'assertEquals'):
            end = offsets[node.func.end_lineno - 1] + node.func.end_col_offset
            edits.append((end - len('assertEquals'), end))
            node.func.attr = 'assertEqual'
    result = source.encode()
    for start, end in sorted(edits, reverse=True):
        if result[start:end] != b'assertEquals':
            raise ValueError('Unexpected alias token location')
        result = result[:start] + b'assertEqual' + result[end:]
    result = result.decode()
    if ast.dump(ast.parse(result)) != ast.dump(tree):
        raise ValueError('Compatibility edit changed more than the alias')
    return result, len(edits)


def prepare(pack, source, exposure, output, seed, unittest_compatibility=None):
    pack, source, exposure, output = [Path(p).resolve() for p in [pack, source, exposure, output]]
    if not isinstance(seed, str) or not seed.strip():
        raise ValueError('Explicit preregistered selection seed required')
    if unittest_compatibility not in [None, 'py312-equals-v1']:
        raise ValueError('Unknown final compatibility version')
    manifest, audit = read(pack / 'manifest.json'), read(exposure)
    if sha(source) != manifest['sourceSha256'] or audit.get('sourceSha256') != manifest['sourceSha256']:
        raise ValueError('Pinned source identity changed')
    if manifest.get('measurementQualification') != 'DEVELOPMENT_CONTRACT_QUALIFIED':
        raise ValueError('Reuse an already qualified development pack')
    for name, expected in manifest['files'].items():
        if Path(name).name != name or sha(pack / name) != expected:
            raise ValueError('Development source manifest changed')
    if audit.get('status') != 'RECORDED_EXPOSURE_AUDITED_WITH_SOURCE_COPY_CLASSIFICATION' or audit.get('errors') != []:
        raise ValueError('Complete the recorded-project exposure audit first')
    rows = [json.loads(line) for line in source.read_bytes().splitlines() if line.strip()]
    by_id = {r['task_id']: r for r in rows}
    if len(rows) != len(by_id):
        raise ValueError('Duplicate source task IDs')
    data, key = read(pack / 'dataset.json'), read(pack / 'answer-key.json')
    if key.get('datasetSha256') != sha(pack / 'dataset.json'):
        raise ValueError('Development data/key identity changed')
    if any(len(data[tier]['tasks']) != size for tier, size in [('fast', 6), ('slow', 12), ('final', 18)]):
        raise ValueError('Preserve the existing6/12/18study size')
    prior_ids = {t['id'] for tier in ['fast', 'slow', 'final'] for t in data[tier]['tasks']}
    exposed_list = audit.get('exposedTaskIds', [])
    if not isinstance(exposed_list, list) or any(not isinstance(i, str) for i in exposed_list):
        raise ValueError('Explicit exposure IDs required')
    exposed = set(exposed_list)
    if not prior_ids <= exposed or not {f'BigCodeBench/{i}' for i in range(20)} <= exposed:
        raise ValueError('All known development/final/initial inspected IDs must stay excluded')
    eligible = set(by_id) - {r['taskId'] for r in manifest['excluded']}
    if len(eligible) != manifest['eligibleTasks']:
        raise ValueError('Historical capability filter identity changed')
    available = eligible - exposed
    declared = audit.get('eligibleUnexposedWithinRecordedScope', [])
    if not isinstance(declared, list) or len(declared) != len(set(declared)) or set(declared) != available:
        raise ValueError('Audit pool differs from source/capability/exposure identities')
    if len(available) < 18:
        raise ValueError('Fewer than18remaining tasks; do not replace by scores')
    chosen = sorted(available, key=lambda i: hashlib.sha256((seed + ':' + i).encode()).hexdigest())[:18]
    if any(not isinstance(by_id[i].get('complete_prompt'), str) or not by_id[i]['complete_prompt'].strip() for i in chosen):
        raise ValueError('Every selected task needs its existing full public prompt')
    original_development = {tier: copy.deepcopy(data[tier]) for tier in ['fast', 'slow']}
    data['final'] = {'id': 'bigcodebench-independent-final-' + digest({'source': sha(source), 'seed': seed, 'ids': chosen})[:16],
                     'tasks': [{'id': i, 'input': by_id[i]['complete_prompt']} for i in chosen]}
    dev_ids = {t['id'] for tier in ['fast', 'slow'] for t in data[tier]['tasks']}
    key['tasks'] = {**{i: key['tasks'][i] for i in dev_ids}, **{i: copy.deepcopy(by_id[i]) for i in chosen}}
    compatibility = {}
    if unittest_compatibility:
        for i in chosen:
            row = key['tasks'][i]
            normalized, count = normalize_unittest_equals(row['test'])
            if count:
                row['original_test'], row['test'] = row['test'], normalized
                compatibility[i] = {'replacements': count, 'originalTestSha256': hashlib.sha256(row['original_test'].encode()).hexdigest(),
                                    'testSha256': hashlib.sha256(normalized.encode()).hexdigest()}
        if not compatibility:
            raise ValueError('No removed unittest alias found; do not create a redundant measurement version')
        key['finalMeasurementVersion'] = data['final']['measurementVersion'] = 'bigcodebench-final-' + unittest_compatibility
        data['final']['id'] += '-' + unittest_compatibility
    # Only the data identity changes. Same scoring code and development rows.
    output.mkdir(parents=True, exist_ok=False)
    write(output / 'dataset.json', data)
    key['datasetSha256'] = sha(output / 'dataset.json')
    write(output / 'answer-key.json', key)
    (output / 'control-task.json').write_bytes((pack / 'control-task.json').read_bytes())
    provenance = {'version': 1, 'sourceSha256': sha(source), 'sourcePack': str(pack), 'sourcePackManifestSha256': sha(pack / 'manifest.json'),
        'exposureAudit': str(exposure), 'exposureAuditSha256': sha(exposure), 'seed': seed,
        'selection': 'First18eligible unexposed IDs sorted by SHA256(seed + colon + task_id); no model scores.',
        'selectedTaskIds': chosen, 'selectedSourceRowDigests': {i: digest(by_id[i]) for i in chosen},
        'priorFinalId': read(pack / 'dataset.json')['final']['id'], 'finalDataId': data['final']['id'],
        'developmentUnchanged': original_development == {tier: data[tier] for tier in ['fast', 'slow']},
        'developmentDigest': digest(original_development), 'finalQualified': False,
        'independenceScope': 'Excluded recorded project exposure; public-source training contamination and unrecorded external sessions unknown.',
        'finalModelExecution': 'NOT_RUN', 'modelRequests': 0, 'costCny': 0}
    if compatibility:
        provenance.update(finalMeasurementVersion=key['finalMeasurementVersion'], testCompatibility=compatibility,
            compatibilityRule='Only self.assertEquals call attribute becomes self.assertEqual. Arguments and every other AST node preserved.',
            selectedEffectiveRowDigests={i: digest(key['tasks'][i]) for i in chosen})
    write(output / 'final-provenance.json', provenance)
    write(output / 'qualification.json', {'status': 'DEVELOPMENT_CONTRACT_QUALIFIED', 'scope': 'Unchanged18development tasks only; new final NOT_QUALIFIED',
        'basis': 'Same exact development inputs and key rows; reuse earlier qualification rather than repeating it.',
        'sourceQualification': str(pack / 'qualification.json'), 'sourceQualificationSha256': sha(pack / 'qualification.json'),
        'developmentDigest': digest(original_development), 'finalQualification': 'NOT_RUN', 'apiRequests': 0, 'apiCostCny': 0})
    manifest.update(version='code-readiness-new-final-' + digest(chosen)[:12],
        revisionReason='Replace only previously viewed final with a separately selected cohort; original source/tests, development scoring and qualification reused.',
        splits={tier: [t['id'] for t in data[tier]['tasks']] for tier in ['fast', 'slow', 'final']},
        finalQualification='NOT_RUN', finalProvenanceFile='final-provenance.json',
        qualificationScope='Unchanged development only; new final must be qualified separately')
    if compatibility:
        manifest.update(version=manifest['version'] + '-' + unittest_compatibility,
            finalMeasurementVersion=key['finalMeasurementVersion'], testCompatibility=compatibility,
            revisionReason='Same selected final cohort; only removed unittest equals alias normalized, with original tests archived. Development unchanged.')
    manifest['files'] = {name: sha(output / name) for name in ['dataset.json', 'answer-key.json', 'control-task.json', 'qualification.json', 'final-provenance.json']}
    write(output / 'manifest.json', manifest)
    return {'status': 'NEW_FINAL_PREPARED_NOT_QUALIFIED', 'output': str(output), 'tasks': {'fast': 6, 'slow': 12, 'final': 18},
            'developmentUnchanged': provenance['developmentUnchanged'], 'finalQualified': False, 'modelRequests': 0}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['pack', 'source', 'exposure', 'output']:
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--seed', required=True)
    parser.add_argument('--unittest-compatibility', choices=['py312-equals-v1'])
    args = parser.parse_args()
    print(json.dumps(prepare(args.pack, args.source, args.exposure, args.output, args.seed, args.unittest_compatibility)))
