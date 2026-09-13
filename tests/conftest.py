import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def pytest_configure(config):
    config.addinivalue_line('markers', 'research: requires retained experiment or benchmark artifacts; see TESTING.md')


def pytest_collection_modifyitems(items):
    import json
    import pytest
    mapping = json.loads((Path(__file__).parent / 'research_cases.json').read_text())['tests']
    for item in items:
        if getattr(item, 'originalname', None) in mapping.get(item.path.name, []):
            item.add_marker(pytest.mark.research)
