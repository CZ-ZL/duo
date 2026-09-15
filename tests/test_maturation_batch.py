"""Offline accounting/admission tests. Test fixtures grant no real authority."""
import json
from pathlib import Path
import sys
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
from maturation_batch import continuation_allocation
from dsh_model_profile import sha, seal_manifest
from test_caller_format_probe import parent, save, probe as probe_entry
from test_native_model_entry import invoke, seal


def continuation(tmp_path):
    prior = tmp_path / 'prior'; prior.mkdir()
    source, original_auth, old_summary = parent(prior)
    carried = probe_entry.parent_allocation(source, original_auth, old_summary)
    diagnostic = tmp_path / 'probe'; diagnostic.mkdir()
    frozen = seal_manifest({'scope': 'native-maturation-caller-format-probe', 'planDigest': 'probe-plan'})
    save(diagnostic / 'prepared.json', frozen)
    auth = save(tmp_path / 'probe-auth.json', {'scope': frozen['scope'], 'approvedBy': 'user',
        'authorizationText': 'OFFLINE FIXTURE ONLY', 'batch': 'TEST_ONLY', 'currency': 'CNY',
        'maxCostCny': .5, 'maxModelRequests': 2, 'planDigest': 'probe-plan', 'manifestDigest': frozen['manifestDigest']})
    rows = [{'id': f'probe-{i}', 'kind': 'caller_format_diagnostic', 'costCny': .01,
             'usage': {'inputTokens': 1, 'cacheReadTokens': 0, 'outputTokens': 1, 'totalTokens': 2}} for i in [1, 2]]
    save(diagnostic / 'requests.json', rows)
    save(diagnostic / 'result.json', {'status': 'completed', 'evidenceKind': 'real_model_format_probe',
        'runId': 'probe-plan', 'planDigest': 'probe-plan', 'parent': carried, 'modelRequests': 2, 'costCny': .02})
    save(diagnostic / 'total-budget.json', {'costCny': .02, 'operations': 2, 'reservedCostCny': 0, 'blockedReason': None})
    save(diagnostic / 'total-cost-receipts.json', [{'operationId': row['id'], 'cost': 10000000} for row in rows])
    files = [Path(k) for k in carried['sourceHashes']] + [auth, *[diagnostic / n for n in ['result.json', 'requests.json', 'total-budget.json', 'total-cost-receipts.json']]]
    summary = save(tmp_path / 'cumulative.json', {'batch': 'TEST_ONLY', 'currency': 'CNY', 'usedModelRequests': 6,
        'usedCostCny': .06, 'maxModelRequests': 40, 'maxCostCny': 4, 'remainingModelRequests': 34,
        'remainingCostCny': 3.94, 'allUsageKnown': True, 'reservedCostCny': 0,
        'byKind': {'caller': {'used': 6, 'cap': 20, 'remaining': 14}, 'inner': {'used': 0, 'cap': 20, 'remaining': 20}},
        'sourceHashes': {str(p): sha(p) for p in files}})
    return save(tmp_path / 'continuation.json', {'parentRun': str(source), 'parentAuthorization': str(original_auth),
        'parentSummary': str(old_summary), 'probeRun': str(diagnostic), 'probeAuthorization': str(auth), 'batchSummary': str(summary)})


def test_continuation_deducts_both_attempts_and_caller_subquota(tmp_path):
    descriptor = continuation(tmp_path)
    carry = continuation_allocation(descriptor)
    assert carry['priorRequests'] == 6 and carry['priorCostCny'] == .06
    assert carry['maxModelRequests'] == 34 and carry['maxCostCny'] == 3.94
    assert carry['callerRemaining'] == 14 and carry['innerRemaining'] == 20
    spec = json.loads(descriptor.read_text())
    for source in [descriptor, Path(spec['batchSummary']), Path(spec['probeRun']) / 'prepared.json']:
        assert carry['sourceHashes'][str(source)] == sha(source)


