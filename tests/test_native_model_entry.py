"""Offline admission/replay checks for the named-profile native model launcher."""
import json
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize('complete', [False, True])
def test_live_preparation_checks_composed_provider_settings_before_authorization(tmp_path, complete):
    dsh = os.environ.get('DUO_DSH_PACKAGE')
    if not dsh:
        pytest.skip('Requires explicitly selected cached DSH')
    import yaml
    from datetime import datetime, timezone
    pricing = tmp_path / 'pricing.json'
    pricing.write_text(json.dumps({'id': 'preparation-test-only', 'currency': 'CNY',
        'inputCnyPerMillion': 2, 'cacheReadCnyPerMillion': .04, 'outputCnyPerMillion': 8,
        'verifiedDate': datetime.now(timezone.utc).date().isoformat()}))
    config = {'retryPolicy': {'mode': 'normal', 'maxRetries': 0}}
    if complete:
        config.update(apiKeyEnv='DEEPSEEK_API_KEY', thinking='disabled', maxTokens=2048)
    patch = tmp_path / 'provider.patch.yml'
    patch.write_text(yaml.safe_dump([{'id': 'deepseek', 'config': config}]))
    out = tmp_path / 'out'
    r = subprocess.run([sys.executable, str(ROOT / 'scripts/research/run_dsh_model.py'),
        '--mode', 'prepare-live', '--dsh-package', dsh, '--output', str(out),
        '--profile-patch', str(patch), '--pricing', str(pricing)], cwd=ROOT,
        env={'PATH': os.environ['PATH']}, text=True, capture_output=True, timeout=60)
    assert json.loads((out / 'prepare-receipt.json').read_text())['modelRequests'] == 0
    if complete:
        assert r.returncode == 0, r.stdout + r.stderr
        assert (out / 'prepared.json').exists()
    else:
        assert r.returncode != 0
        assert 'Composed DeepSeek config' in r.stderr
        assert not (out / 'prepared.json').exists()


