"""Reviewed finite behavior checks for five existing development tasks."""

BEHAVIOR_ADDITIONS = {
    'BigCodeBench/911': {
        'originalTestSha256': '0debcfa883f35078759206db43228da939efeb86e685784ab068de59d4855cd0',
        'promptSha256': '600df539ea9d6e4f03446ac98e493b08b7d339463cb312c5a2c6e4e9ba53ceb9',
        'requirement': 'Multiply the contribution of every uppercase letter occurrence, including repetitions',
        'test': '''import unittest
class TestCases(TestCases):
    def test_repeated_letters_multiply_each_occurrence(self):
        for letters,expected in [(['B','B'],4),(['Z','Z'],676),(['C','B','C'],18)]:
            self.assertEqual(task_func(letters),expected)
''',
    },
    'BigCodeBench/769': {
        'originalTestSha256': 'eca1b348d7eff18c09f7b2084052a89a26e762d26ff8a4c847aa46836cc5c440',
        'promptSha256': 'a7236783f160da440dd8411bb6fac827ccf8c72f87abe23535e7729cdd8330e8',
        'requirement': 'Select the most frequent menu item even when it is not first; no new tie rule',
        'test': '''import unittest
class TestCases(TestCases):
    def test_unique_winner_need_not_be_first(self):
        self.assertEqual(task_func([['Soup'],['Pie','Pie'],['Pie','Soup']]),'Pie')
        self.assertEqual(task_func([['Rice','Soup'],['Soup'],['Bread']]),'Soup')
''',
    },
    'BigCodeBench/288': {
        'originalTestSha256': '506895356e33f97cdac26fb3b1775b8a22439dd6546c50118fe69cec6719ffc5',
        'promptSha256': 'd489f0ff3d97d52d6ea873c1e24b1f8512025a17208882891981b418c624b198',
        'requirement': 'Count top-level keys from JSON files only, ignoring non-JSON files',
        'test': '''import json,tempfile,unittest
from pathlib import Path
class TestCases(TestCases):
    def test_count_top_level_keys_of_json_files_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)
            (p/'a.json').write_text(json.dumps({'x':4,'y':{'nested':7}}))
            (p/'b.json').write_text(json.dumps({'x':5,'z':0}))
            (p/'ignore.txt').write_text(json.dumps({'decoy':1}))
            self.assertEqual(task_func(tmp),{'x':2,'y':1,'z':1})
''',
    },
    'BigCodeBench/358': {
        'originalTestSha256': '0cb7521183858bae4c02c93208d4d0f2e3afbe16125994daf5ae2693029c75e4',
        'promptSha256': '03b7dcf3b67a4ef188bb91f9aecebfc9d1c294f84fe979ccc4c0c635aafa6c18',
        'requirement': 'Retain repeated input positions in combinations and reject documented invalid input',
        'test': '''import unittest
class TestCases(TestCases):
    def test_combinations_preserve_repeated_input_positions(self):
        self.assertEqual(task_func('{"number_list":[1,1,2]}',2),[(1,1),(1,2),(1,2)])
    def test_documented_invalid_json_and_missing_key(self):
        for value in ['', 'bad JSON', '{}']:
            with self.assertRaises(Exception):task_func(value,1)
''',
    },
    'BigCodeBench/762': {
        'originalTestSha256': 'c331d552c8ac3cb7d76c711b1167bbf84f317ce5edf441e6d7fbd8ff3ed0da1c',
        'promptSha256': '52c70c4ca247e21388bbee143b93fb69dac43861a1b4eaeab15133b0613f68bd',
        'requirement': 'Archive the requested encoded file bytes, not merely create correct source files',
        'test': '''import os,tempfile,unittest,zipfile
from pathlib import Path
class TestCases(TestCases):
    def test_latin1_archive_bytes_not_only_original_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            cwd=os.getcwd()
            try:
                os.chdir(tmp)
                zipped=task_func('archive_probe','Sopetón',['one.txt','two.txt'],'latin-1')
                self.assertEqual(zipped,'archive_probe.zip')
                expected='Sopetón'.encode('latin-1')
                with zipfile.ZipFile(zipped) as archive:
                    files=[name for name in archive.namelist() if not name.endswith('/')]
                    self.assertEqual(sorted(Path(name).name for name in files),['one.txt','two.txt'])
                    for name in files:self.assertEqual(archive.read(name),expected)
                for name in ['one.txt','two.txt']:
                    self.assertEqual((Path('archive_probe')/name).read_bytes(),expected)
            finally:os.chdir(cwd)
''',
    },
}