@pytest.mark.parametrize('defect', ['omitted-probe', 'unknown-usage', 'unsettled', 'wrong-batch', 'duplicate-receipt', 'source-drift'])
def test_continuation_refuses_incomplete_or_inconsistent_consumption(tmp_path, defect):
    descriptor = continuation(tmp_path)
    paths = json.loads(descriptor.read_text())
    target = Path(paths['batchSummary'])
    if defect == 'unknown-usage': target = Path(paths['probeRun']) / 'requests.json'
    if defect == 'unsettled': target = Path(paths['probeRun']) / 'total-budget.json'
    if defect == 'duplicate-receipt': target = Path(paths['probeRun']) / 'total-cost-receipts.json'
    value = json.loads(target.read_text())
    if defect == 'omitted-probe': value['usedModelRequests'] = 4; value['usedCostCny'] = .04
    if defect == 'unknown-usage': value[0]['usage'] = None
    if defect == 'unsettled': value['reservedCostCny'] = .25
    if defect == 'wrong-batch': value['batch'] = 'OTHER_BATCH'
    if defect == 'duplicate-receipt': value[1]['operationId'] = value[0]['operationId']
    if defect == 'source-drift': value['sourceHashes'][paths['probeAuthorization']] = 'changed'
    save(target, value)
    with pytest.raises(ValueError): continuation_allocation(descriptor)


def test_direct_native_launcher_checks_continuation_before_credentials(tmp_path):
    descriptor = continuation(tmp_path)
    carry = continuation_allocation(descriptor)
    scope = 'native-maturation-caller-warm-start'
    frozen = {'scope': scope, 'currency': 'CNY', 'planDigest': 'next-plan', 'fileHashes': {},
              'maxCostCny': 3.94, 'maxModelRequests': 34, 'callerRequestCap': 14, 'innerRequestCap': 20,
              'continuationInput': str(descriptor), 'batchCarry': carry}
    save(tmp_path / 'prepared.json', frozen)
    auth = {k: frozen[k] for k in ['scope', 'currency', 'planDigest', 'maxCostCny', 'maxModelRequests', 'callerRequestCap', 'innerRequestCap']}
    auth.update(approvedBy='user', authorizationText='OFFLINE TEST ONLY', batch=carry['batch'])
    seal(tmp_path, auth)
    assert 'DEEPSEEK_API_KEY is absent' in invoke(tmp_path, auth).stderr
    for change in [{'maxCostCny': 4}, {'maxModelRequests': 40}, {'callerRequestCap': 20}, {'batch': 'OTHER'}]:
        refused = invoke(tmp_path, {**auth, **change})
        assert 'Invalid maturation continuation' in refused.stderr
        assert not (tmp_path / 'execution-claim.json').exists()


def settled_continuation(tmp_path):
    prior = continuation(tmp_path)
    carry = continuation_allocation(prior)
    run = tmp_path / 'continued'; run.mkdir()
    frozen = seal_manifest({'scope': 'native-maturation-caller-warm-start', 'planDigest': 'continued-plan',
        'batchCarry': carry, 'maxCostCny': 3.94, 'maxModelRequests': 34, 'callerRequestCap': 14, 'innerRequestCap': 20})
    save(run / 'prepared.json', frozen)
    auth = save(tmp_path / 'continued-auth.json', {k:v for k,v in frozen.items() if k in ['scope','planDigest','manifestDigest','maxCostCny','maxModelRequests','callerRequestCap','innerRequestCap']})
    a=json.loads(auth.read_text());a.update(approvedBy='user',authorizationText='OFFLINE TEST ONLY',currency='CNY',batch='TEST_ONLY');save(auth,a)
    rows=[{'id':f'request-{i}','kind':'caller','costCny':.01,'usage':{'inputTokens':1,'cacheReadTokens':0,'outputTokens':1,'totalTokens':2}} for i in range(11)]
    save(run/'requests.json',rows)
    save(run/'total-cost-receipts.json',[{'operationId':r['id'],'cost':10000000} for r in rows])
    save(run/'total-budget.json',{'operations':11,'costCny':.11,'reservedCostCny':0,'blockedReason':None})
    save(run/'result.json',{'status':'failed','evidenceKind':'real_caller_real_inner_custom_schema_evaluation',
        'runId':'continued-plan','planDigest':'continued-plan','modelRequests':11,'costCny':.11,'requestCounts':{'caller':11,'inner':0},
        'batchAccounting':{'batch':'TEST_ONLY','priorRequests':6,'priorCostCny':.06,'modelRequests':17,'costCny':.17,'remainingRequests':23,'remainingCostCny':3.83,'callerRemaining':3,'innerRemaining':20}})
    files=[Path(k) for k in carry['sourceHashes']]+[auth,*[run/n for n in ['prepared.json','result.json','requests.json','total-cost-receipts.json','total-budget.json']]]
    summary=save(tmp_path/'latest-summary.json',{'batch':'TEST_ONLY','currency':'CNY','usedModelRequests':17,'usedCostCny':.17,
        'maxModelRequests':40,'maxCostCny':4,'remainingModelRequests':23,'remainingCostCny':3.83,'allUsageKnown':True,'reservedCostCny':0,
        'byKind':{'caller':{'used':17,'cap':20,'remaining':3},'inner':{'used':0,'cap':20,'remaining':20}},
        'sourceHashes':{str(p):sha(p) for p in files}})
    return save(tmp_path/'next.json',{'priorContinuation':str(prior),'settledRun':str(run),'settledAuthorization':str(auth),'batchSummary':str(summary)})


