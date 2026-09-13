"""Replace only the task130 API-specific mock; preserve other seven-test semantics."""
import hashlib
from pathlib import Path
TASK='BigCodeBench/130'
PROMPT_SHA='6db207c9901426897136925b37c8dc4c2f4b12f91da813781bccc75228792552'
ORIGINAL_TEST_SHA='d7159adf5f57670e8f8e9108d3c7f6e291bbe508efd713c8c9b99344e7c38595'
TEST_SHA='d5ff7d3f506f5867ba3c775b4a9ce7b2cd8fdb593184997e070891af66e6d05d'

def replace_salt_api_test(selected):
    if TASK not in {r['task_id'] for r in selected[:18]}:
        raise ValueError('Salt API replacement must stay in the reviewed development split')
    row=next(r for r in selected if r['task_id']==TASK)
    for field,expected,label in [('complete_prompt',PROMPT_SHA,'public prompt'),('test',ORIGINAL_TEST_SHA,'original test')]:
        if hashlib.sha256(row[field].encode()).hexdigest()!=expected:
            raise ValueError('Reviewed '+label+' identity mismatch: '+TASK)
    tests=(Path(__file__).with_name('fixtures')/'code-salt-api-tests-v1.py.txt').read_text()
    if hashlib.sha256(tests.encode()).hexdigest()!=TEST_SHA:
        raise ValueError('Reviewed salt API tests identity mismatch')
    revised=[{**r,'original_test':r['test'],'test':tests} if r['task_id']==TASK else r for r in selected]
    return revised,{TASK:{
        'requirement':'Measure returned salt byte size without requiring a particular os.urandom import binding; retain existing digest, fresh-salt and hex-format checks',
        'publicPromptSha256':PROMPT_SHA,'originalTestSha256':ORIGINAL_TEST_SHA,'replacementTestSha256':TEST_SHA,
        'originalTestsArchivedAs':'original_test',
        'reason':'A correct alias of the same os.urandom API passes public behavior but bypasses the original mock call counter',
        'limitations':'Escaped-hex public contract remains unresolved and its old test stays active; fresh output is not a cryptographic randomness proof',
    }}
