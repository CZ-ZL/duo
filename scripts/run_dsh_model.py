#!/usr/bin/env python3
"""Prepare or execute the native minimum model optimization in a new DSH profile.

offline: synthetic model boundary, full native two-generation functionality.
prepare-live: actual provider composition and inspected plan, no model requests.
execute: requires a prepared directory and explicit recorded monetary authorization.
"""
import argparse
import json
import math
import os
from pathlib import Path
import shutil
import yaml
from datetime import datetime, timezone
from dsh_model_profile import Profile, ROOT, agent_entries, save, sha, module_inventory, manifest_digest, seal_manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['offline', 'prepare-live', 'execute'], required=True)
    parser.add_argument('--dsh-package', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--authorization', type=Path)
    parser.add_argument('--arm', choices=['minimum', 'baseline', 'single_loop', 'dual_loop'], default='minimum')
    parser.add_argument('--dataset', type=Path, help='A frozen supplied-context dataset; copied into this new run before planning')
    parser.add_argument('--max-cost-cny', type=float, default=3, help='This attempt cap, never above CNY 3; deduct earlier known charges before a corrected attempt')
    parser.add_argument('--max-model-requests', type=int, default=14, help='Finite attempt cap: at most14 for bundled experiments or19 for an explicit native contract; not spending authority')
    parser.add_argument('--candidates-per-generation', type=int, choices=[1, 3], default=3, help='Use one candidate for the smallest two-generation allocation')
    parser.add_argument('--fixture-scenario', choices=['retain', 'improve'], default='retain')
    parser.add_argument('--pricing', type=Path, help='Fresh frozen official CNY price table for prepare-live')
    parser.add_argument('--contract', type=Path, help='Use an existing native contract; no task-specific contract is synthesized')
    parser.add_argument('--profile-patch', type=Path, help='Reviewed ordinary Cordis patch for public provider replacement')
    parser.add_argument('--profile-file', type=Path, action='append', default=[], help='Reviewed local provider module staged beside the profile; repeat for its helpers')
    parser.add_argument('--model-config', type=Path, help='Existing native model configuration overrides, frozen with the plan')
    parser.add_argument('--generator', choices=['model-generator', 'structured-generator'], default='model-generator',
                        help='Existing native generator provider; structured mode requires history-feedback')
    parser.add_argument('--budget-groups', type=Path, help='Existing native monetary ledgers to reserve this entire experiment against')
    parser.add_argument('--runtime-cwd', type=Path, help='Existing working directory for persona variables; frozen for execution, profile and Journal remain isolated')
    args = parser.parse_args()
    request_ceiling = 19 if args.contract else 14
    if not math.isfinite(args.max_cost_cny) or not 0 < args.max_cost_cny <= 3 or not 1 <= args.max_model_requests <= request_ceiling:
        parser.error(f'Attempt limits require finite CNY in (0, 3] and integer requests in [1, {request_ceiling}]')
    if args.mode == 'execute':
        out = args.output.resolve()
        frozen = json.loads((out / 'prepared.json').read_text())
        runtime_cwd = Path(frozen.get('runtimeCwd', str(out))).resolve()
        if args.runtime_cwd and args.runtime_cwd.resolve() != runtime_cwd:
            parser.error('Frozen runtime working directory cannot be overridden')
        if not runtime_cwd.is_dir():parser.error('Frozen runtime working directory is unavailable')
        if (out / 'result.json').exists():
            result = json.loads((out / 'result.json').read_text())
            if result.get('planDigest') != frozen['planDigest'] or result.get('runId') != frozen['planDigest']:
                parser.error('Terminal result belongs to another plan; inspect this directory before reuse')
            print('Retained terminal result; no execution and no evidence rewritten:', json.dumps(result))
            return 0 if result.get('status') == 'completed' else 2
        if (out / 'execution-claim.json').exists() or any((out / 'journal').glob('*/duo.sqlite')):
            parser.error('Existing execution claim or journal: inspect retained accounting; no blind replay')
        currency = frozen.get('currency', 'USD')
        cap_key = 'maxCostCny' if currency == 'CNY' else 'maxCostUsd'
        other_cap = 'maxCostUsd' if currency == 'CNY' else 'maxCostCny'
        if not args.authorization:
            parser.error(f'An explicit authorized {currency} cap and model-request cap are required; see prepared.json. Old ledger caps are not inferred.')
        authorization = json.loads(args.authorization.read_text())
        finite_amount = lambda value: isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0
        if (currency not in ['CNY', 'USD'] or authorization.get('currency', 'USD') != currency or
                other_cap in authorization or other_cap in frozen or
                frozen.get('scope', 'native-minimum-two-generation') not in ['native-minimum-two-generation', 'native-comparison-arm', 'native-model-caller', 'native-maturation-caller-warm-start', 'native-maturation-caller-format-probe', 'native-configured-experiment', 'native-configured-caller'] or
                authorization.get('scope') != frozen.get('scope', 'native-minimum-two-generation') or
                authorization.get('approvedBy') != 'user' or not authorization.get('authorizationText') or
                authorization.get('planDigest') != frozen['planDigest'] or
                not finite_amount(authorization.get(cap_key)) or
                not finite_amount(authorization.get('maxModelRequests')) or
                not float(authorization['maxModelRequests']).is_integer() or
                authorization.get(cap_key, 0) < frozen[cap_key] or
                authorization.get('maxModelRequests', 0) < frozen['maxModelRequests']):
            parser.error('Recorded user authorization does not cover this frozen batch')
        if frozen.get('scope') == 'native-maturation-caller-format-probe' and (
                frozen.get('maxCostCny') != .5 or frozen.get('maxModelRequests') != 2 or
                not frozen.get('batchCarry', {}).get('batch') or
                authorization.get('batch') != frozen['batchCarry']['batch']):
            parser.error('Invalid diagnostic batch binding or fixed two-request allowance')
        if (not frozen.get('manifestDigest') or manifest_digest(frozen) != frozen['manifestDigest'] or
                authorization.get('manifestDigest') != frozen['manifestDigest']):
            parser.error('Prepared launch manifest digest mismatch or unsealed legacy preparation; prepare a fresh directory and bind its manifestDigest')
        if frozen.get('scope') == 'native-maturation-caller-warm-start' and ('continuationInput' in frozen or 'batchCarry' in frozen):
            try:
                from maturation_batch import continuation_allocation
                carry = continuation_allocation(frozen['continuationInput'])
                if (carry != frozen.get('batchCarry') or authorization.get('batch') != carry['batch']
                        or any(frozen.get(k) != carry[k] or authorization.get(k) != carry[k] for k in ['maxCostCny', 'maxModelRequests'])
                        or any(frozen.get(k + 'RequestCap') != carry[k + 'Remaining'] or authorization.get(k + 'RequestCap') != carry[k + 'Remaining'] for k in ['caller', 'inner'])):
                    raise ValueError('Consumed amounts or remaining caps/batch differ')
            except (ValueError, KeyError, TypeError, OSError) as error:
                parser.error('Invalid maturation continuation: ' + str(error))
        for path, expected in frozen['fileHashes'].items():
            if sha(Path(path)) != expected:
                parser.error('Prepared input or plugin changed: ' + path)
        for path in frozen.get('absentPaths', []):
            if Path(path).exists() or Path(path).is_symlink():
                parser.error('Unexpected launch configuration appeared; inspect it without running: ' + path)
        expected_modules = frozen.get('moduleInventory', {})
        if module_inventory(expected_modules) != expected_modules:
            parser.error('Module resolution inventory changed; inspect added or redirected packages before preparing a new plan')
        if not os.environ.get('DEEPSEEK_API_KEY'):
            parser.error('DEEPSEEK_API_KEY is absent; no provider request made')
        # Existing named profile only; explicit values never printed or saved.
        host = object.__new__(Profile)
        host.output, host.dsh, host.node = out, Path(frozen['dshPackage']), shutil.which('node')
        host.env = {'PATH': str(Path(host.node).parent) + os.pathsep + os.defpath,
                    'DSH_HOME': str(out / 'dsh-home'), 'DSH_TELEMETRY_DISABLED': '1',
                    'DUO_MODEL_RUN_ENABLED': '1', 'DEEPSEEK_API_KEY': os.environ['DEEPSEEK_API_KEY']}
        host.commands = json.loads((out / 'commands.json').read_text())
        with (out / 'execution-claim.json').open('x') as claim:
            json.dump({'pid': os.getpid(), 'planDigest': frozen['planDigest'], 'authorizationSha256': sha(args.authorization)}, claim)
            claim.flush()
            os.fsync(claim.fileno())
        save(out / 'authorization-used.json', authorization)
        command = [host.node, str(host.dsh / 'lib/bin.js'), '--profile', frozen['profile']]
        for patch in frozen.get('patchPaths', []):
            command += ['--patch', patch]
        r = host.execute('authorized-live-boot', command, timeout=1500, cwd=runtime_cwd)
        print('live exit:', r.returncode, 'retained output:', out)
        return r.returncode

    if not args.dsh_package:
        parser.error('--dsh-package must name the already cached installation')
    if args.contract and not args.dataset:
        parser.error('A configured native contract needs its explicit dataset; no historical benchmark is inferred')
    runtime_cwd = args.runtime_cwd.resolve() if args.runtime_cwd else args.output.resolve()
    runtime_absent = [runtime_cwd / name for name in ['.env', 'cordis.yml', 'cordis.patch.yml']] if args.runtime_cwd else []
    if args.runtime_cwd and (not runtime_cwd.is_dir() or any(p.exists() or p.is_symlink() for p in runtime_absent)):
        parser.error('Explicit runtime directory must exist without ambient .env or Cordis configuration')
    # Validate every caller input before creating the output directory: a
    # rejected attempt must not poison the new directory name.
    live = args.mode == 'prepare-live'
    pricing = ({'id': 'deepseek-flash-cny-20260910', 'currency': 'CNY', 'inputCnyPerMillion': 2,
                'cacheReadCnyPerMillion': .04, 'outputCnyPerMillion': 8,
                'source': 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/', 'verifiedDate': '2026-09-10',
                'schedule': 'deepseek-weekday-utc-v1'} if live else
               {'id': 'synthetic-cny-test-only', 'currency': 'CNY', 'inputCnyPerMillion': 3, 'cacheReadCnyPerMillion': .1, 'outputCnyPerMillion': 9})
    if live and args.pricing:
        pricing = json.loads(args.pricing.read_text())
    if live and pricing.get('verifiedDate') != datetime.now(timezone.utc).date().isoformat():
        parser.error('Refresh the official price table verified on the current UTC date ('
                     + datetime.now(timezone.utc).date().isoformat() + ') and provide --pricing before preparing a model run')
    if pricing.get('currency') != 'CNY' or any('Usd' in key for key in pricing):
        parser.error('This entry requires an explicit CNY tariff; USD tables cannot be relabelled')
    contract = None
    if args.contract:
        contract = json.loads(args.contract.read_text())
        if contract.get('budget', {}).get('currency') != 'CNY' or contract['budget'].get('maxCostCny') != args.max_cost_cny:
            parser.error('Supplied contract must match the explicit CNY attempt cap')
        target = Path(contract['target']['path'])
        contract['target']['path'] = str((args.contract.parent / target).resolve())
    data = json.loads(args.dataset.read_text()) if args.dataset else None
    model_config = json.loads(args.model_config.read_text()) if args.model_config else None
    groups = json.loads(args.budget_groups.read_text()) if args.budget_groups else []
    overlay = []
    if args.profile_patch:
        overlay = yaml.safe_load(args.profile_patch.read_text())
        if not isinstance(overlay, list):
            parser.error('Profile patch must use the existing Cordis list format')
    if (any(not file.is_file() or file.suffix not in ['.js', '.mjs', '.json', '.py'] for file in args.profile_file)
            or len({file.name for file in args.profile_file}) != len(args.profile_file)):
        parser.error('Provider files must be existing local modules/helpers/data with unique nonreserved profile names')
    host = Profile(args.dsh_package, args.output)
    if args.contract:
        (host.output / 'inputs').mkdir()
    else:
        # Retained legacy demo path only. A supplied native experiment does not
        # import or generate unrelated historical benchmark inputs.
        from prepare_native_docs_mini import prepare
        prepared = prepare(host.output / 'inputs')
        data = data if data is not None else prepared
    if args.dataset:
        save(host.output / 'inputs/dataset.json', data)
        save(host.output / 'inputs/dataset-source.json', {'path': str(args.dataset.resolve()), 'sha256': sha(args.dataset),
             'note': 'Supplied frozen dataset replaces the default mini slice; provenance and contamination limits belong to the comparison contract.'})
    host.pack()
    save(host.output / 'pricing.json', pricing)
    if not args.contract:
        objective = lambda tier: {'evaluatorId': 'native-docs-qa-' + tier, 'version': '1', 'dataId': data[tier]['id'], 'metric': 'quality', 'weights': {'quality': 1}, 'direction': 'maximize'}
        contract = {'version': 1, 'id': 'native-model-minimum', 'target': {'kind': 'dsh-persona', 'path': 'inputs/persona.txt'},
            **{tier: objective(tier) for tier in ['fast', 'slow', 'final']},
            'constraints': [{'metric': 'grounded', 'op': '==', 'value': True}], 'epsilon': .01, 'minSamples': 4,
            'generations': 2, 'quotas': {'exploit': 1, 'explore': 1 if args.candidates_per_generation == 3 else 0, 'innovate': 1 if args.candidates_per_generation == 3 else 0}, 'topK': 1,
            'permissions': {'paid': True, 'network': live, 'externalSideEffects': False},
            'budget': {'currency': 'CNY', 'maxCostCny': args.max_cost_cny, 'maxSessions': 26, 'maxFastEvals': 7, 'maxSlowEvals': 5, 'maxWallTimeMs': 1400000}}
        if args.arm != 'minimum':
            contract['id'] = 'native-comparison-' + args.arm
            if args.arm == 'baseline':contract['generations'] = 0
            elif args.arm == 'single_loop':contract.pop('slow')
    save(host.output / 'experiment.json', contract)
    provider = {'provider': 'deepseek-official' if live else 'duo-offline', 'model': 'deepseek-flash' if live else 'fixture',
        'datasetPath': str(host.output / 'inputs/dataset.json'), 'artifactRoot': str(host.output / 'sessions'),
        'evidenceKind': 'model' if live else 'fixture', 'maxTokens': 2048, 'maxInputBytes': 32768,
        'timeoutMs': 90000 if live else 5000, 'currency': 'CNY', 'reservationCny': .15, 'pricing': pricing}
    if model_config:
        provider.update(model_config)
        # The selected input copy and freshly supplied tariff stay authoritative.
        provider.update(datasetPath=str(host.output / 'inputs/dataset.json'), artifactRoot=str(host.output / 'sessions'), pricing=pricing)
    entries = agent_entries() + [
        {'id': 'deepseek-extensions', 'name': '@deepseek-ai/dsh-deepseek-llm-api-extensions'},
        {'id': 'duo-json-output', 'name': '@dual-loop/dsh-plugin/json-output', 'config': {'artifactRoot': str(host.output / 'request-formats')}},
        ({'id': 'deepseek', 'name': '@deepseek-ai/dsh-llm-deepseek', 'config': {'apiKeyEnv': 'DEEPSEEK_API_KEY', 'thinking': 'disabled', 'maxTokens': provider['maxTokens'], 'retryPolicy': {'mode': 'normal', 'maxRetries': 0}}} if live else {'id': 'fixture', 'name': './dsh_model_fixture.js', 'config': {'scenario': args.fixture_scenario, 'datasetPath': provider['datasetPath']}}),
        {'id': 'model-generator', 'name': '@dual-loop/dsh-plugin/' + args.generator, 'config': provider},
        {'id': 'model-executor', 'name': '@dual-loop/dsh-plugin/model-executor', 'config': provider},
        {'id': 'model-evaluator', 'name': '@dual-loop/dsh-plugin/docs-evaluators', 'config': {'datasetPath': provider['datasetPath'], 'artifactRoot': str(host.output / 'judgments'), 'evidenceKind': provider['evidenceKind'], 'currency': 'CNY'}},
        {'id': 'model-entry', 'name': './dsh_model_run_host.js', 'config': {'output': str(host.output), 'live': live, 'maxModelRequests': args.max_model_requests, 'requiredGenerations': contract['generations'], 'arm': args.arm, 'budgetGroups': groups}}]
    patches = [{'id': 'duo-contract', 'config': {'experiment': str(host.output / 'experiment.json')}},
               {'id': 'duo-journal', 'config': {'root': str(host.output / 'journal')}},
               # The default bundle wires the bundled offline fixture; the model
               # providers below replace it (duplicate service registration fails boot).
               {'id': 'duo-offline-fixture', 'disabled': True}, {'insert': entries}]
    name = 'duo-model-minimum'
    scripts = ['dsh_model_run_host.js'] + ([] if live else ['dsh_model_fixture.js'])
    profile = host.stage(name, patches, scripts, bundles=['@dual-loop/dsh-plugin'])
    patch_paths = []
    if args.profile_patch:
        staged_patch = profile / 'providers.patch.yml'
        shutil.copyfile(args.profile_patch, staged_patch)
        patch_paths.append(staged_patch)
    provider_files = []
    for file in args.profile_file:
        dest = profile / file.name
        if dest.exists():
            parser.error('Provider files must be existing local modules/helpers/data with unique nonreserved profile names')
        shutil.copyfile(file, dest);provider_files.append(dest)
    absent = [host.output / '.env', host.output / 'dsh-home/.env', host.output / 'dsh-home/cordis.patch.yml', *runtime_absent]
    if any(p.exists() or p.is_symlink() for p in absent):
        parser.error('New isolated profile contains unexpected ambient configuration')
    r = host.boot(name, timeout=60, patches=patch_paths, cwd=runtime_cwd)
    if live and r.returncode == 0:
        # Cordis replaces the whole config object. Inspect the actual composed
        # provider rather than assuming that a partial patch retained defaults.
        composed = yaml.safe_load((host.output / (name + '-config.stdout.txt')).read_text())
        routes = [row for row in composed if row.get('name') == '@deepseek-ai/dsh-llm-deepseek' and not row.get('disabled')]
        c = routes[0].get('config', {}) if len(routes) == 1 else {}
        retry = c.get('retryPolicy', {})
        if (c.get('thinking') not in ['enabled', 'disabled'] or c.get('maxTokens') != provider['maxTokens'] or
                retry.get('mode') != 'normal' or retry.get('maxRetries') != 0):
            parser.error('Composed DeepSeek config must explicitly bind thinking, the planned maxTokens and zero retries; Cordis config patches replace the whole object')
        files = [host.output / 'experiment.json', host.output / 'pricing.json', *sorted((host.output / 'inputs').glob('*')),
                 profile / 'package.json', profile / 'cordis.patch.yml', profile / 'dsh_model_run_host.js',
                 *[profile / 'node_modules/@dual-loop/dsh-plugin' / f for f in host.files]]
        files += [ROOT / 'scripts/run_dsh_model.py', ROOT / 'scripts/dsh_model_profile.py']
        files += provider_files + patch_paths + [p.resolve() for p in [args.contract, args.profile_patch, args.model_config, args.budget_groups, *args.profile_file] if p]
        files.append(Path(contract['target']['path']) if Path(contract['target']['path']).is_absolute() else host.output / contract['target']['path'])
        if args.contract:
            # Public BYO provider config may reference files outside the profile;
            # require explicit --profile-file copies or bind their source paths
            # through the supplied configuration manifest before live dispatch.
            for row in patches + overlay + [item for op in overlay for item in op.get('insert', [])]:
                for value in (row.get('config') or {}).values():
                    if isinstance(value, str) and Path(value).is_absolute() and Path(value).is_file():
                        files.append(Path(value))
        runtime_packages = ['dsh', 'cordis', 'schemastery', 'dsh-app-boot', 'dsh-agent', 'dsh-agent-loop',
            'dsh-deepseek-llm-api-extensions', 'dsh-session', 'dsh-session-projection', 'dsh-llm', 'dsh-llm-deepseek', 'dsh-tools',
            'dsh-system-prompt', 'dsh-scope', 'dsh-launch-environment', 'dsh-home-paths', 'dsh-anonymous-user-id']
        for package in runtime_packages:
            base = host.dsh.parent / package
            files.append(base / 'package.json')
            files.extend(sorted((base / 'lib').rglob('*.js')))
        save(host.output / 'prepared.json', seal_manifest({'status': 'PREPARED_NOT_AUTHORIZED', 'scope': 'native-configured-experiment' if args.contract else 'native-minimum-two-generation' if args.arm == 'minimum' else 'native-comparison-arm',
             'planDigest': json.loads((host.output / 'prepare-plan.json').read_text())['planDigest'],
             'profile': name, 'dshPackage': str(host.dsh), 'currency': 'CNY', 'maxCostCny': args.max_cost_cny, 'maxModelRequests': args.max_model_requests, 'maxNativeOperations': contract['budget']['maxSessions'],
             'patchPaths': [str(p) for p in patch_paths],
             'runtimeCwd': str(runtime_cwd),
             'authorization': 'Requires a current explicit allocation; conflicting historical ledger caps are not silently reused.',
             'absentPaths': [str(p) for p in absent],
             'moduleInventory': module_inventory([profile / '.lib/node_modules', *[p / 'node_modules' for p in [profile, *profile.parents]]]),
             'fileHashes': {str(p): sha(p) for p in files}}))
    print(args.mode, 'exit:', r.returncode, 'output:', host.output)
    return r.returncode


if __name__ == '__main__':
    raise SystemExit(main())
