"""Prepare a bounded format pilot over existing native providers; no final data."""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path):return json.loads(path.read_text())
def write(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')

def prepare(source,target,output,live=True):
    source,target,output=[Path(p).resolve() for p in [source,target,output]]
    manifest=read(source/'manifest.json');data=read(source/'dataset.json');key=read(source/'answer-key.json')
    if not target.is_file() or not target.read_text().strip():raise ValueError('Existing original persona required')
    if any(Path(n).name!=n or sha(source/n)!=h for n,h in manifest['files'].items()) or key['datasetSha256']!=sha(source/'dataset.json'):
        raise ValueError('Source input identity changed')
    control=not live and manifest.get('measurementQualification')=='ENGINEERING_CONTROL_ONLY' and key.get('version')=='code-engineering-control-v1' and all(i.startswith('engineering-') for i in key['tasks'])
    if not control and (manifest.get('comparisonProfile')!='properties-structured-v3' or manifest.get('slowHigherFidelity')!='BOUNDED_INCREMENTAL_TWO_TASKS' or not manifest.get('sourceBindings') or any(sha(Path(n))!=h for n,h in manifest['sourceBindings'].items())):
        raise ValueError('Current qualified study bindings required')
    if [len(data[t]['tasks']) for t in ['fast','slow','final']]!=[6,2,18]:raise ValueError('Use the existing fixed qualified split')
    output.mkdir(parents=True,exist_ok=False);(output/'execution-cwd').mkdir()
    arms=[];baseline_cap=.3 if live else .4;total=1.5+baseline_cap
    group='code-format-'+hashlib.sha256(str(output).encode()).hexdigest()[:12]
    for method,evaluate in [('B1',False),('B3',True)]:
        inp=output/'inputs'/method;pack=inp/'pack';pack.mkdir(parents=True);run=output/method
        chosen=deepcopy(data);chosen.pop('final');slow=chosen.pop('slow')
        if not evaluate:chosen['fast']['tasks']+=slow['tasks'];chosen['fast']['id']+='-full-development'
        selected=deepcopy(key);ids={t['id'] for t in chosen['fast']['tasks']};selected['tasks']={i:r for i,r in selected['tasks'].items() if i in ids}
        if not evaluate and 'propertyTiers' in selected:selected['propertyTiers']=['fast' if t=='slow' else t for t in selected['propertyTiers']]
        write(pack/'dataset.json',chosen);selected['datasetSha256']=sha(pack/'dataset.json');write(pack/'answer-key.json',selected)
        write(pack/'manifest.json',{'kind':'format_readiness_development_only','sourceManifestSha256':sha(source/'manifest.json'),'files':{n:sha(pack/n) for n in ['dataset.json','answer-key.json']},'finalIncluded':False,'optimizationEvidence':False})
        count=1 if evaluate else 5;calls=1 if evaluate else 4;cap=baseline_cap if evaluate else 1.5
        spec={'version':1,'id':'code-format-v1-'+method,'target':{'kind':'dsh-persona','path':str(target)},
              'fast':{'evaluatorId':'code-unittest-fast','version':selected['evaluatorVersion'],'dataId':chosen['fast']['id'],'metric':'task_pass_rate','direction':'maximize','weights':{'task_pass_rate':1}},
              'constraints':[{'metric':'format_valid','op':'==','value':True}],'epsilon':.01,'minSamples':2,'generations':0 if evaluate else 1,'topK':0 if evaluate else 1,
              'quotas':{m:0 if evaluate else 1 for m in ['exploit','explore','innovate']},'permissions':{'paid':True,'network':live,'externalSideEffects':False},
              'budget':{'currency':'CNY','maxCostCny':cap,'maxSessions':2 if evaluate else 9,'maxFastEvals':calls,'maxSlowEvals':0,'maxWallTimeMs':600000}}
        if evaluate:spec['operation']='evaluate'
        write(inp/'experiment.json',spec)
        profile=run/'dsh-home/profiles/duo-model-minimum'
        patch=[{'id':'model-evaluator','disabled':True},{'id':'duo-journal','config':{'root':str(output/'native-journal')}},
            {'id':'model-entry','config':{'output':str(run),'live':live,'maxModelRequests':count,'requiredGenerations':spec['generations'],'arm':method,
              'budgetGroups':[{'id':group,'maxModelRequestsPerRun':5,'limits':{'currency':'CNY','maxCostCny':total,'maxSessions':2,'maxFastEvals':0,'maxSlowEvals':0,'maxWallTimeMs':1200000}}],
              'evaluatorProcess':{'script':str(profile/'code_evaluation.py'),'pack':str(pack),'artifactRoot':str(run/'executions'),'tiers':['fast'],'maxCalls':calls,'maxCallsByTier':{'fast':calls}}}}]
        replacements=[{'id':'code-evaluator','name':'./dsh_code_evaluator.js','config':{'pack':str(pack),'artifactRoot':str(run/'executions')}}]
        if not evaluate:
            patch.append({'id':'duo-feedback','disabled':True});replacements.append({'id':'method-feedback','name':'./method-feedback.js','config':{'method':'B1','datasetPath':str(run/'inputs/dataset.json'),'contextMode':'history','maxTestDetails':2}})
        if not live:
            patch.append({'id':'fixture','disabled':True});replacements.append({'id':'code-method-fixture','name':'./code-method-fixture.js','config':{'pack':str(pack)}})
        patch.append({'insert':replacements});write(inp/'providers.patch.yml',patch)
        write(inp/'model.json',{'maxTokens':16384,'maxInputBytes':65536,'reservationCny':.3 if live else .4,'timeoutMs':120000 if live else 10000,'explicitSlowFeedback':not evaluate})
        arms.append({'method':method,'directory':str(run),'inputs':str(inp),'maxModelRequests':count,'maxCostCny':cap,'maxEvaluatorCalls':calls,'taskIds':sorted(ids)})
    protocol={'scope':'native-code-format-pilot-v1','live':live,'currency':'CNY','maxCostCny':total,'maxModelRequests':6,'arms':arms,'source':str(source),'sourceManifestSha256':sha(source/'manifest.json'),'sourceBindings':manifest.get('sourceBindings',{}),'targetSha256':sha(target),
              'acceptance':'B1 one real generation with3accepted structural candidates and4format-valid8task execution batches; B3 one format-valid6task baseline batch; matched JSONacceptance/usage/input receipts; no final or optimizationbenefit claim.',
              'stops':'Sequential B1 thenB3; stop on any failed readiness or unknown cost. No retries, format repair or extra calls. Unused allowance released.', 'finalData':'Excluded from every pilot provider pack and model input','optimizationBenefit':False,'caller':'NOT_USED'}
    write(output/'pilot-protocol.json',protocol);return protocol

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['source','target','output']:parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--offline',action='store_true');args=parser.parse_args()
    result=prepare(args.source,args.target,args.output,not args.offline);print(json.dumps({'status':'PREPARED_INPUTS_ONLY','maxModelRequests':result['maxModelRequests'],'maxCostCny':result['maxCostCny'],'modelRequests':0}))