def test_followup_deducts_failed_real_attempt_without_reissuing_six_request_balance(tmp_path):
    descriptor=settled_continuation(tmp_path)
    carry=continuation_allocation(descriptor)
    assert carry['priorRequests']==17 and carry['priorCostCny']==.17
    assert carry['maxModelRequests']==23 and carry['maxCostCny']==3.83
    assert carry['callerRemaining']==3 and carry['innerRemaining']==20


@pytest.mark.parametrize('defect',['stale-summary','unknown-cost','wrong-batch','reset-caps','duplicate-receipt','source-drift'])
def test_followup_rejects_missing_or_unreconciled_latest_consumption(tmp_path,defect):
    descriptor=settled_continuation(tmp_path);spec=json.loads(descriptor.read_text())
    target=Path(spec['batchSummary'])
    if defect=='unknown-cost':target=Path(spec['settledRun'])/'requests.json'
    if defect in ['wrong-batch','reset-caps']:target=Path(spec['settledAuthorization'])
    if defect=='duplicate-receipt':target=Path(spec['settledRun'])/'total-cost-receipts.json'
    value=json.loads(target.read_text())
    if defect=='stale-summary':value['usedModelRequests']=6
    if defect=='unknown-cost':value[0]['costCny']=None
    if defect=='wrong-batch':value['batch']='OTHER'
    if defect=='reset-caps':value['callerRequestCap']=20
    if defect=='duplicate-receipt':value[1]['operationId']=value[0]['operationId']
    if defect=='source-drift':value['sourceHashes'][spec['settledAuthorization']]='changed'
    save(target,value)
    with pytest.raises(ValueError):continuation_allocation(descriptor)


def test_latest_consumption_is_rechecked_by_direct_launcher(tmp_path):
    descriptor=settled_continuation(tmp_path);carry=continuation_allocation(descriptor)
    scope='native-maturation-caller-warm-start'
    save(tmp_path/'prepared.json',{'scope':scope,'currency':'CNY','planDigest':'after-failure','fileHashes':{},
        'maxCostCny':3.83,'maxModelRequests':23,'callerRequestCap':3,'innerRequestCap':20,
        'continuationInput':str(descriptor),'batchCarry':carry})
    auth={'scope':scope,'currency':'CNY','planDigest':'after-failure','maxCostCny':3.83,
        'maxModelRequests':23,'callerRequestCap':3,'innerRequestCap':20,'batch':'TEST_ONLY',
        'approvedBy':'user','authorizationText':'OFFLINE FIXTURE ONLY'}
    seal(tmp_path,auth)
    assert 'DEEPSEEK_API_KEY is absent' in invoke(tmp_path,auth).stderr
    spec=json.loads(descriptor.read_text());summary=Path(spec['batchSummary'])
    changed=json.loads(summary.read_text());changed['usedModelRequests']=6;save(summary,changed)
    assert 'Invalid maturation continuation' in invoke(tmp_path,auth).stderr
    assert not (tmp_path/'execution-claim.json').exists()


def test_cyclic_receipt_reference_is_bounded(tmp_path):
    descriptor=save(tmp_path/'cycle.json',{'priorContinuation':'cycle.json','settledRun':'run',
        'settledAuthorization':'auth.json','batchSummary':'summary.json'})
    with pytest.raises(ValueError,match='bounded audit depth'):continuation_allocation(descriptor)


