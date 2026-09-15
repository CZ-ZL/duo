"""Versioned development assertion repairs, never a final-test calibration.

Opt-in development assertion suites through dev-contract-v11. Append to original TestCases, preserving its
methods. Hashes bind the reviewed source tests; new upstream versions need a new
review. This is deliberately incomplete instrument repair.
"""
import hashlib

ADDITIONS = {
    'BigCodeBench/412': {
        'originalTestSha256': 'd55df50cbcfd2fa4b4158dadf976ccd38301f9347edbd711f5b17bc45f891daa',
        'requirement': 'Decode Base64 then apply Unicode NFC normalization',
        'test': '''
class TestCases(TestCases):
    def test_zz_contract_decomposed_unicode(self):
        import tempfile, json, base64
        with tempfile.NamedTemporaryFile(mode='w+', suffix='.json') as f:
            json.dump({'key': base64.b64encode('e\\u0300'.encode()).decode()}, f)
            f.flush()
            self.assertEqual(task_func(f.name), {'key': 'è'})
''',
    },
    'BigCodeBench/756': {
        'originalTestSha256': '829cfca1581dc29623663d4c955d9d4c53654bcb30da7ac936ebad80fc6a8f1b',
        'requirement': 'Move matching files: remove source and preserve destination contents',
        'test': '''
class TestCases(TestCases):
    def test_zz_contract_source_removed_after_move(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = Path(tmp) / 'src', Path(tmp) / 'dst'
            src.mkdir(); dst.mkdir()
            file = src / 'a.txt'
            file.write_text('payload')
            self.assertEqual(task_func(str(src), str(dst), ['.txt']), 1)
            self.assertFalse(file.exists())
            self.assertEqual((dst / 'a.txt').read_text(), 'payload')
''',
    },
    'BigCodeBench/861': {
        'originalTestSha256': '62ab2952cc8ca885c74ae4893455eb7fcabdc1061b52346d35f60f941f83235a',
        'requirement': 'Choose shopping items only from the public POSSIBLE_ITEMS list',
        'test': '''
class TestCases(TestCases):
    def test_zz_contract_only_permitted_items(self):
        baskets = task_func([[1, 2, 3], [4]])
        self.assertEqual(len(baskets), 2)
        allowed = {'apple', 'banana', 'cherry', 'date', 'elderberry'}
        for basket in baskets:
            self.assertTrue(set(basket) <= allowed)
''',
    },
}

# The owner explicitly selected the public data+salt rule on 2026-09-12.
# The upstream reference uses salt+data. Keep v1 unchanged and bind the v2
# correction to the reviewed reference, tests and public specification.
SALT_ADDITION = {
    'originalTestSha256': 'fe9b123274215b2a6c3edbb413fe2153123077d02a1bffd0045cd2fdd5cca414',
    'referenceSha256': 'df2ebb2093562403499f965afb1b0d8fb9ed7990b0b3bb044945d0de58d63990',
    'promptSha256': '2dd0d352fbdacae415a9d9705b53dab49c46bd3e336f6f21dfa25109a1b085e5',
    'requirement': 'SHA256(data + salt) per owner choice of the public specification',
    'clarification': '\n# Contract clarification: compute SHA256(data + salt), in this order; return both tuple elements as strings.\n',
    'test': '''
class TestCases(TestCases):
    def test_zz_contract_digest_matches_public_order(self):
        import base64, hashlib
        for hex_str, salt_size in [('F3BE8080', 16), ('0011ff', 8)]:
            encoded, actual = task_func(hex_str, salt_size)
            self.assertIsInstance(encoded, str)
            self.assertIsInstance(actual, str)
            salt = base64.b64decode(encoded, validate=True)
            self.assertEqual(len(salt), salt_size)
            self.assertEqual(actual, hashlib.sha256(bytes.fromhex(hex_str) + salt).hexdigest())
    def test_zz_contract_fresh_salt(self):
        first, _ = task_func('F3BE8080', 16)
        second, _ = task_func('F3BE8080', 16)
        self.assertNotEqual(first, second)
''',
}


SEED_ADDITION = {
    'originalTestSha256': '3d9eb4b5a8b658d37c3165fe1aaf42630abe623af4d10121648fa123a4ee369a',
    'promptSha256': '212b8ed06b73701bbceb6d2f52b1917a57169461f95e7ff4f61c47f1b46f5a6a',
    'requirement': 'Match both seeded distributions already specified in the complete public examples',
    'test': '''
class TestCases(TestCases):
    def test_zz_contract_public_seed123_example(self):
        self.assertEqual(task_func(5, seed=123), {c: [c] for c in 'bicyn'})
    def test_zz_contract_public_seed1_example(self):
        counts = {'e': 1, 's': 1, 'z': 3, 'y': 4, 'c': 1, 'i': 2,
                  'd': 2, 'p': 3, 'o': 2, 'u': 1, 'm': 2, 'g': 1,
                  'a': 2, 'n': 1, 't': 1, 'w': 1, 'x': 1, 'h': 1}
        self.assertEqual(task_func(30, seed=1), {c: [c] * n for c, n in counts.items()})
''',
}


