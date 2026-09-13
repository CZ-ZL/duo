# Fixed 14-string NFC corpus, with literal expected compositions.
import base64 as _property_base64
import json as _property_json
import tempfile as _property_tempfile
import unicodedata as _property_unicode
from pathlib import Path as _PropertyPath

_NFC_CASES = [('', ''), ('A', 'A'), ('é', 'é'), ('e\u0301', 'é'),
              ('K', 'K'), ('ﬁ', 'ﬁ'), ('Ａ', 'Ａ'), ('①', '①'),
              ('\u1100\u1161', '가'), ('가', '가'), ('a\u0315\u0300', 'à\u0315'),
              ('😀', '😀'), ('\x00', '\x00'), ('line\nend', 'line\nend')]

class TestCases(TestCases):
    pass


def _make_nfc_property(index, raw, expected, transform):
    def check(self):
        key = f'renamed-键-{index}' if transform == 'renamed' else f'key-{index}'
        text = _property_unicode.normalize('NFD', raw) if transform == 'nfd' else raw
        def call(value):
            with _property_tempfile.TemporaryDirectory() as root:
                path = _PropertyPath(root) / 'input.json'
                path.write_text(_property_json.dumps({key: _property_base64.b64encode(value.encode('utf-8')).decode('ascii')}), encoding='utf-8')
                return task_func(str(path))
        observed = call(text)
        self.assertEqual(observed, {key: expected})
        if transform == 'roundtrip':
            self.assertEqual(call(observed[key]), observed)
    return check


for _index, (_raw, _expected) in enumerate(_NFC_CASES):
    for _transform in ['original', 'nfd', 'renamed', 'roundtrip']:
        setattr(TestCases, f'test_extra_nfc_{_index:02d}_{_transform}',
                _make_nfc_property(_index, _raw, _expected, _transform))