@pytest.mark.parametrize('unknown', [False, True])
def test_public_native_entry_accepts_evaluation_contract_and_byo_profile_patch(tmp_path, unknown):
    dsh = os.environ.get('DUO_DSH_PACKAGE')
    if not dsh:
        pytest.skip('Requires explicitly selected cached DSH')
    generated = subprocess.run(['node', '--loader', './scripts/product/dsh_native_loader.mjs',
        'examples/native/fact-task.js', '--output', str(tmp_path / 'data')], cwd=ROOT,
        env={'PATH': os.environ['PATH'], 'DUO_DSH_PACKAGE': dsh}, text=True, capture_output=True)
    assert generated.returncode == 0, generated.stderr
    data = tmp_path / 'data/dataset.json'
    key = data.with_name('answerKey.json')
    # Supplied controls only; this transport emits malformed content for the new
    # task. The actual custom evaluator must measure it rather than invent scores.
    spec = {'version': 1, 'id': 'byo-evaluation-entry', 'operation': 'evaluate',
        'target': {'kind': 'dsh-persona', 'path': str(ROOT / 'examples/native/persona.txt')},
        'fast': {'evaluatorId': 'fact-support-fast', 'version': '2',
                 'dataId': json.loads(data.read_text())['fast']['id'], 'metric': 'supported_accuracy',
                 'direction': 'maximize', 'weights': {'supported_accuracy': 1}},
        'slow': None, 'final': None, 'constraints': [], 'epsilon': .01, 'minSamples': 1,
        'generations': 0, 'topK': 0, 'quotas': {'exploit': 0, 'explore': 0, 'innovate': 0},
        'permissions': {'paid': True, 'network': False, 'externalSideEffects': False},
        'budget': {'currency': 'CNY', 'maxCostCny': .2, 'maxSessions': 2,
                   'maxFastEvals': 1, 'maxSlowEvals': 0, 'maxWallTimeMs': 30000}}
    contract = tmp_path / 'contract.json';contract.write_text(json.dumps(spec))
    patch = tmp_path / 'provider.patch.yml'
    import yaml
    overlay = [
        {'id': 'duo-controller', 'disabled': True},
        {'id': 'model-evaluator', 'disabled': True},
        {'id': 'model-generator', 'disabled': True},
        # The default bundle wires the bundled offline fixture; the BYO
        # evaluator below replaces it (duplicate registration fails boot).
        {'id': 'duo-offline-fixture', 'disabled': True},
        {'insert': [
            {'id': 'evaluate-controller', 'name': '@dual-loop/dsh-plugin/evaluation-controller'},
            {'id': 'fact-evaluator', 'name': './fact-evaluator.js',
             'config': {'datasetPath': str(data), 'answerKeyPath': str(key)}},
        ]},
    ]
    if unknown:
        overlay.append({'id': 'fixture', 'config': {'scenario': 'missing-usage', 'datasetPath': str(data)}})
    patch.write_text(yaml.safe_dump(overlay))
    groups = tmp_path / 'groups.json'
    limits = {'currency': 'CNY', 'maxCostCny': .4, 'maxSessions': 2,
              'maxFastEvals': 0, 'maxSlowEvals': 0, 'maxWallTimeMs': 30000}
    groups.write_text(json.dumps([{'id': 'test-whole-batch', 'limits': limits, 'maxModelRequestsPerRun': 1},
        {'id': 'test-pilot', 'limits': {**limits, 'maxCostCny': .2}, 'maxModelRequestsPerRun': 1}]))
    out = tmp_path / 'out'
    command = [sys.executable, str(ROOT / 'scripts/research/run_dsh_model.py'), '--mode', 'offline',
        '--dsh-package', dsh, '--output', str(out), '--dataset', str(data),
        '--contract', str(contract), '--profile-patch', str(patch),
        '--profile-file', str(ROOT / 'examples/native/fact-evaluator.js'),
        '--profile-file', str(ROOT / 'examples/native/fact-task.js'),
        '--budget-groups', str(groups), '--max-cost-cny', '.2', '--max-model-requests', '1']
    r = subprocess.run(command, cwd=ROOT, env={'PATH': os.environ['PATH']}, text=True,
                       capture_output=True, timeout=60)
    result = json.loads((out / 'result.json').read_text())
    report = json.loads((out / 'product-report.json').read_text())
    delivery = json.loads((out / 'delivery-receipt.json').read_text())
    assert report['delivery']['execution']['state'] == result['status']
    assert report['delivery']['caller']['state'] == 'NOT_OBSERVED'
    assert delivery['reportModelRequests'] == 0 and delivery['innerModelRequestsAtExport'] == 1
    assert delivery['artifacts']['state'] == 'FILES_WRITTEN'
    assert delivery['caller']['state'] == 'NOT_USED_BY_THIS_ENTRY'
    for artifact in delivery['artifacts']['files']:
        saved = out / artifact['name']
        assert saved.exists() and hashlib.sha256(saved.read_bytes()).hexdigest() == artifact['sha256']
    assert (out / 'product-report.txt').read_text().strip()
    assert not (out / 'inputs/persona.txt').exists(), 'Configured native paths must not generate unused historical benchmark inputs'
    if unknown:
        assert r.returncode != 0
        assert result['status'] == 'failed'
        for group in ['test-whole-batch', 'test-pilot']:
            budget = json.loads((out / ('group-' + group + '-budget.json')).read_text())
            assert budget['costCny'] is None and budget['blockedReason'] == 'DUO_COST_UNKNOWN'
        return
    assert r.returncode == 0, r.stdout + r.stderr
    assert result['mode'] == 'evaluation_only' and result['generationsRun'] == 0
    assert result['evaluations'][0]['metrics']['supported_accuracy'] == 0
    assert result['evaluations'][0]['metrics']['sample_size'] == 5
    assert json.loads((out / 'run-receipt.json').read_text())['status'] == 'PASS'
    assert (out / 'product-report.json').is_file()
    for group in ['test-whole-batch', 'test-pilot']:
        budget = json.loads((out / ('group-' + group + '-budget.json')).read_text())
        assert budget['costCny'] == result['budget']['costCny']
        assert budget['operations'] == 1 and budget['reservedCostCny'] == 0


def invoke(tmp_path, authorization=None):
    cmd = [sys.executable, str(ROOT / 'scripts/research/run_dsh_model.py'), '--mode', 'execute', '--output', str(tmp_path)]
    if authorization is not None:
        path = tmp_path / 'authorization.json'
        path.write_text(json.dumps(authorization))
        cmd += ['--authorization', str(path)]
    return subprocess.run(cmd, cwd=ROOT, env={'PATH': os.defpath}, text=True, capture_output=True)


def prepared(tmp_path):
    (tmp_path / 'prepared.json').write_text(json.dumps({'maxCostUsd': 1, 'maxModelRequests': 14, 'planDigest': 'frozen-plan', 'fileHashes': {}}))
    auth={'scope': 'native-minimum-two-generation', 'approvedBy': 'user', 'authorizationText': 'test only, never an actual fee authorization', 'maxCostUsd': 1, 'maxModelRequests': 14, 'planDigest': 'frozen-plan'}
    seal(tmp_path,auth)
    return auth