COPY_ADDITION = {
    'originalTestSha256': '5f78efc300bb171c22c687c0231d8db9d242b09eaaa03098ed7bf0a073a1e41a',
    'promptSha256': '4d4f99486abbbd0ddd1a59acab4e3d1456561605ec9e446cab9fc64aa9b53943',
    'requirement': 'Copy matching file bytes without changing source files, and return the destination directory string',
    'test': '''
class TestCases(TestCases):
    def test_zz_contract_copy_bytes_and_preserve_source(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = Path(tmp) / 'src', Path(tmp) / 'dst'
            src.mkdir(); dst.mkdir()
            contents = {'a.txt': b'utf8 text: \\xc3\\xa9', 'b.docx': b'\\x00\\xffdocx-bytes', 'skip.pdf': b'not-selected'}
            for name, value in contents.items():
                (src / name).write_bytes(value)
            task_func(str(src), str(dst))
            self.assertEqual({p.name for p in dst.iterdir()}, {'a.txt', 'b.docx'})
            for name, value in contents.items():
                self.assertEqual((src / name).read_bytes(), value)
                if name != 'skip.pdf':
                    self.assertEqual((dst / name).read_bytes(), value)
    def test_zz_contract_returns_destination_string(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = Path(tmp) / 'src', Path(tmp) / 'dst'
            src.mkdir(); dst.mkdir()
            (src / 'a.txt').write_text('copy')
            self.assertEqual(task_func(str(src), str(dst)), str(dst))
''',
}


PAIR_ADDITION = {
    'originalTestSha256': '86d580c11612cc921575c4899f1b15886557e65cc793a042120b9ace56b0a47f',
    'promptSha256': 'b3d4b96c70273c312361efe337528a4aa068ea75595fd361b6317b43280c5784',
    'requirement': 'Return the public defaultdict with a zero default; equivalent factory callables are valid',
    'test': '''
class TestCases(TestCases):
    def test_zz_contract_defaultdict_return_type(self):
        from collections import defaultdict
        for word in ['aabbcc', 'a', '']:
            self.assertIsInstance(task_func(word), defaultdict)
    def test_zz_contract_missing_pair_defaults_to_zero(self):
        for word in ['aabbcc', 'a', '']:
            result = task_func(word)
            self.assertEqual(result['zz'], 0)
''',
}


MOVE_ADDITION = {
    'promptSha256': 'c3a458ce39d02549a5524eac08dc0ef6f74e1aefea66656d68d61ed4a20ef226',
    'requirement': 'Move matching files preserving bytes and unselected files, and raise the documented ValueError for missing directories',
    'test': "import tempfile,unittest\nfrom pathlib import Path\nclass TestCases(TestCases):\n    def test_selected_bytes_and_unselected_files_preserved(self):\n        with tempfile.TemporaryDirectory() as tmp:\n            src,dst=Path(tmp)/'src',Path(tmp)/'dst'\n            src.mkdir();dst.mkdir()\n            moved=b'\\x00\\xffimage\\x80'\n            (src/'move.jpg').write_bytes(moved)\n            (src/'stay.txt').write_text('leave this file',encoding='utf-8')\n            (dst/'existing.bin').write_bytes(b'existing')\n            self.assertEqual(task_func(str(src),str(dst),['.jpg']),1)\n            self.assertEqual({p.name for p in src.iterdir()},{'stay.txt'})\n            self.assertEqual((src/'stay.txt').read_text(encoding='utf-8'),'leave this file')\n            self.assertEqual((dst/'move.jpg').read_bytes(),moved)\n            self.assertEqual((dst/'existing.bin').read_bytes(),b'existing')\n            self.assertEqual({p.name for p in dst.iterdir()},{'move.jpg','existing.bin'})\n    def test_missing_directories_raise_value_error(self):\n        with tempfile.TemporaryDirectory() as tmp:\n            present=Path(tmp)/'present';present.mkdir()\n            absent=Path(tmp)/'absent'\n            with self.assertRaises(ValueError):task_func(str(absent),str(present),['.txt'])\n            with self.assertRaises(ValueError):task_func(str(present),str(absent),['.txt'])\n",
}


