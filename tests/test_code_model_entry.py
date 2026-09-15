"""Real named-host composition checks; the model transport is explicitly synthetic."""
import json
import os
from pathlib import Path
import shutil
import subprocess
from datetime import datetime, timezone

import pytest

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / 'runs/code-benchmark-readiness-20260911/benchmark-v2'


def test_explicit_evaluator_process_boundary(tmp_path):
    script = tmp_path / 'code_evaluation.py'
    script.write_text('print("bounded adapter")\n')
    code = '''
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {installProcessGuard} from './scripts/research/dsh_model_run_host.js';
const root=process.argv[1], script=root+'/code_evaluation.py';
const args=['-I','-S',script,'--pack',root,'--tier','fast','--output',root+'/out'];
const options={env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},timeout:1000,maxBuffer:2097152,signal:new AbortController().signal};
const original=cp.execFile;
let denied=0,allowed=0;
let restore=installProcessGuard(null,()=>denied++,()=>allowed++);
assert.throws(()=>cp.execFile('/usr/bin/python3',args,options,()=>{}),/cannot start/);restore();
restore=installProcessGuard({script,pack:root,artifactRoot:root,tiers:['fast','slow'],maxCalls:1},()=>denied++,()=>allowed++);
for(const [file,argv,opts] of [
 ['bash',args,options],['/usr/bin/python3',['-c','print(1)'],options],
 ['/usr/bin/python3',args.map(x=>x==='fast'?'final':x),options],
 ['/usr/bin/python3',args,{...options,shell:true}],
 ['/usr/bin/python3',args,{...options,env:{...options.env,DEEPSEEK_API_KEY:'canary'}}],
 ['/usr/bin/python3',args.map(x=>x===root+'/out'?'/tmp/elsewhere':x),options],
 ['/usr/bin/python3',args,{...options,timeout:0}],
]) assert.throws(()=>cp.execFile(file,argv,opts,()=>{}),/cannot start/);
assert.throws(()=>cp.spawn('/usr/bin/python3',args),/cannot start/);
await new Promise((resolve,reject)=>cp.execFile('/usr/bin/python3',args,options,(e,out)=>{if(e)reject(e);else {assert.equal(out.trim(),'bounded adapter');resolve()}}));
assert.throws(()=>cp.execFile('/usr/bin/python3',args,options,()=>{}),/cannot start/);
restore();assert.equal(cp.execFile,original);assert.equal(allowed,1);assert.equal(denied,10);
'''
    result = subprocess.run([shutil.which('node'), '--input-type=module', '-e', code, str(tmp_path)],
                            cwd=ROOT, text=True, capture_output=True)
    assert result.returncode == 0, result.stderr


