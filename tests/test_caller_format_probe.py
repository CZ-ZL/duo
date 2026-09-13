import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import pytest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
spec=importlib.util.spec_from_file_location('caller_format_probe',ROOT/'scripts/run_caller_format_probe.py')
probe=importlib.util.module_from_spec(spec);spec.loader.exec_module(probe)

def save(path,value):
    path.write_text(json.dumps(value))
    return path

def parent(tmp_path):
    source=tmp_path/'parent';source.mkdir()
    auth=save(tmp_path/'authorization.json',{'scope':'native-maturation-caller-warm-start','batch':'TEST_ONLY','approvedBy':'user','authorizationText':'OFFLINE TEST, NO FEE AUTHORITY','currency':'CNY','maxCostCny':4,'maxModelRequests':40,'callerRequestCap':20,'innerRequestCap':20,'planDigest':'parent-plan'})
    rows=[{'id':f'request-{i}','kind':'caller','costCny':.01,'usage':{'inputTokens':1,'outputTokens':1,'totalTokens':2}} for i in range(1,5)]
    save(source/'requests.json',rows)
    save(source/'result.json',{'status':'failed','evidenceKind':'real_caller_real_inner_custom_schema_evaluation','runId':'parent-plan','planDigest':'parent-plan','modelRequests':4,'costCny':.04,'requestCounts':{'caller':4,'inner':0}})
    save(source/'total-budget.json',{'costCny':.04,'operations':4,'reservedCostCny':0,'blockedReason':None})
    save(source/'total-cost-receipts.json',[{'cost':10000000} for _ in rows])
    sha=lambda name:hashlib.sha256((source/name).read_bytes()).hexdigest()
    summary=save(tmp_path/'summary.json',{'batch':'TEST_ONLY','scope':'native-maturation-caller-warm-start','currency':'CNY','maxCostCny':4,'maxModelRequests':40,'usedModelRequests':4,'usedCostCny':.04,'remainingModelRequests':36,'remainingCostCny':3.96,'byKind':{'caller':{'used':4,'cap':20,'remaining':16},'inner':{'used':0,'cap':20,'remaining':20}},'allUsageKnown':True,'realRunId':'parent-plan','resultSha256':sha('result.json'),'requestReceiptSha256':sha('requests.json'),'totalCostReceiptsSha256':sha('total-cost-receipts.json')})
    return source,auth,summary

def test_probe_retains_parent_spend_and_reserves_only_two_responses(tmp_path):
    result=probe.parent_allocation(*parent(tmp_path))
    assert result.get('priorRequests')==4
    assert result['priorCostCny']==.04
    assert result['probeMaxRequests']==2 and result['probeMaxCostCny']==.5
    assert result['callerRemaining']==16 and result['innerRemaining']==20

@pytest.mark.parametrize('mutation',['wrong-scope','unknown-cost','spent-cap','receipt-drift','wrong-batch'])
def test_probe_refuses_invalid_or_unavailable_parent_allocation(tmp_path,mutation):
    source,auth,summary=parent(tmp_path)
    if mutation=='receipt-drift':
        save(source/'requests.json',[])
    else:
        file=auth if mutation in ['wrong-scope','spent-cap'] else summary
        value=json.loads(file.read_text())
        if mutation=='wrong-scope':value['scope']='native-comparison-arm'
        if mutation=='unknown-cost':value['usedCostCny']=None;value['allUsageKnown']=False
        if mutation=='spent-cap':value['callerRequestCap']=4
        if mutation=='wrong-batch':value['batch']='OTHER_BATCH'
        save(file,value)
    with pytest.raises(ValueError):probe.parent_allocation(source,auth,summary)
