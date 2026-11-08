import hashlib
from scripts.product.check_docs import scan, check_bilingual


def test_broken_file_and_anchor_are_reported(tmp_path):
    (tmp_path / 'README.md').write_text('[missing](gone.md) [section](other.md#absent)\n')
    (tmp_path / 'other.md').write_text('# Present\n')
    report = scan(tmp_path)
    assert {row['kind'] for row in report['errors']} == {'missing_file', 'missing_anchor'}


def test_headings_duplicates_unicode_and_explicit_anchors(tmp_path):
    (tmp_path / 'README.md').write_text('[a](#重复标题) [b](#重复标题-1) [c](#kept)\n# 重复标题\n# 重复标题\n<a id="kept"></a>\n')
    assert not scan(tmp_path)['errors']


def test_fences_do_not_create_links_or_headings(tmp_path):
    (tmp_path / 'README.md').write_text('```md\n[example](missing.md)\n# Fake\n```\n[fake](#fake)\n')
    report = scan(tmp_path)
    assert len(report['errors']) == 1
    assert report['errors'][0]['kind'] == 'missing_anchor'


def test_reference_links_and_parent_paths(tmp_path):
    (tmp_path / 'sub').mkdir()
    (tmp_path / 'README.md').write_text('# API\n')
    (tmp_path / 'sub/guide.md').write_text('[public][api]\n\n[api]: ../README.md#api\n[missing][bad]\n[bad]: ../missing.md\n')
    assert len(scan(tmp_path)['errors']) == 1


def test_historical_exception_is_bound_to_bytes_and_target(tmp_path):
    f = tmp_path / 'old.md'; f.write_text('[retained](private.json)\n')
    exceptions = [{'source': 'old.md', 'sha256': hashlib.sha256(f.read_bytes()).hexdigest(), 'target': 'private.json', 'kind': 'missing_file'}]
    assert not scan(tmp_path, exceptions)['errors']
    f.write_text(f.read_text()+'[new](another.json)\n')
    errors = scan(tmp_path, exceptions)['errors']
    assert any(r['kind'] == 'stale_exception' for r in errors)
    assert any(r.get('target') == 'another.json' for r in errors)


def test_resolved_exception_must_be_removed(tmp_path):
    f = tmp_path / 'old.md'; f.write_text('[retained](private.json)\n')
    exceptions = [{'source': 'old.md', 'sha256': hashlib.sha256(f.read_bytes()).hexdigest(), 'target': 'private.json', 'kind': 'missing_file'}]
    (tmp_path / 'private.json').write_text('{}')
    assert scan(tmp_path, exceptions)['errors'][0]['kind'] == 'unused_exception'


def test_bilingual_commands_are_exactly_equal(tmp_path):
    (tmp_path / 'en.md').write_text('# English\n```sh\nprintf test\n```\n')
    (tmp_path / 'zh.md').write_text('# 中文\n```sh\nprintf changed\n```\n')
    assert check_bilingual(tmp_path, [('en.md', 'zh.md')])
    (tmp_path / 'zh.md').write_text('# 中文\n```sh\nprintf test\n```\n')
    assert not check_bilingual(tmp_path, [('en.md', 'zh.md')])