def test_independent_final_requires_explicit_bounded_tier_policy(tmp_path):
    script = tmp_path / 'code_evaluation.py'
    script.write_text('print("bounded final")\n')
    code = '''
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {installProcessGuard} from './scripts/research/dsh_model_run_host.js';
const root=process.argv[1],script=root+'/code_evaluation.py';
const base={script,pack:root,artifactRoot:root,tiers:['fast','final'],maxCalls:3};
assert.throws(()=>installProcessGuard(base),/Invalid declared/);
assert.throws(()=>installProcessGuard({...base,maxCallsByTier:{fast:1,final:3}}),/Invalid declared/);
assert.throws(()=>installProcessGuard({...base,maxCallsByTier:{fast:1,final:1,other:1}}),/Invalid declared/);
const restore=installProcessGuard({...base,maxCallsByTier:{fast:1,final:2}});
const options={env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},timeout:1000,maxBuffer:2097152,signal:new AbortController().signal};
const args=tier=>['-I','-S',script,'--pack',root,'--tier',tier,'--output',root+'/out'];
try{
 assert.throws(()=>cp.execFile('/usr/bin/python3',args('slow'),options,()=>{}),/cannot start/);
 const invoke=tier=>new Promise((resolve,reject)=>cp.execFile('/usr/bin/python3',args(tier),options,(e,out)=>e?reject(e):resolve(out)));
 assert.equal((await invoke('fast')).trim(),'bounded final');
 assert.throws(()=>cp.execFile('/usr/bin/python3',args('fast'),options,()=>{}),/cannot start/);
 for(let i=0;i<2;i++)assert.equal((await invoke('final')).trim(),'bounded final');
 assert.throws(()=>cp.execFile('/usr/bin/python3',args('final'),options,()=>{}),/cannot start/);
}finally{restore()}
'''
    result = subprocess.run([shutil.which('node'), '--input-type=module', '-e', code, str(tmp_path)],
                            cwd=ROOT, text=True, capture_output=True)
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize('scenario,score', [('reference', 1), ('wrong', 0)])
def test_code_model_named_profile(tmp_path, scenario, score):
    dsh = os.environ.get('DUO_DSH_PACKAGE')
    if not dsh:
        pytest.skip('Set DUO_DSH_PACKAGE to the existing cached DSH; no install')
    output = tmp_path / scenario
    result = subprocess.run(['python3', 'scripts/research/run_code_model.py', '--mode', 'offline',
        '--benchmark-pack', str(PACK), '--dsh-package', dsh, '--output', str(output),
        '--fixture-scenario', scenario], cwd=ROOT, text=True, capture_output=True, timeout=100)
    assert result.returncode == 0, result.stdout + result.stderr
    run = output / 'run'
    receipt = json.loads((run / 'run-receipt.json').read_text())
    assert receipt['status'] == 'PASS'
    assert receipt['modelRequests'] == 2 and receipt['paidCalls'] == 0 and receipt['costCny'] == 0
    assert receipt['evaluatorProcessCalls'] == 2 and receipt['childProcessAttempts'] == 0
    assert receipt['generationsRun'] == 0 and receipt['candidateCount'] == 0
    data = json.loads((PACK / 'dataset.json').read_text())
    results = json.loads((run / 'result.json').read_text())
    assert {e['tier'] for e in results['evaluations']} == {'fast', 'slow'}
    assert all(e['metrics']['task_pass_rate'] == score for e in results['evaluations'])
    requests = [json.loads(p.read_text()) for p in sorted(run.glob('model-request-*-input.json'))]
    assert len(requests) == 2
    for request, tier in zip(requests, ['fast', 'slow']):
        text = json.dumps(request)
        assert 'careful Python programmer' in request['system']
        prompt = json.loads([m for m in request['messages'] if m['role'] == 'user'][-1]['content'][0]['text'])
        assert prompt['tasks'] == data[tier]['tasks']
        assert not request.get('tools')
        assert 'canonical_solution' not in text and 'sourcePaths' not in text
        assert all(task['id'] not in text for task in data['final']['tasks'])
    assert len(list((run / 'sessions').glob('*.json'))) == 2
    assert len(list((run / 'executions').glob('*/evaluation.json'))) == 2
    assert (run / 'product-report.json').exists() and (run / 'cost-receipts.json').exists()
    assert json.loads((output / 'pack/answer-key.json').read_text()) == json.loads((PACK / 'answer-key.json').read_text())


def test_live_code_preparation_binds_private_pack_without_requests(tmp_path):
    dsh = os.environ.get('DUO_DSH_PACKAGE')
    if not dsh:
        pytest.skip('Set DUO_DSH_PACKAGE to the existing cached DSH; no install')
    pricing = tmp_path / 'pricing.json'
    pricing.write_text(json.dumps({'id': 'prepare-test-only', 'currency': 'CNY',
        'inputCnyPerMillion': 2, 'cacheReadCnyPerMillion': .04, 'outputCnyPerMillion': 8,
        'verifiedDate': datetime.now(timezone.utc).date().isoformat()}))
    output = tmp_path / 'prepared'
    env = {'PATH': os.environ['PATH']}
    command = ['python3', 'scripts/research/run_code_model.py', '--mode', 'prepare-live',
        '--benchmark-pack', str(PACK), '--dsh-package', dsh, '--output', str(output), '--pricing', str(pricing)]
    result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
    run = output / 'run'
    frozen = json.loads((run / 'prepared.json').read_text())
    assert frozen['maxModelRequests'] == 2 and frozen['maxCostCny'] == .8
    assert str(output / 'pack/answer-key.json') in frozen['fileHashes']
    assert str(output / 'pack/dataset.json') in frozen['fileHashes']
    assert str(output / 'protocol.json') in frozen['fileHashes']
    assert json.loads((run / 'prepare-receipt.json').read_text())['modelRequests'] == 0
    assert not list(run.glob('model-request-*-input.json'))
    assert not (output / 'fixture-answers.json').exists()
    refusal = subprocess.run(['python3', 'scripts/research/run_dsh_model.py', '--mode', 'execute', '--output', str(run)],
        cwd=ROOT, env=env, capture_output=True, text=True)
    assert refusal.returncode != 0 and 'explicit authorized CNY cap' in refusal.stderr
    assert not (run / 'execution-claim.json').exists()
