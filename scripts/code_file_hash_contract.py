"""Reviewed task565 behavior replacement; frozen fixture, development only.

The original API-specific mocks stay archived in the answer key. The shipped
ELF is built from the included tiny C source and runs only in the existing
namespace worker. Preparation never loads candidate code or the library.
"""
import base64
import hashlib
import json
from pathlib import Path
import platform
import sys

TASK = 'BigCodeBench/565'
PROMPT_SHA = '9de12da6f89b4bdf3880d5be0565c77f2423fbd514bf875139faa35b37dc7740'
ORIGINAL_SHA = '917e038c6bd60e7041b22bf34a1a8d9782907bae0c0db27cad5a205fa4beae94'
BINARY_SHA = '107cf5a51e49fae42dec5c5e9bec60c4656582ab384650234a0cc592d880e5ed'
SOURCE_SHA = '4ef53d78fe2a821fa5e1c3cfe6cd04710ae39ec7de7480fd14fe3e42b4948fe9'
TEMPLATE_SHA = '23bb8b337a75d2e12b54494341f9c4dcb7dcd3bd9ce0f0e1326c420648b5f993'
TEST_SHA = '15ab772abee710479e9ab4e92f4f0e25655788d39f9bcb735d4013de84cfc124'
REQUIREMENTS = {'platform': 'linux', 'machine': 'x86_64'}


def sha(value):
    return hashlib.sha256(value).hexdigest()


def replace_file_hash_tests(selected):
    if {'platform': sys.platform, 'machine': platform.machine()} != REQUIREMENTS:
        raise ValueError('Task565 shared-library fixture requires Linux x86_64')
    if TASK not in {r['task_id'] for r in selected[:18]}:
        raise ValueError('File hash replacement must stay in the reviewed development split')
    row = next(r for r in selected if r['task_id'] == TASK)
    if sha(row['complete_prompt'].encode()) != PROMPT_SHA:
        raise ValueError('Reviewed public prompt identity mismatch: ' + TASK)
    if sha(row['test'].encode()) != ORIGINAL_SHA:
        raise ValueError('Reviewed original test identity mismatch: ' + TASK)
    fixtures = Path(__file__).with_name('fixtures')
    fixture_bytes = (fixtures / 'code-library-v1.json').read_bytes()
    fixture = json.loads(fixture_bytes)
    template = (fixtures / 'code-file-hash-tests-v1.py.txt').read_bytes()
    binary = base64.b64decode(fixture['libraryBase64'], validate=True)
    if (sha(binary) != BINARY_SHA or fixture['binarySha256'] != BINARY_SHA or
            sha(fixture['sourceText'].encode()) != SOURCE_SHA or
            sha(template) != TEMPLATE_SHA):
        raise ValueError('Reviewed shared-library fixture identity mismatch')
    tests = template.decode().replace('__FIXTURE__', repr(fixture['libraryBase64']))
    if sha(tests.encode()) != TEST_SHA:
        raise ValueError('Reviewed real-file behavior identity mismatch')
    revised = [{**r, 'original_test': r['test'], 'test': tests} if r['task_id'] == TASK else r
               for r in selected]
    receipt = {TASK: {
        'requirement': 'Load the supplied library, hash its bytes with MD5/SHA256, print public prefixes and return the loaded name; preserve the exact public libc example',
        'publicPromptSha256': PROMPT_SHA, 'originalTestSha256': ORIGINAL_SHA,
        'replacementTestSha256': TEST_SHA, 'fixtureSha256': BINARY_SHA,
        'fixtureSourceSha256': SOURCE_SHA, 'fixtureFileSha256': sha(fixture_bytes),
        'templateSha256': TEMPLATE_SHA, 'originalTestsArchivedAs': 'original_test',
        'reason': 'Real-file controls confirmed old mocks reject a correct streamed hexdigest implementation',
        'limitations': 'Finite Linux x86_64 controls, not Windows DLL support or exhaustive anti-tampering qualification',
    }}
    return revised, receipt, dict(REQUIREMENTS)
