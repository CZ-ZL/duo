"""Reviewed task412 real-file checks without coupling to builtins.open."""
import hashlib
from pathlib import Path

TASK = 'BigCodeBench/412'
PROMPT_SHA = '43061ff4e1f660d0a0003fa85ad702a385e0d8e98c70a9a47b21b825b2d5df09'
ORIGINAL_TEST_SHA = 'd020debc63422fb260d8c4b3f23581242e85cc76548e097116b563c743d9a41c'
TEST_SHA = 'ea09654685c9a06632ae5c3e67db5946f4f0146b34df315e3c824707fb0d8338'


def replace_json_io_tests(selected):
    if TASK not in {row['task_id'] for row in selected[:18]}:
        raise ValueError('JSON I/O replacement must stay in the reviewed development split')
    row = next(row for row in selected if row['task_id'] == TASK)
    for field, expected, label in [('complete_prompt', PROMPT_SHA, 'public prompt'),
                                   ('test', ORIGINAL_TEST_SHA, 'original test')]:
        if hashlib.sha256(row[field].encode()).hexdigest() != expected:
            raise ValueError('Reviewed ' + label + ' identity mismatch: ' + TASK)
    tests = (Path(__file__).with_name('fixtures') / 'code-json-io-tests-v1.py.txt').read_text()
    if hashlib.sha256(tests.encode()).hexdigest() != TEST_SHA:
        raise ValueError('Reviewed JSON I/O tests identity mismatch')
    revised = [{**row, 'original_test': row['test'], 'test': tests}
               if row['task_id'] == TASK else row for row in selected]
    receipt = {TASK: {
        'requirement': 'Read a real JSON file, preserve keys, decode base64 as UTF-8 and normalize NFC; retain existing error-class checks',
        'publicPromptSha256': PROMPT_SHA, 'originalTestSha256': ORIGINAL_TEST_SHA,
        'replacementTestSha256': TEST_SHA, 'originalTestsArchivedAs': 'original_test',
        'reason': 'The equivalent Path.read_text implementation passes real files but bypasses builtins.open mocks',
        'supersedesAddition': 'Earlier NFC addition is covered by the replacement decomposed-Unicode check; its metadata is archived in supersededTestAdditions',
        'limitations': 'Finite existing contract cases; no new strict-base64, invalid-UTF8 or malformed-value policy',
    }}
    return revised, receipt