def test_known_zero_dispatch_refusal_preserves_prior_consumption(tmp_path):
    descriptor=settled_continuation(tmp_path);spec=json.loads(descriptor.read_text());run=Path(spec['settledRun'])
    save(run/'requests.json',[]);save(run/'total-cost-receipts.json',[])
    save(run/'total-budget.json',{'operations':0,'costCny':0,'reservedCostCny':0,'blockedReason':None})
    result=json.loads((run/'result.json').read_text())
    result.update(modelRequests=0,costCny=0,requestCounts={'caller':0,'inner':0})
    result['batchAccounting'].update(modelRequests=6,costCny=.06,remainingRequests=34,remainingCostCny=3.94,callerRemaining=14)
    save(run/'result.json',result)
    summary_path=Path(spec['batchSummary']);summary=json.loads(summary_path.read_text())
    summary.update(usedModelRequests=6,usedCostCny=.06,remainingModelRequests=34,remainingCostCny=3.94)
    summary['byKind']['caller'].update(used=6,remaining=14)
    summary['sourceHashes']={p:sha(Path(p)) for p in summary['sourceHashes']};save(summary_path,summary)
    carried=continuation_allocation(descriptor)
    assert carried['priorRequests']==6 and carried['priorCostCny']==.06
    assert carried['callerRemaining']==14


def amended_continuation(tmp_path):
    previous=settled_continuation(tmp_path);prior=continuation_allocation(previous)
    auth=save(tmp_path/'amendment-auth.json',{'scope':'native-maturation-request-cap-amendment',
        'approvedBy':'user','authorizationText':'OFFLINE FIXTURE ONLY','batch':'TEST_ONLY','currency':'CNY',
        'priorAllocation':prior,'before':{'maxCostCny':4,'maxModelRequests':40,'callerRequestCap':20,'innerRequestCap':20},
        'after':{'maxCostCny':4,'maxModelRequests':57,'callerRequestCap':37,'innerRequestCap':20}})
    return save(tmp_path/'amended.json',{'priorContinuation':str(previous),'requestCapAmendment':str(auth)})


def test_approved_request_amendment_preserves_every_fee_and_count(tmp_path):
    descriptor=amended_continuation(tmp_path);carry=continuation_allocation(descriptor)
    assert carry['priorRequests']==17 and carry['priorCostCny']==.17
    assert carry['batchMaxRequests']==57 and carry['batchMaxCostCny']==4
    assert carry['maxModelRequests']==40 and carry['maxCostCny']==3.83
    assert carry['callerRemaining']==20 and carry['innerRemaining']==20
    assert carry['sourceHashes'][str(descriptor)]==sha(descriptor)


@pytest.mark.parametrize('defect',['blank-approval','wrong-batch','money-increase','stale-consumption','wrong-before','fractional-cap','unallocated-total'])
def test_request_amendment_rejects_unapproved_or_changed_resources(tmp_path,defect):
    descriptor=amended_continuation(tmp_path);auth=Path(json.loads(descriptor.read_text())['requestCapAmendment']);v=json.loads(auth.read_text())
    if defect=='blank-approval':v['approvedBy']=None
    if defect=='wrong-batch':v['batch']='OTHER'
    if defect=='money-increase':v['after']['maxCostCny']=5
    if defect=='stale-consumption':v['priorAllocation']['priorRequests']=6
    if defect=='wrong-before':v['before']['callerRequestCap']=37
    if defect=='fractional-cap':v['after']['callerRequestCap']=37.5
    if defect=='unallocated-total':v['after']['maxModelRequests']=58
    save(auth,v)
    with pytest.raises(ValueError):continuation_allocation(descriptor)


def test_direct_launch_revalidates_amendment_and_refuses_old_subcaps(tmp_path):
    descriptor=amended_continuation(tmp_path);carry=continuation_allocation(descriptor)
    scope='native-maturation-caller-warm-start'
    save(tmp_path/'prepared.json',{'scope':scope,'currency':'CNY','planDigest':'amended-plan','fileHashes':{},
        'maxCostCny':3.83,'maxModelRequests':40,'callerRequestCap':20,'innerRequestCap':20,
        'continuationInput':str(descriptor),'batchCarry':carry})
    auth={'scope':scope,'currency':'CNY','planDigest':'amended-plan','maxCostCny':3.83,'maxModelRequests':40,
        'callerRequestCap':20,'innerRequestCap':20,'batch':'TEST_ONLY','approvedBy':'user','authorizationText':'OFFLINE FIXTURE ONLY'}
    seal(tmp_path,auth)
    assert 'DEEPSEEK_API_KEY is absent' in invoke(tmp_path,auth).stderr
    assert 'Invalid maturation continuation' in invoke(tmp_path,{**auth,'callerRequestCap':3}).stderr
    amendment=Path(json.loads(descriptor.read_text())['requestCapAmendment']);v=json.loads(amendment.read_text());v['approvedBy']=None;save(amendment,v)
    assert 'Invalid maturation continuation' in invoke(tmp_path,auth).stderr
    assert not (tmp_path/'execution-claim.json').exists()
