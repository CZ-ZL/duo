"""Reviewed task973 real-path repair, preserving public relative-path meaning."""
import hashlib
from pathlib import Path

TASK = 'BigCodeBench/973'
PROMPT_SHA = 'c65958ebd6491c7acbdb1b733671a841d160eedac835c2a0735e3ab52a813541'
ORIGINAL_TEST_SHA = '4e432a87c4aee2d00a1c4f74022e2266503f6d2cc96294c2e22255f7615b11a9'
ORIGINAL_REFERENCE_SHA = '85089ca250bd67e8efa30ab400bf7635c8840feb2ad17f04e5591008a375cae5'
REFERENCE_SHA = '2d339d0f31b52986c6cbfa5a13901ce74f62b40c15202b19a409c2050fe4a7be'
TEST_SHA = '3276bcd032b3ff5d4de7136e850556353aaa769a9ad12fde28adaddc7e9467d9'


def sha(value):
    return hashlib.sha256(value.encode()).hexdigest()


def replace_disk_usage_tests(selected, *, include_custom=False):
    if TASK not in {r['task_id'] for r in selected[:18]}:
        raise ValueError('Disk usage replacement must stay in the reviewed development split')
    row = next(r for r in selected if r['task_id'] == TASK)
    for field, expected, label in [('complete_prompt', PROMPT_SHA, 'public prompt'),
                                   ('test', ORIGINAL_TEST_SHA, 'original test'),
                                   ('canonical_solution', ORIGINAL_REFERENCE_SHA, 'reference')]:
        if sha(row[field]) != expected:
            raise ValueError('Reviewed ' + label + ' identity mismatch: ' + TASK)
    tests = (Path(__file__).with_name('fixtures') / 'code-disk-usage-tests-v1.py.txt').read_text()
    reference = row['canonical_solution'].replace(
        'if not sub_path.startswith(delimiter):',
        'if path.startswith(delimiter) and not sub_path.startswith(delimiter):')
    if sha(tests) != TEST_SHA or sha(reference) != REFERENCE_SHA:
        raise ValueError('Reviewed disk usage repair identity mismatch')
    if include_custom:
        addition = (Path(__file__).with_name('fixtures') / 'code-disk-delimiter-tests-v1.py.txt').read_text()
        if sha(addition) != '2795d54cd729dccdf0ca3eb5e84fc894dd6fe29d6c86638a4d92954a3b52626c':
            raise ValueError('Reviewed custom delimiter test identity mismatch')
        tests += '\n' + addition
    revised = [{**r, 'original_test': r['test'], 'test': tests,
                'original_canonical_solution': r['canonical_solution'],
                'canonical_solution': reference} if r['task_id'] == TASK else r for r in selected]
    replacement = {TASK: {
        'requirement': 'Measure actual cumulative paths, preserving the public relative-path example and accepting equivalent disk-usage APIs',
        'publicPromptSha256': PROMPT_SHA, 'originalTestSha256': ORIGINAL_TEST_SHA,
        'replacementTestSha256': sha(tests), 'originalTestsArchivedAs': 'original_test',
        'reason': 'Real controls expose API-specific mocks and forced-root access for a valid relative path',
        'limitations': ('Slash paths and a custom underscore delimiter on the tested namespace filesystem; other delimiters, root-only paths and cross-mount variation unverified' if include_custom else 'Slash paths on the tested namespace filesystem; custom delimiters, root-only paths and cross-mount variation unverified'),
    }}
    correction = {TASK: {
        'beforeSha256': ORIGINAL_REFERENCE_SHA, 'afterSha256': REFERENCE_SHA,
        'originalReferenceArchivedAs': 'original_canonical_solution',
        'reason': 'Valid public Docs/src exists in the working directory; the old unconditional prefix incorrectly accesses /Docs',
    }}
    return revised, replacement, correction
