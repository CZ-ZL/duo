#!/usr/bin/env python3
"""Prepare or run the DSH model Calling Agent acceptance with isolated profiles.

The outer caller uses a native model Agent; inner DUO work is an explicit CNY0
fixture. Live admission reuses run_dsh_model.py's bound authorization checks.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from dsh_model_profile import Profile, ROOT, agent_entries, save, sha, freeze_profile_inputs, seal_manifest


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--mode', choices=['offline', 'prepare-live', 'execute'], required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--dsh-package', type=Path)
    p.add_argument('--pricing', type=Path)
    p.add_argument('--authorization', type=Path)
    p.add_argument('--fixture-missing-usage', action='store_true')
    args = p.parse_args()
    if args.mode == 'execute':
        command = [sys.executable, str(ROOT / 'scripts/run_dsh_model.py'), '--mode', 'execute', '--output', str(args.output)]
        if args.authorization:command += ['--authorization', str(args.authorization)]
        return subprocess.run(command, cwd=ROOT).returncode
    if not args.dsh_package:p.error('An existing cached --dsh-package is required')
    live = args.mode == 'prepare-live'
    if live and not args.pricing:p.error('Provide a verified official CNY --pricing file')
    pricing = json.loads(args.pricing.read_text()) if live else {'id':'synthetic-caller-cny','currency':'CNY','inputCnyPerMillion':3,'cacheReadCnyPerMillion':.1,'outputCnyPerMillion':9}
    if live and (pricing.get('currency') != 'CNY' or pricing.get('verifiedDate') != datetime.now(timezone.utc).date().isoformat()):
        p.error('Live caller requires a fresh official CNY tariff')
    host = Profile(args.dsh_package, args.output)
    host.pack()
    shutil.copyfile(ROOT / 'examples/native/persona.txt', host.output / 'persona.txt')
    shutil.copyfile(ROOT / 'NATIVE_CALLING_GUIDE.md', host.output / 'PUBLIC_GUIDE.md')
    (host.output / 'objective.txt').write_text('Use the configured DUO plugin through its tools. Discover and inspect the experiment, execute it, inspect its result and budget, and demonstrate that a repeated completed run adds no work. For error recovery acceptance, deliberately attempt one run with planDigest "deliberately-stale" before using an inspected valid plan. Recover using the returned instructions. Do not change the target, rules or permissions. Return ONLY one raw JSON object in the public guide format, with no prose outside it and no Markdown code fences. Explain the result and its fixture limits inside the explanation field.\n')
    save(host.output / 'pricing.json', pricing)
    objective = lambda tier: {'evaluatorId':'fixture-'+tier,'version':'1','dataId':tier,'metric':'quality','direction':'maximize','weights':{'quality':1}}
    contract = {'version':1,'id':'native-calling-fixture','target':{'kind':'dsh-persona','path':'persona.txt'},
        **{tier:objective(tier) for tier in ['fast','slow','final']},'constraints':[{'metric':'safe','op':'==','value':True}],
        'epsilon':.01,'minSamples':2,'generations':2,'quotas':{'exploit':1,'explore':0,'innovate':0},'topK':1,
        'permissions':{'paid':False,'network':False,'externalSideEffects':False},
        'budget':{'currency':'CNY','maxCostCny':0,'maxSessions':30,'maxFastEvals':7,'maxSlowEvals':5,'maxWallTimeMs':10000}}
    save(host.output / 'experiment.json',contract)
    config = {'output':str(host.output),'live':live,'guidePath':str(host.output/'PUBLIC_GUIDE.md'),'objectivePath':str(host.output/'objective.txt'),
        'provider':'deepseek-official' if live else 'duo-caller-fixture','model':'deepseek-v4-flash' if live else 'fixture',
        'maxTokens':2048,'maxInputBytes':131072,'reservationCny':.45,'maxCostCny':1,'maxModelRequests':8,'timeoutMs':600000,'pricing':pricing}
    entries = agent_entries()+[
        {'id':'calling-json-extensions','name':'@deepseek-ai/dsh-deepseek-llm-api-extensions'},
        {'id':'calling-json-output','name':'@dual-loop/dsh-plugin/json-output','config':{'artifactRoot':str(host.output/'json-output'),'includeCallerSessions':True}},
        {'id':'calling-providers','name':'./calling-providers.js','config':{'currency':'CNY'}},
        ({'id':'deepseek','name':'@deepseek-ai/dsh-llm-deepseek','config':{'apiKeyEnv':'DEEPSEEK_API_KEY','thinking':'disabled','maxTokens':2048}} if live else
         {'id':'calling-fixture','name':'./dsh_calling_fixture.js','config':{'missingUsage':args.fixture_missing_usage}}),
        {'id':'calling-entry','name':'./dsh_calling_host.js','config':config}]
    patches = [{'id':'duo-contract','config':{'experiment':str(host.output/'experiment.json')}},
        {'id':'duo-journal','config':{'root':str(host.output/'journal')}},
        # The default bundle wires the bundled offline fixture; the caller
        # providers below replace it (duplicate service registration fails boot).
        {'id':'duo-offline-fixture','disabled':True},{'insert':entries}]
    scripts = ['dsh_calling_host.js']+([] if live else ['dsh_calling_fixture.js'])
    profile = host.stage('duo-model-calling', patches, scripts, bundles=['@dual-loop/dsh-plugin'])
    shutil.copyfile(ROOT/'examples/native/fixture-provider.js',profile/'calling-providers.js')
    r = host.boot('duo-model-calling', timeout=90)
    if live and r.returncode == 0:
        inputs = [host.output/f for f in ['experiment.json','persona.txt','PUBLIC_GUIDE.md','objective.txt','pricing.json']]
        inputs += [profile/f for f in ['calling-providers.js','dsh_calling_host.js']]
        inputs += [ROOT/'scripts/run_native_calling.py']
        frozen = seal_manifest({'status':'PREPARED_NOT_AUTHORIZED','scope':'native-model-caller','currency':'CNY','maxCostCny':1,'maxModelRequests':8,
            'profile':'duo-model-calling','dshPackage':str(host.dsh),'planDigest':json.loads((host.output/'prepare-plan.json').read_text())['planDigest'],
            **freeze_profile_inputs(host,profile,inputs)})
        save(host.output/'prepared.json',frozen)
        save(host.output/'authorization-template.json',{'scope':frozen['scope'],'currency':'CNY','maxCostCny':1,'maxModelRequests':8,
            'planDigest':frozen['planDigest'],'manifestDigest':frozen['manifestDigest'],'approvedBy':None,'authorizationText':None})
    print(args.mode,'caller exit:',r.returncode,'output:',host.output)
    return r.returncode


if __name__=='__main__':
    raise SystemExit(main())