BASKET_ADDITION = {
    'promptSha256': '890838609de39d93589cc3fe51f9b025c5955ef6a91a936ba212500238729fa9',
    'requirement': 'Return one Counter for every input basket, including empty baskets, choosing only allowed items',
    'test': '''import unittest
from collections import Counter
class TestCases(TestCases):
    def test_public_counter_type(self):
        baskets=task_func([[1,2,3],[4]])
        self.assertIsInstance(baskets,list)
        self.assertEqual(len(baskets),2)
        for basket in baskets:self.assertIsInstance(basket,Counter)
    def test_one_counter_per_input_including_empty(self):
        for inputs in [[[],[],[]],[[1],[],[2,3]]]:
            baskets=task_func(inputs)
            self.assertEqual(len(baskets),len(inputs))
            for basket,items in zip(baskets,inputs):
                self.assertIsInstance(basket,Counter)
                self.assertEqual(sum(basket.values()),len(items))
''',
}


def revised_development_rows(selected, *, include_salt=False, include_seed=False, include_copy=False, include_pairs=False, include_move=False, include_remaining=False, include_basket=False):
    """Validate all additions before the pack writer creates any output."""
    development = {r['task_id'] for r in selected[:18]}
    additions = {**ADDITIONS, **({'BigCodeBench/130': SALT_ADDITION} if include_salt else {}),
                 **({'BigCodeBench/862': SEED_ADDITION} if include_seed else {}),
                 **({'BigCodeBench/665': COPY_ADDITION} if include_copy else {}),
                 **({'BigCodeBench/931': PAIR_ADDITION} if include_pairs else {})}
    if include_move:
        additions['BigCodeBench/756'] = {**ADDITIONS['BigCodeBench/756'], **MOVE_ADDITION,
            'test': ADDITIONS['BigCodeBench/756']['test'] + '\n' + MOVE_ADDITION['test']}
    if include_remaining:
        from code_remaining_contract_tests import BEHAVIOR_ADDITIONS
        additions.update(BEHAVIOR_ADDITIONS)
    if include_basket:
        additions['BigCodeBench/861'] = {**ADDITIONS['BigCodeBench/861'], **BASKET_ADDITION,
            'test': ADDITIONS['BigCodeBench/861']['test'] + '\n' + BASKET_ADDITION['test']}
    if not additions.keys() <= development:
        raise ValueError('Development contract additions must stay in the reviewed development split')
    revised, receipts = [], {}
    for row in selected:
        addition = additions.get(row['task_id'])
        if addition:
            if hashlib.sha256(row['test'].encode()).hexdigest() != addition['originalTestSha256']:
                raise ValueError('Reviewed original test identity mismatch: ' + row['task_id'])
            correction = {}
            if 'promptSha256' in addition and row['task_id'] != 'BigCodeBench/130':
                if hashlib.sha256(row['complete_prompt'].encode()).hexdigest() != addition['promptSha256']:
                    raise ValueError('Reviewed public prompt identity mismatch: ' + row['task_id'])
                correction['publicPromptSha256'] = addition['promptSha256']
            if row['task_id'] == 'BigCodeBench/130':
                if hashlib.sha256(row['canonical_solution'].encode()).hexdigest() != addition['referenceSha256']:
                    raise ValueError('Reviewed reference identity mismatch: ' + row['task_id'])
                if hashlib.sha256(row['complete_prompt'].encode()).hexdigest() != addition['promptSha256']:
                    raise ValueError('Reviewed public prompt identity mismatch: ' + row['task_id'])
                reference = row['canonical_solution'].replace('salted_data = salt + data', 'salted_data = data + salt')
                prompt = row['complete_prompt'] + addition['clarification']
                correction = {
                    'referenceCorrection': {'beforeSha256': addition['referenceSha256'], 'afterSha256': hashlib.sha256(reference.encode()).hexdigest()},
                    'publicClarification': {'beforeSha256': addition['promptSha256'], 'afterSha256': hashlib.sha256(prompt.encode()).hexdigest(), 'text': addition['clarification']},
                }
                row = {**row, 'canonical_solution': reference, 'complete_prompt': prompt}
            tests = row['test'] + '\n' + addition['test']
            row = {**row, 'test': tests}
            receipts[row['task_id']] = {
                'requirement': addition['requirement'],
                'originalTestSha256': addition['originalTestSha256'],
                'additionSha256': hashlib.sha256(addition['test'].encode()).hexdigest(),
                'combinedTestSha256': hashlib.sha256(tests.encode()).hexdigest(),
                **correction,
            }
        revised.append(row)
    return revised, receipts