def seal(tmp_path,auth):
    frozen=json.loads((tmp_path/'prepared.json').read_text())
    frozen.pop('manifestDigest',None)
    h=hashlib.sha256(json.dumps(frozen,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    frozen['manifestDigest']=h;auth['manifestDigest']=h
    (tmp_path/'prepared.json').write_text(json.dumps(frozen))


def test_native_entry_rejects_nonfinite_or_unbound_authorization(tmp_path):
    auth = prepared(tmp_path)
    for change in [{'maxCostUsd': float('nan')}, {'maxModelRequests': float('inf')}, {'planDigest': 'another-plan'}]:
        r = invoke(tmp_path, {**auth, **change})
        assert r.returncode == 2
        assert 'authorization does not cover' in r.stderr
        assert not (tmp_path / 'execution-claim.json').exists()


def test_native_entry_requires_explicit_allocation_before_credential_access(tmp_path):
    prepared(tmp_path)
    r = invoke(tmp_path)
    assert r.returncode == 2
    assert 'explicit authorized USD cap' in r.stderr
    assert not (tmp_path / 'authorization-used.json').exists()


def test_format_probe_has_its_own_small_scope_and_rejects_the_parent_run_authority(tmp_path):
    auth=prepared(tmp_path)
    frozen=json.loads((tmp_path/'prepared.json').read_text())
    frozen.pop('maxCostUsd')
    frozen.update(scope='native-maturation-caller-format-probe',currency='CNY',maxCostCny=.5,maxModelRequests=2,batchCarry={'batch':'test-probe-parent'})
    (tmp_path/'prepared.json').write_text(json.dumps(frozen))
    auth.pop('maxCostUsd');auth.update(scope=frozen['scope'],currency='CNY',maxCostCny=.5,maxModelRequests=2,batch='test-probe-parent')
    seal(tmp_path,auth)
    assert 'authorization does not cover' in invoke(tmp_path,{**auth,'scope':'native-maturation-caller-warm-start'}).stderr
    assert 'diagnostic batch binding' in invoke(tmp_path,{**auth,'batch':'a-different-allocation'}).stderr
    accepted=invoke(tmp_path,auth)
    assert accepted.returncode==2 and 'DEEPSEEK_API_KEY is absent' in accepted.stderr
    assert not (tmp_path/'execution-claim.json').exists()


def test_native_entry_reads_a_terminal_result_without_rewriting_evidence(tmp_path):
    prepared(tmp_path)
    result = tmp_path / 'result.json'
    result.write_text('{"status":"completed","runId":"frozen-plan","planDigest":"frozen-plan","budget":{"costUsd":0.2}}\n')
    before = result.read_bytes()
    r = invoke(tmp_path)
    assert r.returncode == 0
    assert 'Retained terminal result' in r.stdout
    assert result.read_bytes() == before
    assert not (tmp_path / 'commands.json').exists()


def test_native_entry_does_not_replay_a_crashed_claim(tmp_path):
    auth = prepared(tmp_path)
    (tmp_path / 'execution-claim.json').write_text('{"pid":123}\n')
    r = invoke(tmp_path, auth)
    assert r.returncode == 2
    assert 'Existing execution claim' in r.stderr


def test_native_entry_refuses_new_ambient_configuration_without_reading_it(tmp_path):
    auth = prepared(tmp_path)
    frozen = json.loads((tmp_path / 'prepared.json').read_text())
    frozen['absentPaths'] = [str(tmp_path / '.env')]
    (tmp_path / 'prepared.json').write_text(json.dumps(frozen))
    seal(tmp_path,auth)
    (tmp_path / '.env').write_text('FAKE_TEST_ONLY=must_not_appear_in_output\n')
    r = invoke(tmp_path, auth)
    assert r.returncode == 2
    assert 'Unexpected launch configuration' in r.stderr
    assert 'must_not_appear_in_output' not in r.stdout + r.stderr


def test_native_entry_does_not_accept_another_plans_terminal_result(tmp_path):
    prepared(tmp_path)
    (tmp_path / 'result.json').write_text('{"status":"completed","runId":"other-plan","planDigest":"other-plan"}\n')
    r = invoke(tmp_path)
    assert r.returncode == 2
    assert 'Terminal result belongs to another plan' in r.stderr


def test_native_entry_refuses_a_new_nearer_module_shadow_before_credentials(tmp_path):
    auth = prepared(tmp_path)
    root = tmp_path / 'node_modules'
    frozen = json.loads((tmp_path / 'prepared.json').read_text())
    frozen['moduleInventory'] = {str(root): {'exists': False, 'entries': {}}}
    (tmp_path / 'prepared.json').write_text(json.dumps(frozen))
    seal(tmp_path,auth)
    shadow = root / '@deepseek-ai/dsh-llm'
    shadow.mkdir(parents=True)
    (shadow / 'package.json').write_text('{"type":"module","main":"index.js"}')
    (shadow / 'index.js').write_text('throw new Error("shadow must never execute")')
    r = invoke(tmp_path, auth)
    assert r.returncode == 2
    assert 'Module resolution inventory changed' in r.stderr
    assert 'shadow must never execute' not in r.stdout + r.stderr


def test_cny_authorization_cannot_be_relabelled_from_usd(tmp_path):
    auth = prepared(tmp_path)
    frozen = json.loads((tmp_path / 'prepared.json').read_text())
    frozen.pop('maxCostUsd')
    frozen.update(currency='CNY', maxCostCny=3)
    (tmp_path / 'prepared.json').write_text(json.dumps(frozen))
    seal(tmp_path,auth)
    r = invoke(tmp_path, auth)
    assert r.returncode == 2
    assert 'authorization does not cover' in r.stderr
    assert not (tmp_path / 'execution-claim.json').exists()
    auth.pop('maxCostUsd')
    auth.update(currency='CNY', maxCostCny=3)
    r = invoke(tmp_path, auth)
    assert r.returncode == 2
    assert 'DEEPSEEK_API_KEY is absent' in r.stderr
    for change in [{'currency': 'USD'}, {'maxCostCny': float('nan')}, {'maxCostCny': 2.99}, {'maxCostUsd': 3}]:
        r = invoke(tmp_path, {**auth, **change})
        assert r.returncode == 2
        assert 'authorization does not cover' in r.stderr


def test_maturation_scope_requires_its_own_sealed_cny_allocation(tmp_path):
    # Pure admission fixture. No credentials are inherited and no host launches.
    scope = 'native-maturation-caller-warm-start'
    frozen = {'scope': scope, 'currency': 'CNY', 'maxCostCny': 4,
              'maxModelRequests': 40, 'planDigest': 'new-maturation-plan', 'fileHashes': {}}
    (tmp_path / 'prepared.json').write_text(json.dumps(frozen))
    auth = {'scope': scope, 'currency': 'CNY', 'maxCostCny': 4,
            'maxModelRequests': 40, 'planDigest': frozen['planDigest'],
            'approvedBy': 'user', 'authorizationText': 'TEST ONLY; not actual authority'}
    seal(tmp_path, auth)
    valid = invoke(tmp_path, auth)
    assert valid.returncode == 2
    assert 'DEEPSEEK_API_KEY is absent' in valid.stderr
    for change in [{'scope': 'native-model-caller'}, {'planDigest': 'old-batch'},
                   {'maxModelRequests': 2}, {'maxCostCny': 3.75},
                   {'approvedBy': None}, {'manifestDigest': 'old-manifest'}]:
        refused = invoke(tmp_path, {**auth, **change})
        assert refused.returncode == 2
        assert 'DEEPSEEK_API_KEY is absent' not in refused.stderr
        assert not (tmp_path / 'execution-claim.json').exists()


def test_attempt_caps_cannot_increase_the_cny_allocation(tmp_path):
    for args in [['--max-cost-cny', 'nan'], ['--max-cost-cny', '3.01'], ['--max-model-requests', '15'], ['--max-model-requests', '0']]:
        r = subprocess.run([sys.executable, str(ROOT / 'scripts/research/run_dsh_model.py'), '--mode', 'prepare-live', '--output', str(tmp_path / 'unused'), *args], env={'PATH': os.defpath}, text=True, capture_output=True)
        assert r.returncode == 2
        assert 'Attempt limits require' in r.stderr
        assert not (tmp_path / 'unused').exists()


def test_maturation_continuation_cannot_ignore_prior_consumption(tmp_path):
    scope = 'native-maturation-caller-warm-start'
    frozen = {'scope': scope, 'currency': 'CNY', 'maxCostCny': 4,
              'maxModelRequests': 40, 'planDigest': 'continuation-plan', 'fileHashes': {},
              'continuationInput': str(tmp_path / 'missing-consumption.json'),
              'batchCarry': {'batch': 'already-consumed-batch', 'priorRequests': 6,
                             'priorCostCny': .05, 'callerRemaining': 14, 'innerRemaining': 20}}
    (tmp_path / 'prepared.json').write_text(json.dumps(frozen))
    auth = {'scope': scope, 'currency': 'CNY', 'maxCostCny': 4,
            'maxModelRequests': 40, 'planDigest': frozen['planDigest'],
            'batch': 'already-consumed-batch', 'approvedBy': 'user',
            'authorizationText': 'TEST ONLY, NO REAL AUTHORITY'}
    seal(tmp_path, auth)
    result = invoke(tmp_path, auth)
    assert result.returncode == 2
    assert 'continuation' in result.stderr.lower()
    assert 'DEEPSEEK_API_KEY is absent' not in result.stderr
    assert not (tmp_path / 'execution-claim.json').exists()


def test_native_comparison_arm_reuses_named_host_and_independent_final(tmp_path):
    import pytest
    dsh = os.environ.get('DUO_DSH_PACKAGE')
    if not dsh:
        pytest.skip('Set DUO_DSH_PACKAGE to an existing cached installation for host acceptance')
    for arm, generations, mode in [('baseline', 0, 'optimize'), ('single_loop', 2, 'fast_only'), ('dual_loop', 2, 'optimize')]:
        out = tmp_path / arm
        r = subprocess.run([sys.executable, str(ROOT / 'scripts/research/run_dsh_model.py'), '--mode', 'offline',
            '--output', str(out), '--dsh-package', dsh, '--arm', arm,
            '--candidates-per-generation', '1'], cwd=ROOT, env={'PATH': os.environ['PATH']}, text=True, capture_output=True, timeout=60)
        assert r.returncode == 0, r.stderr + r.stdout
        result = json.loads((out / 'result.json').read_text())
        receipt = json.loads((out / 'run-receipt.json').read_text())
        assert result['mode'] == mode
        assert result['generationsRun'] == generations
        assert len(result['final']) >= 1
        assert receipt['status'] == 'PASS'
        assert receipt['paidCalls'] == 0


def test_minimum_authorization_cannot_admit_a_comparison_arm(tmp_path):
    auth = prepared(tmp_path)
    frozen = json.loads((tmp_path / 'prepared.json').read_text())
    frozen['scope'] = 'native-comparison-arm'
    (tmp_path / 'prepared.json').write_text(json.dumps(frozen))
    r = invoke(tmp_path, auth)
    assert r.returncode == 2
    assert 'authorization does not cover' in r.stderr


def test_runtime_header_drift_is_refused_before_credential_access(tmp_path):
    auth=prepared(tmp_path)
    frozen=json.loads((tmp_path/'prepared.json').read_text())
    frozen['dshPackage']='/tmp/unreviewed-runtime'
    (tmp_path/'prepared.json').write_text(json.dumps(frozen))
    r=invoke(tmp_path,auth)
    assert r.returncode==2 and 'manifest digest mismatch' in r.stderr
    assert not (tmp_path/'execution-claim.json').exists()


def test_rejected_preparation_leaves_no_output_directory(tmp_path):
    """Validation failure must not poison the caller's new output directory name."""
    pricing = tmp_path / 'pricing.json'
    pricing.write_text(json.dumps({'id': 'stale-test-only', 'currency': 'CNY',
        'inputCnyPerMillion': 2, 'cacheReadCnyPerMillion': .04, 'outputCnyPerMillion': 8,
        'verifiedDate': '2000-01-01'}))
    out = tmp_path / 'out'
    r = subprocess.run([sys.executable, str(ROOT / 'scripts/research/run_dsh_model.py'),
        '--mode', 'prepare-live', '--dsh-package', '/nonexistent-dsh', '--output', str(out),
        '--pricing', str(pricing)], cwd=ROOT, env={'PATH': os.environ['PATH']}, text=True,
        capture_output=True, timeout=60)
    assert r.returncode != 0
    assert 'UTC' in r.stderr
    assert not out.exists(), 'A rejected attempt must not create the output directory'


def test_offline_run_exports_unique_candidates_and_named_skips(tmp_path):
    dsh = os.environ.get('DUO_DSH_PACKAGE')
    if not dsh:
        pytest.skip('Requires explicitly selected cached DSH')
    out = tmp_path / 'out'
    r = subprocess.run([sys.executable, str(ROOT / 'scripts/research/run_dsh_model.py'), '--mode', 'offline',
        '--dsh-package', dsh, '--output', str(out), '--fixture-scenario', 'improve'], cwd=ROOT,
        env={'PATH': os.environ['PATH']}, text=True, capture_output=True, timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr
    ids = [c['id'] for c in json.loads((out / 'candidates.json').read_text())]
    assert len(ids) == len(set(ids)), 'candidates.json must not contain duplicate rows'
    text = (out / 'product-report.txt').read_text()
    assert 'duplicate_of dl-0001' in text
    assert 'FAST_NOT_BETTER [' in text
