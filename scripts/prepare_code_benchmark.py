"""Freeze a dependency-qualified BigCodeBench subset without reading model scores."""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import sys

SEED = 'duo-code-readiness-v1'
UNSUPPORTED = {'threading', '_thread', 'multiprocessing', 'concurrent', 'subprocess',
               'socket', 'socketserver', 'http', 'urllib', 'ftplib', 'smtplib', 'ssl'}


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def prepare(source, output, *, prompt_format='instruct', test_suite='original'):
    requested_suite = test_suite
    owner_revision = 0
    if test_suite in ['dev-contract-v13', 'dev-contract-v14', 'dev-contract-v15', 'dev-contract-v16', 'dev-contract-v17', 'dev-contract-v18', 'dev-contract-v19', 'dev-contract-v20', 'dev-contract-v21']:
        owner_revision = int(test_suite.rsplit('v',1)[1])-12
        test_suite = 'dev-contract-v12'
    if prompt_format not in ['instruct', 'complete']:
        raise ValueError('prompt_format must be instruct or complete')
    if test_suite not in ['original', 'dev-contract-v1', 'dev-contract-v2', 'dev-contract-v3', 'dev-contract-v4', 'dev-contract-v5', 'dev-contract-v6', 'dev-contract-v7', 'dev-contract-v8', 'dev-contract-v9', 'dev-contract-v10', 'dev-contract-v11', 'dev-contract-v12']:
        raise ValueError('Unknown test_suite')
    if test_suite != 'original' and prompt_format != 'complete':
        raise ValueError('Development contract suite requires complete public prompts')
    raw = source.read_bytes()
    rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
    if len({r['task_id'] for r in rows}) != len(rows):
        raise ValueError('Duplicate source task IDs')
    eligible, excluded = [], []
    for row in rows:
        imports = set(ast.literal_eval(row['libs']))
        for field in ['code_prompt', 'test']:
            for node in ast.walk(ast.parse(row[field] + ('    pass\n' if field == 'code_prompt' else ''))):
                if isinstance(node, ast.Import):
                    imports.update(a.name.split('.')[0] for a in node.names)
                elif isinstance(node, ast.ImportFrom) and node.module:
                    imports.add(node.module.split('.')[0])
        missing = sorted(imports - sys.stdlib_module_names)
        unsupported = sorted(imports & UNSUPPORTED)
        # Previously inspected examples and control family never enter the split.
        inspected = int(row['task_id'].split('/')[-1]) < 20
        if missing or unsupported or inspected:
            excluded.append({'taskId': row['task_id'], 'nonStdlibImports': missing,
                             'unsupportedCapabilities': unsupported,
                             'previouslyInspectedOrControl': inspected})
        else:
            eligible.append(row)
    eligible.sort(key=lambda r: hashlib.sha256((SEED + ':' + r['task_id']).encode()).hexdigest())
    if len(eligible) < 36:
        raise ValueError('At least 36 eligible tasks required; do not change the rule after scores')
    if prompt_format == 'complete' and any(not isinstance(r.get('complete_prompt'), str) or
                                           not r['complete_prompt'].strip() for r in eligible[:36]):
        raise ValueError('Every selected task needs a nonempty public complete_prompt; no fallback')
    variant = 'v3-complete' if prompt_format == 'complete' else 'v2'
    additions = {}
    replacements, requirements = {}, {}
    reference_corrections = {}
    superseded_additions = {}
    if test_suite != 'original':
        from code_contract_tests import revised_development_rows
        selected, additions = revised_development_rows(eligible[:36],
            include_salt=test_suite in ['dev-contract-v2', 'dev-contract-v3', 'dev-contract-v4', 'dev-contract-v5', 'dev-contract-v6', 'dev-contract-v7', 'dev-contract-v8', 'dev-contract-v9', 'dev-contract-v10', 'dev-contract-v11', 'dev-contract-v12'],
            include_seed=test_suite in ['dev-contract-v3', 'dev-contract-v4', 'dev-contract-v5', 'dev-contract-v6', 'dev-contract-v7', 'dev-contract-v8', 'dev-contract-v9', 'dev-contract-v10', 'dev-contract-v11', 'dev-contract-v12'],
            include_copy=test_suite in ['dev-contract-v5', 'dev-contract-v6', 'dev-contract-v7', 'dev-contract-v8', 'dev-contract-v9', 'dev-contract-v10', 'dev-contract-v11', 'dev-contract-v12'],
            include_pairs=test_suite in ['dev-contract-v7', 'dev-contract-v8', 'dev-contract-v9', 'dev-contract-v10', 'dev-contract-v11', 'dev-contract-v12'],
            include_move=test_suite in ['dev-contract-v9', 'dev-contract-v10', 'dev-contract-v11', 'dev-contract-v12'],
            include_remaining=test_suite in ['dev-contract-v10', 'dev-contract-v11', 'dev-contract-v12'],
            include_basket=test_suite in ['dev-contract-v11', 'dev-contract-v12'])
        if test_suite in ['dev-contract-v4', 'dev-contract-v5', 'dev-contract-v6', 'dev-contract-v7', 'dev-contract-v8', 'dev-contract-v9', 'dev-contract-v10', 'dev-contract-v11', 'dev-contract-v12']:
            from code_file_hash_contract import replace_file_hash_tests
            selected, replacements, requirements = replace_file_hash_tests(selected)
        if test_suite in ['dev-contract-v6', 'dev-contract-v7', 'dev-contract-v8', 'dev-contract-v9', 'dev-contract-v10', 'dev-contract-v11', 'dev-contract-v12']:
            from code_disk_usage_contract import replace_disk_usage_tests
            selected, disk_replacement, reference_corrections = replace_disk_usage_tests(selected, include_custom=test_suite == 'dev-contract-v12')
            replacements.update(disk_replacement)
        if test_suite in ['dev-contract-v8', 'dev-contract-v9', 'dev-contract-v10', 'dev-contract-v11', 'dev-contract-v12']:
            from code_json_io_contract import replace_json_io_tests
            selected, json_replacement = replace_json_io_tests(selected)
            replacements.update(json_replacement)
            superseded_additions['BigCodeBench/412'] = additions.pop('BigCodeBench/412')
        if test_suite in ['dev-contract-v11', 'dev-contract-v12']:
            from code_salt_api_contract import replace_salt_api_test
            selected, salt_replacement = replace_salt_api_test(selected)
            replacements.update(salt_replacement)
            superseded_additions['BigCodeBench/130'] = additions.pop('BigCodeBench/130')
        if owner_revision:
            from code_owner_contracts import apply_owner_contracts
            selected, owner_changes = apply_owner_contracts(selected, owner_revision)
        eligible = selected + eligible[36:]
        variant = {'dev-contract-v1': 'v4-dev-contract1', 'dev-contract-v2': 'v5-dev-contract2',
                   'dev-contract-v3': 'v6-dev-contract3', 'dev-contract-v4': 'v7-dev-contract4',
                   'dev-contract-v5': 'v8-dev-contract5', 'dev-contract-v6': 'v9-dev-contract6', 'dev-contract-v7': 'v10-dev-contract7', 'dev-contract-v8': 'v11-dev-contract8', 'dev-contract-v9': 'v12-dev-contract9', 'dev-contract-v10': 'v13-dev-contract10', 'dev-contract-v11': 'v14-dev-contract11', 'dev-contract-v12': 'v15-dev-contract12'}[test_suite]
    evaluator_version = {'dev-contract-v2': '5', 'dev-contract-v3': '6', 'dev-contract-v4': '7', 'dev-contract-v5': '8', 'dev-contract-v6': '9', 'dev-contract-v7': '10', 'dev-contract-v8': '11', 'dev-contract-v9': '12', 'dev-contract-v10': '13', 'dev-contract-v11': '14', 'dev-contract-v12': '15'}.get(test_suite, '4')
    if owner_revision:
        variant = f'v{15+owner_revision}-dev-contract{12+owner_revision}'
        evaluator_version = str(15+owner_revision)
    suite_version = 'bigcodebench-unittest-' + requested_suite
    output.mkdir(parents=True, exist_ok=False)
    dataset = {'version': 1, 'responseMode': 'python-code-v1',
               'responseInstructions': 'Implement the specified Python function for each task.'}
    keys, offset, splits = {}, 0, {}
    for tier, size in [('fast', 6), ('slow', 12), ('final', 18)]:
        selected = eligible[offset:offset + size]
        splits[tier] = [r['task_id'] for r in selected]
        dataset[tier] = {'id': 'bigcodebench-stdlib-' + variant + '-' + tier, 'tasks': [
            {'id': r['task_id'], 'input': r['complete_prompt'] if prompt_format == 'complete' else
             r['instruct_prompt'] + '\n\nRequired interface:\n' + r['code_prompt']}
            for r in selected]}
        keys.update({r['task_id']: r for r in selected})
        offset += size
    save(output / 'dataset.json', dataset)
    dataset_sha = hashlib.sha256((output / 'dataset.json').read_bytes()).hexdigest()
    save(output / 'answer-key.json', {'version': suite_version if additions else 'bigcodebench-unittest-v1',
                                    **({'evaluatorVersion': evaluator_version} if additions else {}),
                                    **({'executionRequirements': requirements} if requirements else {}),
                                    'datasetSha256': dataset_sha, 'tasks': keys})
    # Original tests retained verbatim, or explicitly archived for replacements.
    # This separate control is never optimization data.
    control = next(r for r in rows if r['task_id'] == 'BigCodeBench/4')
    save(output / 'control-task.json', control)
    save(output / 'manifest.json', {
        'version': 'code-readiness-' + variant, 'benchmark': 'BigCodeBench v0.1.4',
        'sourceSha256': hashlib.sha256(raw).hexdigest(), 'seed': SEED,
        'selection': 'Fixed SHA256 order, stdlib-only single-process offline tasks; exclude inspected IDs 0-19; no model score-based selection',
        'unsupportedModules': sorted(UNSUPPORTED),
        'revisionReason': ('Preserve full upstream public examples uniformly after the instruct-only pilot omitted observable output contracts. Same task IDs, splits and original tests. This is not a repair of API-specific mocks or weak assertions; a new real baseline is required.'
                           if prompt_format == 'complete' else
                           'v1 reference task BigCodeBench/324 requires threads forbidden by the declared evaluator sandbox. Apply a general capability filter; preserve v1 failure and split unchanged.'),
        **({'promptFormat': 'bigcodebench-complete-v1', 'evaluatorVersion': '3',
            'measurementQualification': 'PUBLIC_INPUT_REPAIRED_ORIGINAL_TEST_LIMITATIONS_REMAIN',
            'priorInputVersion': 'code-readiness-v2'} if prompt_format == 'complete' else {}),
        **({'evaluatorVersion': '4', 'testSuiteVersion': 'bigcodebench-unittest-dev-contract-v1',
            'testAdditions': additions, 'priorInputVersion': 'code-readiness-v3-complete',
            'measurementQualification': 'PARTIAL_DEVELOPMENT_CONTRACT_REPAIR_NOT_QUALIFIED',
            'revisionReason': 'Append three public-contract checks for diagnosed development assertion gaps. Same complete prompts, task IDs and original tests; final tests unchanged. API-specific mocks, random behavior and ambiguous requirements remain unresolved. No new real baseline measured.'} if additions else {}),
        **({'evaluatorVersion': evaluator_version, 'testSuiteVersion': suite_version,
            'priorInputVersion': 'code-readiness-v4-dev-contract1',
            'contractDecisions': {'BigCodeBench/130': (additions.get('BigCodeBench/130') or superseded_additions['BigCodeBench/130'])['requirement']},
            'revisionReason': 'Owner selected the public SHA256(data + salt) rule. Add digest and fresh-salt assertions, clarify public input and correct only the reviewed reference order. Prior three additions and all original tests retained; final unchanged. Other measurement gaps remain; not a new real baseline.'} if test_suite in ['dev-contract-v2', 'dev-contract-v3', 'dev-contract-v4', 'dev-contract-v5', 'dev-contract-v6', 'dev-contract-v7', 'dev-contract-v8', 'dev-contract-v9', 'dev-contract-v10', 'dev-contract-v11', 'dev-contract-v12'] else {}),
        **({'priorInputVersion': 'code-readiness-v5-dev-contract2',
            'revisionReason': 'Append both existing public seeded-distribution examples for task862 after legal-alternative and incorrect-output controls. Public prompts and references unchanged since v5; original tests, prior repairs and final preserved. This measures published examples, not statistical randomness quality. Other measurement gaps remain; no new real baseline.'} if test_suite == 'dev-contract-v3' else {}),
        **({'priorInputVersion': 'code-readiness-v6-dev-contract3',
            'testReplacements': replacements, 'executionRequirements': requirements,
            'revisionReason': 'Replace task565 API-specific mocks with six real-file behavior checks validated using legal alternatives and wrong-program controls. Original tests archived in the key; all other task tests, complete prompts, references and final unchanged since v6. Frozen own-source Linux x86_64 shared-library fixture; other measurement gaps remain; no new real baseline.'} if replacements else {}),
        **({'priorInputVersion': 'code-readiness-v7-dev-contract4',
            'revisionReason': 'Append task665 public copy-content/source-preservation and destination-return checks after legal-alternative and three wrong-program controls. All existing version7 tests, public inputs, references and final unchanged. Task565 replacement and archived mocks retained. Other measurement gaps remain; no new real baseline.'} if test_suite == 'dev-contract-v5' else {}),
        **({'priorInputVersion': 'code-readiness-v8-dev-contract5',
            'referenceCorrections': reference_corrections,
            'revisionReason': 'Replace task973 API-specific mocks with real slash-path checks and the existing public relative-path example. Correct only the reference forced-root prefix that failed that example with real files. Original tests and reference archived; all public inputs, other tasks and final unchanged since v8. Custom delimiters and remaining measurement gaps unqualified; no new real baseline.'} if reference_corrections else {}),
        **({'priorInputVersion': 'code-readiness-v9-dev-contract6',
            'revisionReason': 'Append task931 explicit defaultdict return and zero-default checks. Equivalent factory callables accepted. All previous tests, archived references, public inputs, other tasks and final unchanged since v9. Unicode and remaining contract gaps unqualified; no new real baseline.'} if test_suite == 'dev-contract-v7' else {}),
        **({'priorInputVersion': 'code-readiness-v10-dev-contract7',
            'supersededTestAdditions': superseded_additions,
            'revisionReason': 'Replace task412 builtins.open mocks with seven real-file checks, retaining UTF-8/NFC and existing error classes. Prior combined tests and NFC addition metadata archived. Path.read_text alternative accepted and known wrong decoders rejected. All public inputs, references, other tasks and final unchanged since v10; remaining measurement gaps unqualified; no new real baseline.'} if test_suite in ['dev-contract-v8', 'dev-contract-v9', 'dev-contract-v10', 'dev-contract-v11', 'dev-contract-v12'] else {}),
        **({'priorInputVersion': 'code-readiness-v11-dev-contract8',
            'revisionReason': 'Append task756 file-content, unselected-file preservation and documented ValueError checks after reference, equivalent Path.rename and three wrong-program controls. All prior tests and archives retained; all public inputs, references, other tasks and final unchanged since v11. Same-filesystem flat-file controls only; remaining measurement gaps unqualified; no new real baseline.'} if test_suite == 'dev-contract-v9' else {}),
        **({'priorInputVersion': 'code-readiness-v12-dev-contract9',
            'revisionReason': 'Append six checks across tasks911/769/288/358/762 after fifteen reference/alternative/wrong-program controls exposed specific missed behavior. Preserve repeated inputs, unique frequency winner, JSON-only filtering, invalid input handling and actual archive bytes. All prior tests, public inputs, references, other rows and final unchanged since v12; no new tie, archive-layout or malformed-value policy; remaining qualification gaps and real baseline pending.'} if test_suite == 'dev-contract-v10' else {}),
        **({'priorInputVersion': 'code-readiness-v13-dev-contract10',
            'revisionReason': 'Replace only task130 urandom call-binding assertion with returned salt-size checks, preserving all other tests including the unresolved escaped-hex case. Archive prior tests and salt addition metadata; digest and freshness remain active. Append two task861 Counter/empty-basket checks after actual controls. Public inputs, references, other rows and final unchanged; distribution/randomness qualification and escaped-format clarification still pending; no new real baseline.'} if test_suite == 'dev-contract-v11' else {}),
        **({'priorInputVersion': 'code-readiness-v14-dev-contract11',
            'revisionReason': 'Append one task973 custom-delimiter check after reference/statvfs and ignored-argument controls. All earlier registered tests, archives, public inputs, reference corrections, other rows and final retained. Unresolved tie, alphabet, archive-layout, format and randomness policies unchanged; remaining qualification and new real baseline pending.'} if test_suite == 'dev-contract-v12' else {}),
        **({'priorInputVersion': f'code-readiness-v{14+owner_revision}-dev-contract{11+owner_revision}',
            'ownerContractRevisions': owner_changes,
            'revisionReason': 'Apply owner-selected development semantics with archived prior fields and real behavior checks; final unchanged. Qualification and new real baseline pending.'} if owner_revision else {}),
        'sourceTasks': len(rows), 'eligibleTasks': len(eligible), 'splits': splits, 'excluded': excluded,
        'primaryMetric': ('task_pass_rate: fraction of planned tasks passing ALL registered tests in this version'
                          if replacements else 'task_pass_rate: fraction of planned tasks passing ALL original tests' + (' AND registered development additions' if additions else '')),
        'diagnostics': ['per-task test_pass_rate', 'syntax_valid_rate', 'timeout_rate', 'per-test errors', 'wall_time_ms'],
        'comparison': 'Future comparison: same total CNY ceiling, all optimization and evaluation costs included',
        'limits': ['Custom unittest runner, NOT an official BigCodeBench leaderboard result',
                   'Stdlib-only subset does not represent all BigCodeBench library/tool tasks',
                   'Public benchmark may be present in model training; no contamination-free claim',
                   'Final tasks reserved for scheduled confirmation; never used for search or control calibration',
                   'No model baseline measured; headroom, transfer, performance and DUO benefit NOT_RUN'],
        'files': {name: hashlib.sha256((output / name).read_bytes()).hexdigest()
                  for name in ['dataset.json', 'answer-key.json', 'control-task.json']}})
    return {'status': 'FROZEN_NOT_MODEL_QUALIFIED', 'tasks': {k: len(v) for k, v in splits.items()},
            'eligibleTasks': len(eligible), 'output': str(output)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--prompt-format', choices=['instruct', 'complete'], default='instruct',
                        help='complete retains the full public specification in a new v3-complete input identity; original tests and task selection are unchanged')
    parser.add_argument('--test-suite', choices=['original', 'dev-contract-v1', 'dev-contract-v2', 'dev-contract-v3', 'dev-contract-v4', 'dev-contract-v5', 'dev-contract-v6', 'dev-contract-v7', 'dev-contract-v8', 'dev-contract-v9', 'dev-contract-v10', 'dev-contract-v11', 'dev-contract-v12', 'dev-contract-v13', 'dev-contract-v14', 'dev-contract-v15', 'dev-contract-v16', 'dev-contract-v17', 'dev-contract-v18', 'dev-contract-v19', 'dev-contract-v20', 'dev-contract-v21'], default='original',
                        help='opt-in development contract tests; requires complete prompts. v1:evaluator4, v2:salt/evaluator5, v3:seed/evaluator6, v4:file hashes/evaluator7, v5:copy/evaluator8, v6:real paths/evaluator9, v7:defaultdict/evaluator10, v8:JSON I/O/evaluator11, v9:move/evaluator12, v10:five behavior repairs/evaluator13, v11:salt API/basket/evaluator14, v12:delimiter/evaluator15')
    args = parser.parse_args()
    print(json.dumps(prepare(args.source, args.output, prompt_format=args.prompt_format, test_suite=args.test_suite)))
