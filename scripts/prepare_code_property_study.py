"""Bind qualified C1 development and the already selected C2 final; no model calls."""
import argparse
from copy import deepcopy
import json
from pathlib import Path
from prepare_code_properties import VERSION, sha, verify_files, validate, write

ROOT=Path(__file__).resolve().parents[1]


def read(path):
    return json.loads(Path(path).read_text())


def prepare(properties, c1_acceptance, final_pack, final_readiness, output):
    properties,c1_acceptance,final_pack,final_readiness,output=[Path(p).resolve() for p in
        [properties,c1_acceptance,final_pack,final_readiness,output]]
    c1,c2=read(c1_acceptance),read(final_readiness)
    if c1.get('status')!='C1_PASS_BOUNDED_SUBSET' or c1.get('evaluatorVersion')!=VERSION or not c1.get('checks') or not all(c.get('passed') for c in c1['checks']):
        raise ValueError('C1 qualification required; do not override labels')
    for name,expected in c1['sourceHashes'].items():
        if sha(ROOT/name)!=expected:raise ValueError('C1 evaluated source identity changed')
    bound=[h for n,h in c1['sourceHashes'].items() if n.endswith('/pack/manifest.json')]
    if bound!=[sha(properties/'manifest.json')]:raise ValueError('C1 pack identity mismatch')
    validate(properties)
    if c2.get('status')!='FINAL_SOURCE_AND_PUBLIC_INPUT_READINESS_VERIFIED' or not c2.get('checks') or not all(c2['checks'].values()):
        raise ValueError('C2 final source qualification required')
    if c2.get('packManifestSha256')!=sha(final_pack/'manifest.json'):
        raise ValueError('C2 final manifest identity mismatch')
    final_manifest=read(final_pack/'manifest.json');verify_files(final_pack,final_manifest['files'])
    data,key=read(properties/'dataset.json'),read(properties/'answer-key.json')
    final_data,final_key=read(final_pack/'dataset.json'),read(final_pack/'answer-key.json')
    if key['datasetSha256']!=sha(properties/'dataset.json') or final_key['datasetSha256']!=sha(final_pack/'dataset.json'):
        raise ValueError('Dataset/key identity mismatch')
    if 'final' in data or len(data['fast']['tasks'])!=6 or [t['id'] for t in data['slow']['tasks']]!=['BigCodeBench/358','BigCodeBench/412'] or len(final_data['final']['tasks'])!=18:
        raise ValueError('Qualified split identity mismatch')
    data['final']=deepcopy(final_data['final'])
    ids=[t['id'] for tier in ['fast','slow','final'] for t in data[tier]['tasks']]
    if len(set(ids))!=26:raise ValueError('Development/final identity overlap')
    key['tasks'].update({t['id']:deepcopy(final_key['tasks'][t['id']]) for t in data['final']['tasks']})
    if set(key['tasks'])!=set(ids):raise ValueError('Exact private task-row identity required')
    bindings={str(p):sha(p) for p in [c1_acceptance,final_readiness,properties/'manifest.json',final_pack/'manifest.json',
        Path(c1['qualification']),Path(c1['nativeReceipt']),Path(c2['sourceControls'])]}
    bindings.update({str((ROOT/n).resolve()):h for n,h in c1['sourceHashes'].items()})
    output.mkdir(parents=True,exist_ok=False)
    write(output/'dataset.json',data);key['datasetSha256']=sha(output/'dataset.json');write(output/'answer-key.json',key)
    write(output/'qualification.json',{'status':'DEVELOPMENT_CONTRACT_QUALIFIED','evaluatorVersion':VERSION,
        'slowHigherFidelity':'BOUNDED_INCREMENTAL_TWO_TASKS','sourceC1':str(c1_acceptance),'sourceC2':str(final_readiness),
        'finalQualification':'ORIGINAL_SOURCE_CONTROLS_ONLY','finalModelExecution':'NOT_RUN','optimizationBenefit':False})
    write(output/'provenance.json',{'version':1,'kind':'qualified_properties_with_existing_final','developmentPack':str(properties),
        'finalPack':str(final_pack),'sourceBindings':bindings,'developmentUnchanged':True,'finalUnchanged':True,
        'selection':'No reselection: exact C1 development and C2 final','modelRequests':0})
    write(output/'manifest.json',{'version':'code-property-study-v1','comparisonProfile':'properties-structured-v3',
        'measurementQualification':'DEVELOPMENT_CONTRACT_QUALIFIED','slowHigherFidelity':'BOUNDED_INCREMENTAL_TWO_TASKS',
        'sourceBindings':bindings,'files':{n:sha(output/n) for n in ['dataset.json','answer-key.json','qualification.json','provenance.json']},
        'finalQualification':'ORIGINAL_SOURCE_CONTROLS_ONLY','modelFinal':'NOT_RUN','formalProtocol':'NOT_FROZEN'})
    return {'status':'QUALIFIED_STUDY_INPUTS_PREPARED','output':str(output),'modelRequests':0,'costCny':0,'formalProtocol':'NOT_FROZEN'}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['properties','c1-acceptance','final-pack','final-readiness','output']:
        parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args()
    print(json.dumps(prepare(args.properties,args.c1_acceptance,args.final_pack,args.final_readiness,args.output)))
