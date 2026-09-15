#!/usr/bin/env python3
"""Stage the independent Caller/custom evaluator/two-run warm-start acceptance.

offline uses a scripted model transport; prepare-live makes no model requests.
execute reuses the sealed native launcher and requires new scope-bound authority.
"""
import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys

from dsh_model_profile import Profile, ROOT, agent_entries, save, sha, freeze_profile_inputs, seal_manifest
from prepare_native_docs_mini import prepare
from maturation_batch import continuation_allocation

SCOPE = 'native-maturation-caller-warm-start'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--mode', choices=['offline', 'prepare-live', 'execute'], required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--dsh-package', type=Path)
    p.add_argument('--pricing', type=Path)
    p.add_argument('--authorization', type=Path)
    p.add_argument('--continuation', type=Path, help='Explicit settled parent/probe/cumulative receipt paths; use only this existing batch remainder')
    p.add_argument('--caller-max-input-bytes', type=int, default=327680,
                   help='Freeze the Caller request input bound (1..327680 bytes); its reservation must cover this envelope')
    p.add_argument('--fixture-missing-usage', action='store_true')
    p.add_argument('--fixture-tool-text-stop', action='store_true')
    p.add_argument('--fixture-invalid-warm-proposal', action='store_true')
    p.add_argument('--fixture-request-limit', type=int, choices=[1, 40], default=40)
    args = p.parse_args()
    if not 1 <= args.caller_max_input_bytes <= 327680:
        p.error('Caller input bound must be between 1 and 327680 bytes')
    if args.mode == 'execute':
        frozen = json.loads((args.output / 'prepared.json').read_text())
        if frozen.get('scope') != SCOPE:
            p.error('This entry executes only its own prepared maturation scope')
        cmd = [sys.executable, str(ROOT / 'scripts/research/run_dsh_model.py'), '--mode', 'execute', '--output', str(args.output)]
        if args.authorization:
            cmd += ['--authorization', str(args.authorization)]
        return subprocess.run(cmd, cwd=ROOT).returncode
    live = args.mode == 'prepare-live'
    carry = None
    if args.continuation:
        try:
            carry = continuation_allocation(args.continuation)
        except (ValueError, KeyError, TypeError, OSError) as error:
            p.error('Invalid maturation continuation: ' + str(error))
        if args.fixture_request_limit != 40:
            p.error('Continuation already fixes request caps; no request-limit override')
    caps = {'maxCostCny': carry['maxCostCny'] if carry else 4,
            'maxModelRequests': carry['maxModelRequests'] if carry else args.fixture_request_limit,
            'callerRequestCap': carry['callerRemaining'] if carry else 20,
            'innerRequestCap': carry['innerRemaining'] if carry else 20}
    if not args.dsh_package:
        p.error('An existing cached DSH installation is required; no install')
    if live and (not args.pricing or args.fixture_missing_usage or args.fixture_tool_text_stop or args.fixture_invalid_warm_proposal or args.fixture_request_limit != 40):
        p.error('Real preparation requires fresh CNY pricing and no fixture overrides')
    pricing = json.loads(args.pricing.read_text()) if live else {'id': 'maturation-synthetic-cny', 'currency': 'CNY', 'inputCnyPerMillion': 3, 'cacheReadCnyPerMillion': .1, 'outputCnyPerMillion': 9}
    if live and (pricing.get('currency') != 'CNY' or pricing.get('verifiedDate') != datetime.now(timezone.utc).date().isoformat()):
        p.error('Verify the current official CNY tariff before preparing')
    # A full public service-discovery transcript exceeded the former 192 KiB
    # input bound. Freeze a bounded envelope and fund its worst-case admission;
    # this reservation is not a charge and never expands the total allowance.
    envelope = ((args.caller_max_input_bytes + 4096) * max(pricing['inputCnyPerMillion'], pricing['cacheReadCnyPerMillion'])
                + 2048 * pricing['outputCnyPerMillion']) / 10**6
    caller_reservation = max(.7, math.ceil(envelope * 10**9) / 10**9)
    host = Profile(args.dsh_package, args.output)
    data = prepare(host.output / 'inputs')
    # Same existing target and data; no weaker baseline or newly claimed held-out
    # independence. This scope measures output protocol, not the old lexical score.
    save(host.output / 'inputs/reuse-limits.json', {'targetSha256': sha(host.output / 'inputs/persona.txt'), 'sourceTarget': 'examples/native/persona.txt', 'finalIndependence': 'NOT_ESTABLISHED', 'note': 'All task sets already existed in earlier experiments. Do not call these fresh held-out data or mix new output-schema metrics with old scores.'})
    host.pack()
    shutil.copyfile(ROOT / 'AGENT_GUIDE.md', host.output / 'PUBLIC_GUIDE.md')
    save(host.output / 'pricing.json', pricing)
    experiment = host.output / 'experiment.json'
    save(experiment, {})  # Caller must complete and write its inspected draft.
    objective = lambda tier: {'evaluatorId': 'answer-schema-' + tier, 'version': '1', 'dataId': data[tier]['id'], 'metric': 'quality', 'direction': 'maximize', 'weights': {'quality': 1}}
    contract = {'version': 1, 'id': 'maturation-first', 'target': {'kind': 'dsh-persona', 'path': str(host.output / 'inputs/persona.txt')}, **{tier: objective(tier) for tier in ['fast', 'slow', 'final']},
        'constraints': [{'metric': 'grounded', 'op': '==', 'value': True}], 'epsilon': .01, 'minSamples': 4, 'generations': 2,
        'quotas': {'exploit': 1, 'explore': 0, 'innovate': 0}, 'topK': 1,
        'permissions': {'paid': True, 'network': live, 'externalSideEffects': False},
        'budget': {'currency': 'CNY', 'maxCostCny': 1.5, 'maxSessions': 26, 'maxFastEvals': 3, 'maxSlowEvals': 3, 'maxWallTimeMs': 900000}}
    resources = {'purpose': 'Independently attach the supplied custom evaluator via the public DSH Cordis tools, complete preparation, inspect and run the first frozen contract, and explain the report. Then explicitly write a new contract with the secondId and warmStart referencing the first actual completed runId; inspect and run it and explain both results. No adoption, retries or rule changes.',
        'targetPath': contract['target']['path'], 'experimentPath': str(experiment), 'firstContract': contract, 'secondId': 'maturation-warm',
        'resourceDiscovery': 'Use cordis_inspect_list, then the listed AnswerSchemaMeasurement.describe. Inspect its public service contract and supplied bridge source. Activate only that exact existing adapter via cordis_define and cordis_run; DUO is not prewired to it.',
        'warmStart': {'runIds': 'Use the actual completed first run ID', 'maxRecords': 4, 'maxContextBytes': 8192, 'fixturePolicy': 'exclude' if live else 'ideas_only'},
        'budget': {'currency': 'CNY', **caps, 'callerMaxInputBytes': args.caller_max_input_bytes,
                   'callerReservationCny': caller_reservation, 'retryPolicy': 'No retries; all nested requests are charged to the same total admission ledger.'},
        'fileAuthority': 'Read only the supplied public guide/resources, original persona and experiment file. Write only the isolated experiment file with the frozen first contract or exact authorized warm-start successor. Private dataset/final/receipt files and user profiles are outside Caller read/write scope.',
        'finalResponseRules': 'Return one JSON object using finalResponse field names. Its descriptive placeholders are instructions, not literal values. In run order, copy each dualloop_report conclusion code verbatim into conclusions; put narrative only in explanation. Copy each report budget.costCny into innerLedgerCostsCny as a JSON number (or null for unknown), never a quoted number. Include failed run IDs and their actual conclusion codes and costs; accurately explaining failure does not make an experiment complete. Do not invent missing reports or costs.',
        'finalResponse': {'runIds': ['first actual ID', 'second actual ID'], 'conclusions': ['first reported conclusion', 'second reported conclusion'], 'warmStartSourceRunId': 'first actual ID', 'evaluatorId': 'answer-schema-fast', 'improvementProven': False, 'evidenceKind': 'real_model' if live else 'fixture', 'evaluatorScope': 'output_protocol_only', 'finalIndependence': 'NOT_ESTABLISHED', 'costAccounting': 'final_total_ledger_required', 'innerLedgerCostsCny': ['first reported native ledger cost', 'second reported native ledger cost'], 'explanation': 'Explain observed stages, absence/presence of improvement, costs and protocol-only/final-data limits. These inner ledger numbers overlap the total admission ledger and omit Caller fees. Your last response cost is available only after settlement, so refer to the final total ledger instead of inventing it. Return one JSON object.'},
        'evidenceLimits': 'The custom evaluator validates types, task coverage, nonempty answers and citations drawn from each supplied task. It does not certify factual correctness. Existing final data is not claimed unseen. No current baseline fault or positive improvement is assumed. Keep unknown costs and unexecuted stages explicit.'}
    save(host.output / 'resources.json', resources)
    provider = {'provider': 'deepseek-official' if live else 'duo-maturation-fixture', 'model': 'deepseek-v4-flash' if live else 'fixture', 'maxTokens': 2048,
        'datasetPath': str(host.output / 'inputs/dataset.json'), 'artifactRoot': str(host.output / 'sessions'), 'evidenceKind': 'model' if live else 'fixture',
        'currency': 'CNY', 'reservationCny': .15, 'maxInputBytes': 32768, 'timeoutMs': 90000 if live else 5000, 'pricing': pricing}
    config = {'output': str(host.output), 'live': live, 'guidePath': str(host.output / 'PUBLIC_GUIDE.md'), 'resourcesPath': str(host.output / 'resources.json'),
        'provider': provider['provider'], 'model': provider['model'], 'maxTokens': 2048, **caps,
        'callerReservationCny': caller_reservation, 'innerReservationCny': .15,
        'callerMaxInputBytes': args.caller_max_input_bytes, 'innerMaxInputBytes': 32768, 'timeoutMs': 1400000 if live else 60000, 'pricing': pricing}
    if carry:
        config['batchCarry'] = carry
        resources['budget']['priorConsumption'] = {k: carry[k] for k in ['batch', 'priorRequests', 'priorCostCny', 'priorCallerRequests', 'priorInnerRequests']}
        save(host.output / 'resources.json', resources)
    entries = agent_entries() + [
        {'id': 'maturation-cordis-runner', 'name': '@deepseek-ai/dsh-cordis-host-runner'},
        {'id': 'maturation-cordis-tools', 'name': '@deepseek-ai/dsh-tool-cordis'},
        {'id': 'maturation-fs', 'name': '@deepseek-ai/dsh-fs-local', 'config': {'cwd': str(host.output)}},
        {'id': 'maturation-fs-policy', 'name': '@deepseek-ai/dsh-fs-observation-policy'},
        {'id': 'maturation-fs-tools', 'name': '@deepseek-ai/dsh-tool-fs'},
        {'id': 'maturation-json-extension', 'name': '@deepseek-ai/dsh-deepseek-llm-api-extensions'},
        {'id': 'maturation-json', 'name': '@dual-loop/dsh-plugin/json-output', 'config': {'artifactRoot': str(host.output / 'json-output'), 'includeCallerSessions': True}},
        ({'id': 'maturation-provider', 'name': '@deepseek-ai/dsh-llm-deepseek', 'config': {'apiKeyEnv': 'DEEPSEEK_API_KEY', 'thinking': 'disabled', 'maxTokens': 2048, 'retryPolicy': {'mode': 'normal', 'maxRetries': 0}}} if live else
         {'id': 'maturation-fixture', 'name': './dsh_maturation_fixture.js', 'config': {'resourcesPath': str(host.output / 'resources.json'), 'missingUsage': args.fixture_missing_usage, 'toolTextStop': args.fixture_tool_text_stop, 'invalidWarmProposal': args.fixture_invalid_warm_proposal}}),
        {'id': 'maturation-generator', 'name': '@dual-loop/dsh-plugin/model-generator', 'config': provider},
        {'id': 'maturation-executor', 'name': '@dual-loop/dsh-plugin/model-executor', 'config': provider},
        {'id': 'maturation-evaluation-resource', 'name': './schema-answer-evaluator.js', 'config': {'datasetPath': provider['datasetPath'], 'artifactRoot': str(host.output / 'judgments'), 'evidenceKind': provider['evidenceKind']}},
        {'id': 'maturation-entry', 'name': './dsh_maturation_host.js', 'config': config}]
    scripts = ['dsh_maturation_host.js', 'dsh_caller_host.js', 'caller_diagnostics.mjs', 'maturation_diagnostics.mjs'] + ([] if live else ['dsh_maturation_fixture.js'])
    # DSH rejects unresolved mandatory top-level rows at boot. This optional
    # native composition activates the same runtime after the Caller supplies
    # EvaluatorsService, while onboarding stays available before that point.
    patches = [{'id': name, 'disabled': True} for name in ['duo-controller', 'duo-observer', 'duo-observer-tools', 'dualloop']]
    patches += [{'id': 'duo-contract', 'config': {'experiment': str(experiment)}}, {'id': 'duo-journal', 'config': {'root': str(host.output / 'journal')}},
                # The default bundle wires the bundled offline fixture; the
                # providers below replace it (duplicate registration fails boot).
                {'id': 'duo-offline-fixture', 'disabled': True},
                {'insert': [{'id': 'duo-deferred-runtime', 'name': '@dual-loop/dsh-plugin/deferred-runtime'}, *entries]}]
    profile = host.stage('duo-maturation-caller', patches, scripts, bundles=['@dual-loop/dsh-plugin'])
    shutil.copyfile(ROOT / 'examples/native/schema-answer-evaluator.js', profile / 'schema-answer-evaluator.js')
    result = host.boot('duo-maturation-caller', timeout=90)
    if live and result.returncode == 0:
        inputs = [host.output / f for f in ['pricing.json', 'PUBLIC_GUIDE.md', 'resources.json', 'experiment.json']]
        inputs += list((host.output / 'inputs').glob('*')) + [profile / 'schema-answer-evaluator.js', profile / 'dsh_maturation_host.js', profile / 'dsh_caller_host.js', profile / 'caller_diagnostics.mjs', profile / 'maturation_diagnostics.mjs', ROOT / 'scripts/research/run_maturation_calling.py']
        for name in ['dsh-cordis-host-runner', 'dsh-tool-cordis', 'dsh-fs', 'dsh-fs-local', 'dsh-fs-observation-policy', 'dsh-tool-fs', 'dsh-typert-protocol']:
            base = host.dsh.parent / name
            inputs += [base / 'package.json', *sorted((base / 'lib').rglob('*.js'))]
        continuation_fields = {}
        if carry:
            inputs += [Path(k) for k in carry['sourceHashes']] + [ROOT / 'scripts/research/maturation_batch.py', ROOT / 'scripts/research/run_caller_format_probe.py']
            continuation_fields = {'batchCarry': carry, 'continuationInput': str(args.continuation.resolve())}
        frozen = seal_manifest({'status': 'PREPARED_NOT_AUTHORIZED', 'scope': SCOPE, 'currency': 'CNY', **caps, **continuation_fields,
            'profile': 'duo-maturation-caller', 'dshPackage': str(host.dsh), 'planDigest': json.loads((host.output / 'prepare-plan.json').read_text())['planDigest'], **freeze_profile_inputs(host, profile, inputs)})
        save(host.output / 'prepared.json', frozen)
        save(host.output / 'authorization-template.json', {'scope': SCOPE, 'currency': 'CNY', **caps, 'manifestDigest': frozen['manifestDigest'], 'planDigest': frozen['planDigest'], 'approvedBy': None, 'authorizationText': None, 'batch': carry['batch'] if carry else 'NEW_ALLOCATION_REQUIRED_NOT_OLD_REMAINDER'})
    print(args.mode, 'combination exit:', result.returncode, 'output:', host.output)
    return result.returncode


if __name__ == '__main__':
    raise SystemExit(main())
