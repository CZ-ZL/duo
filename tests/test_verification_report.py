import json
from pathlib import Path
import subprocess
import sys

from test_agent_api import EXAMPLE, ROOT, experiment
import yaml


def test_comparison_retains_attempts_when_an_arm_fails(tmp_path):
    source, cfg = experiment(tmp_path)
    cfg["generations"] = 1
    adapter = tmp_path / "adapter.py"
    adapter.write_text((EXAMPLE.parent / "adapter.py").read_text() + '''
original = create_bindings
class BrokenGate:
    def select(self, *args):
        raise RuntimeError("fixture gate failure")
def create_bindings(**kwargs):
    values = original(**kwargs)
    values["gate"] = BrokenGate()
    return values
''')
    cfg["agent"]["adapter"] = str(adapter)
    source.write_text(yaml.safe_dump(cfg))
    out = tmp_path / "comparison"
    call = subprocess.run([sys.executable, "scripts/verify_agent_native.py",
                           "--experiment", str(source), "--execute-local",
                           "--repeats", "1", "--output", str(out)],
                          cwd=ROOT, capture_output=True, text=True)
    assert call.returncode == 1, call.stdout + call.stderr  # failed arm must remain failed
    report = json.loads((out / "report.json").read_text())
    failed = next(r for r in report["arms"] if r["arm"] == "dual_loop")
    assert failed["status"] == "failed"
    assert failed["resources"]["fast_attempts"] == 4
    assert failed["resources"]["slow_attempts"] == 1
    assert failed["resources"]["total_cost_usd"] is None
