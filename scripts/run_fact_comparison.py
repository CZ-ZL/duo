#!/usr/bin/env python3
"""Fixed current fact study over the existing DSH native entry; no search engine."""
import argparse
from decimal import Decimal
import json
import os
from pathlib import Path
import subprocess
import sys

from dsh_model_profile import ROOT, save, sha, seal_manifest, manifest_digest


def read(path):
    return json.loads(path.read_text())


def native_digest(value):
    import hashlib
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def structured_feedback_identity(body, receipt, event, prior_ids):
    """Bind the original Journal feedback and the actual projected model input."""
    feedback=body.get('feedback',{});history=feedback.get('history',[])
    original=event.get('feedback',{});source={r['candidateId']:r for r in original.get('history',[])}
    slots=body.get('slots',[])
    common=['candidateId','candidateVersion','parentId','parentVersion','generation','mode','family',
            'operatorId','hypothesis','delta','fast','fastScore','fastVerdict']
    operators={'exploit':'append-local-v1','explore':'replace-strategy-v1','innovate':'compose-strategies-v1'}
    return bool(feedback.get('historyCompleteness')=='all_latest_candidates' and
        len(history)==len(prior_ids) and {h['candidateId'] for h in history}==set(source)==prior_ids and
        all(all(h.get(k)==source[h['candidateId']].get(k) for k in common) for h in history) and
        slots and len({s['slot'] for s in slots})==len(slots) and
        all(s.get('operatorId')==operators.get(s.get('mode')) for s in slots) and
        {m:sum(s.get('mode')==m for s in slots) for m in operators}==original.get('quotas') and
        [{'slot':s['slot'],'operatorId':s['operatorId']} for s in slots]==receipt.get('operatorSlots') and
        native_digest(original)==event.get('feedbackDigest')==receipt.get('feedbackDigest') and
        native_digest(history)==receipt.get('historyDigest') and
        native_digest(feedback)==receipt.get('searchInputDigest') and
        ('warmStart' not in feedback or native_digest(feedback['warmStart'])==receipt.get('warmStartDigest')))


def explicit_slow_removed(feedback, structured=False):
    if not structured:
        return (set(feedback)=={'quotas','families','developmentTasks'} and
                all(set(value)=={'fastAvg'} for value in feedback['families'].values()))
    allowed={'historyCompleteness','history','families','developmentTasks','developmentMeasurements','warmStart'}
    row_keys={'candidateId','candidateVersion','parentId','parentVersion','generation','mode','family',
              'operatorId','hypothesis','delta','fast','fastScore','fastVerdict'}
    return bool(set(feedback)<=allowed and feedback.get('history') and
        all(set(h)<=row_keys for h in feedback['history']) and
        all(set(value)<= {'fastAvg'} for value in feedback.get('families',{}).values()) and
        all(row.get('role') in ['baseline','direction'] and
            all(e.get('tier')=='fast' for e in row.get('source',{}).get('evaluators',[])) and
            set(row.get('observations',{}))<= {'fast'} and set(row.get('verdicts',{}))<= {'fast'}
            for row in feedback.get('warmStart',{}).get('records',[])))


def child_command(out, arm, mode, dsh=None, pricing=None):
    inputs=out/arm['inputs']
    code=arm.get('benchmarkKind')=='code'
    command=[sys.executable, str(ROOT/'scripts/run_dsh_model.py'), '--mode', mode,
        '--output', str(out/arm['directory'])]
    if mode=='execute':
        return command+['--authorization', str(out/arm['directory']/'study-authorization.json')]
    command+=['--dsh-package', str(dsh), '--contract', str(inputs/'experiment.json'),
        '--runtime-cwd', str(out/'execution-cwd'),
        '--dataset', str(inputs/('pack/dataset.json' if code else 'dataset.json')), '--profile-patch', str(inputs/'providers.patch.yml'),
        '--model-config', str(inputs/'model.json'), '--budget-groups', str(inputs/'groups.json'),
        '--max-cost-cny', str(arm['maxCostCny']), '--max-model-requests', str(arm['maxModelRequests'])]
    if code:
        if arm.get('searchProfile') in ['history-structured-v2','properties-structured-v3'] and arm['method']!='B0':
            command+=['--generator','structured-generator']
        modules=['scripts/dsh_code_evaluator.js','scripts/code_evaluation.py','scripts/code_worker.py','examples/native/method-feedback.js']
        if mode=='offline':modules+=['examples/native/code-method-fixture.js']
        for name in modules:command+=['--profile-file', str(ROOT/name)]
    else:
        modules=['fact-evaluator.js','fact-task.js','method-feedback.js']
        if mode=='offline':modules+=['fact-method-fixture.js']
        for name in modules:command+=['--profile-file', str(ROOT/'examples/native'/name)]
        command+=['--profile-file', str(inputs/'answerKey.json')]
    if pricing:command+=['--pricing', str(pricing)]
    return command


def run_child(out, arm, mode, **kwargs):
    completed=subprocess.run(child_command(out,arm,mode,**kwargs),cwd=ROOT,capture_output=True,text=True,timeout=1550)
    (out/(arm['id']+'-'+mode+'.stdout.txt')).write_text(completed.stdout)
    (out/(arm['id']+'-'+mode+'.stderr.txt')).write_text(completed.stderr)
    if completed.returncode==0 and mode=='prepare-live' and arm.get('benchmarkKind')=='code':
        # Directory-valued provider input must also bind every private pack
        # file in the native child manifest, not just the aggregate envelope.
        path=out/arm['directory']/'prepared.json';frozen=read(path)
        frozen['fileHashes'].update({str(p):sha(p) for p in (out/arm['inputs']/'pack').iterdir() if p.is_file()})
        save(path,seal_manifest(frozen))
    return completed.returncode


def code_experiment_metrics(directory, candidates, events, result, metric, public_candidates):
    """Descriptive counts from measured candidates and actual evaluation receipts."""
    tiers=['fast','slow','final'];distributions={t:[] for t in tiers}
    for candidate_id,candidate in candidates.items():
        if candidate_id=='baseline':continue
        for tier in ['fast','slow']:
            evidence=candidate.get(tier,{})
            score=evidence.get('metrics',{}).get(metric)
            if evidence.get('ok') and type(score) in [int,float] and Decimal(str(score)).is_finite():
                distributions[tier].append({'candidateId':candidate_id,'generation':candidate.get('generation'),'score':score})
    for evidence in result.get('final',[]):
        score=evidence.get('metrics',{}).get(metric)
        if evidence.get('candidateId')!='baseline' and evidence.get('ok') and type(score) in [int,float] and Decimal(str(score)).is_finite():
            distributions['final'].append({'candidateId':evidence['candidateId'],'score':score})
    gates=[e for e in events if e.get('kind')=='gate']
    promotions=[{'candidateId':r['candidateId'],'generation':e.get('generation'),
                 'fromTier':e.get('fromTier'),'toTier':e.get('toTier'),'reason':r.get('reason')}
                for e in gates for r in e.get('selected',[])]
    promoted_ids={r['candidateId'] for r in promotions}
    final={e['candidateId']:e for e in result.get('final',[]) if e.get('ok')}
    comparison=result.get('independentFinal') or {}
    eligible=promoted_ids & set(final) if 'baseline' in final and comparison.get('independence')!='NOT_ESTABLISHED' else set()
    verdicts=comparison.get('comparison',{}).get('verdicts',{})
    covered={i for i in eligible if verdicts.get(i) in ['better','not_better']}
    precision={'state':'NOT_APPLICABLE' if not promoted_ids else 'COMPUTED_ON_FIXED_FINAL' if covered==promoted_ids else 'NOT_IDENTIFIABLE',
               'value':sum(verdicts[i]=='better' for i in covered)/len(promoted_ids) if promoted_ids and covered==promoted_ids else None,
               'independentlyEvaluated':len(covered),'totalPromotedCandidates':len(promoted_ids),
               'definition':'Fraction of Fast-to-Slow admitted candidates independently better than their original baseline at final; only defined when all admitted candidates have final evidence. Transport kind is reported separately.'}
    work={'completedBatchReceipts':0,'taskRowsAttempted':0,'programExecutions':0,
          'rowsWithoutProcessExitReceipt':0,'testMethods':0,'localWallTimeMs':0,
          'executionDefinition':'Task rows with an actual integer process exit code, including killed timeouts; invalid formats and failed starts are not program executions.',
          'incompleteReceipts':[],'localComputePricing':'NOT_PRICED'}
    failures=[]
    for path in sorted((directory/'executions').glob('*/evaluation.json')):
        try:
            evaluation=read(path)
            measured=[r for e in evaluation.get('evidence',[]) if e.get('kind')=='executed_python_unittest' for r in e.get('rows',[])]
            work['completedBatchReceipts']+=1;work['taskRowsAttempted']+=len(measured)
            executed=sum(type(r.get('exitCode')) is int for r in measured)
            work['programExecutions']+=executed
            work['rowsWithoutProcessExitReceipt']+=len(measured)-executed
            work['testMethods']+=sum(r.get('planned',0) for r in measured)
            work['localWallTimeMs']+=sum(r.get('wallTimeMs',0) for r in measured)
            failed=[{'taskId':r['taskId'],'status':r.get('status'),'failedTests':r.get('planned',0)-r.get('passed',0)} for r in measured if not r.get('taskPassed')]
            if failed or not evaluation.get('ok'):
                failures.append({'receipt':str(path.relative_to(directory)),'measurementOk':evaluation.get('ok'),'failedTasks':failed})
        except (ValueError,KeyError,TypeError):work['incompleteReceipts'].append(str(path.relative_to(directory)))
    work['localWallTimeMs']=round(work['localWallTimeMs'],3)
    rejected=[]
    for candidate in public_candidates:
        if candidate['id']=='baseline':continue
        stages={t:candidate.get(t,{}) for t in tiers if candidate.get(t,{}).get('state') in ['NOT_PROMOTED','NOT_SELECTED_FOR_FINAL','ERROR','FAILED','REJECTED','DUPLICATE_SKIPPED']}
        if stages:rejected.append({'candidateId':candidate['id'],'stages':stages})
    return {'metricsVersion':2,'candidateScoreDistribution':distributions,
            'bestCandidateScore':{tier:max((r['score'] for r in values),default=None) for tier,values in distributions.items()},
            'promotionCount':len(promotions),'promotionDefinition':'Recorded inter-stage gate admissions, not permanent adoption',
            'promotions':promotions,'promotionPrecision':precision,'totalEvaluationWork':work,
            'measurementFailures':failures,'rejectedCandidates':rejected,'runFailure':result.get('error'),
            'finalPolicy':'Only preselected champion and original baseline; missing candidate final is not a zero score'}


def inspect(out, protocol):
    rows=[];feedback_inputs={}
    metric=protocol.get('primaryMetric','supported_accuracy')
    repeats=protocol.get('independentSearchRepeatsPerMethod',2)
    final_ids=protocol.get('finalTaskIds',[])
    planned_generations=protocol.get('shared',{}).get('generations',2)
    expected_generations=set(range(1,planned_generations+1))
    for arm in protocol['arms']:
        directory=out/arm['directory'];errors=[];sessions=[]
        for file in sorted((directory/'sessions').glob('*.json')):
            try:
                value=read(file);cost=value.get('costCny');attempts=value['costEvidence']['attempts']
                if type(attempts) is not int or attempts not in [0,1]:raise ValueError('invalid attempts')
                if cost is not None and (type(cost) not in [int,float] or not Decimal(str(cost)).is_finite() or cost<0):raise ValueError('invalid CNY')
                sessions.append(value)
            except (ValueError,KeyError,TypeError):errors.append(file.name+': invalid receipt')
        # Actual receipt kind takes precedence over a protocol label. Relabeling
        # fixture transport as live must neither invent paid calls nor efficacy.
        billable=[s for s in sessions if s['costEvidence'].get('kind')=='model' or protocol['live'] and s['costEvidence'].get('kind')!='fixture']
        synthetic=[s for s in sessions if s not in billable]
        known=sum((Decimal(str(x['costCny'])) for x in billable if x.get('costCny') is not None),Decimal(0))
        synthetic_known=sum((Decimal(str(x['costCny'])) for x in synthetic if x.get('costCny') is not None),Decimal(0))
        unknown=bool(errors) or any(x.get('costCny') is None for x in sessions)
        result=read(directory/'result.json') if (directory/'result.json').exists() else {}
        receipt=read(directory/'run-receipt.json') if (directory/'run-receipt.json').exists() else {}
        transport_matches=bool(receipt.get('evidenceKind')==('real_model_usage_priced' if protocol['live'] else 'fixture') and
            all(s['costEvidence'].get('kind')==('model' if protocol['live'] else 'fixture') for s in sessions))
        attempted=bool(sessions) or (directory/'execution-claim.json').exists() or bool(result)
        # The shared native group can have reserved the entire run before a
        # terminal receipt was lost. Partial usage is never complete settlement.
        if attempted and not receipt:unknown=True
        if result.get('budget',{}).get('costCny','absent') is None:unknown=True
        selected=result.get('proxyLeaderId') or result.get('championId') or 'baseline'
        final=next((x for x in result.get('final',[]) if x['candidateId']==selected),{})
        journal=read(directory/'journal.json') if (directory/'journal.json').exists() else {'events':[]}
        events=journal.get('events',[])
        candidates={}
        for event in events:
            if event.get('kind')=='candidate':candidates[event['candidateId']]=event
        candidate_rows=[c for id_,c in candidates.items() if id_!='baseline']
        product=read(directory/'product-report.json') if (directory/'product-report.json').exists() else {}
        public_candidates=[{k:c.get(k) for k in ['id','generation','parentId','version','hypothesis','delta']}|
            {tier:{k:c.get(tier,{}).get(k) for k in ['state','metrics','reason']} for tier in ['fast','slow','final']} for c in product.get('candidates',[])]
        slow_states=[c['slow']['state'] for c in public_candidates if c['id']!='baseline']
        inputs=[];observed_sessions=set();request_by_session={}
        for file in sorted(directory.glob('model-request-*-input.json')):
            request=read(file)
            observed_sessions.add(request.get('sessionId'))
            request_by_session[request.get('sessionId')]=(request,file)
            for message in request.get('messages',[]):
                if message.get('role')!='user':continue
                for block in message.get('content',[]):
                    if block.get('type')!='text':continue
                    try:body=json.loads(block['text'])
                    except (ValueError,TypeError):continue
                    if 'feedback' not in body:continue
                    matched=next((x for x in sessions if x.get('sessionId')==request.get('sessionId') and x.get('operation')=='generate'),None)
                    event=next((e for e in events if e.get('kind')=='feedback' and e.get('generation')==body.get('generation')),None)
                    structured=arm.get('searchProfile') in ['history-structured-v2','properties-structured-v3']
                    prior_ids={id_ for id_,c in candidates.items() if c.get('generation',0)<body.get('generation',0)}
                    identity=bool(matched and matched['costEvidence']['attempts']==1 and event and
                        (structured_feedback_identity(body,matched,event,prior_ids) if structured else
                         native_digest(body['feedback'])==event['feedbackDigest']==matched.get('feedbackDigest')))
                    measured={id_:c['slow'] for id_,c in candidates.items() if id_!='baseline' and c.get('generation',0)<body.get('generation',0) and c.get('slow')}
                    inputs.append({'generation':body.get('generation'),'feedback':body['feedback'],'identityMatched':identity,'structured':structured,'measuredPriorCandidateSlow':measured,
                        'toolsAbsent':not request.get('tools'),'finalAbsent':not any(i in json.dumps(body) for i in final_ids) if final_ids else 'final-group-' not in json.dumps(body),
                        'inputFile':str(file.relative_to(out)),'sha256':sha(file)})
        feedback_inputs[arm['id']]=inputs
        search_context=(not arm.get('searchProfile') in ['history-structured-v2','properties-structured-v3'] or arm['method']=='B0' or
            len(inputs)==planned_generations and {x['generation'] for x in inputs}==expected_generations and
            all(x['identityMatched'] and x['toolsAbsent'] and x['finalAbsent'] for x in inputs))
        if attempted and observed_sessions!={x.get('sessionId') for x in sessions}:unknown=True
        executions=[]
        for session in sessions:
            if session.get('operation')!='execute' or session['costEvidence']['attempts']!=1:continue
            request,file=request_by_session.get(session.get('sessionId'),({},None))
            snapshot=candidates.get(session.get('candidateId'),{}).get('candidate',{})
            expected=snapshot.get('persona','').replace('{{model}}',request.get('model','')).replace('{{cwd}}',request.get('runtimeCwd','')).strip()
            matched=bool(expected and request.get('runtimeCwd') and session.get('candidateVersion')==snapshot.get('version') and expected in (request.get('system') or ''))
            executions.append({'candidateId':session.get('candidateId'),'tier':session.get('tier'),'sessionId':session.get('sessionId'),
                'personaAndVersionMatched':matched,'inputFile':str(file.relative_to(out)) if file else None})
        search_cost=sum((Decimal(str(s['costCny'])) for s in billable if s.get('costCny') is not None and s.get('tier')!='final'),Decimal(0))
        final_cost=known-search_cost
        extra_metrics=code_experiment_metrics(directory,candidates,events,result,metric,public_candidates) if arm.get('benchmarkKind')=='code' else None
        rows.append({**arm,**({'experimentMetrics':extra_metrics} if extra_metrics else {}),'status':result.get('status','UNCERTAIN' if attempted else 'NOT_RUN'),'receiptStatus':receipt.get('status'),
            'generationsRun':result.get('generationsRun',0),'finalScore':final.get('metrics',{}).get(metric) if final.get('ok') else None,
            'selectedId':selected,'conclusion':result.get('independentFinal',{}).get('conclusion') if result.get('independentFinal') else result.get('conclusion'),
            'knownCostCny':float(known),'costCny':None if unknown else float(known),
            'syntheticCostCny':float(synthetic_known) if synthetic else None,'searchCostCny':float(search_cost),
            'finalCostCny':float(final_cost),'paidCalls':sum(s['costEvidence']['attempts'] for s in billable),
            'syntheticRequests':sum(s['costEvidence']['attempts'] for s in synthetic),'unknownCost':unknown,'transportMatchesProtocol':transport_matches,
            'receiptErrors':errors,'wallTimeMs':receipt.get('wallTimeMs'),'inputTokens':sum((s['costEvidence'].get('usage') or {}).get('inputTokens',0) for s in sessions),
            'cacheReadTokens':sum((s['costEvidence'].get('usage') or {}).get('cacheReadTokens',0) for s in sessions),
            'outputTokens':sum((s['costEvidence'].get('usage') or {}).get('outputTokens',0) for s in sessions),
            'developmentSampleSizes':sorted({c['fast']['metrics']['sample_size'] for c in candidates.values() if c.get('fast')}),
            'candidateSlowStates':slow_states,'candidateCount':len(candidate_rows),'candidates':public_candidates,'finalTaskRows':final.get('evidence',[]),
            **({'searchContextVerified':bool(search_context),'generationInputAudit':inputs} if arm.get('searchProfile') in ['history-structured-v2','properties-structured-v3'] else {}),
            'overlayExecutionVerified':bool(executions and all(x['personaAndVersionMatched'] for x in executions)),'executionInputAudit':executions,
            'productReport':str((directory/'product-report.json').relative_to(out)) if (directory/'product-report.json').exists() else None})
    audits=[]
    for repeat in range(1,repeats+1):
        all_b2=feedback_inputs.get(f'set{repeat}-B2',[]);all_b3=feedback_inputs.get(f'set{repeat}-B3',[])
        consuming=[]
        for b2 in all_b2:
            if b2['generation']<=1:continue
            if b2['identityMatched'] and any(x.get('candidateId') in b2['measuredPriorCandidateSlow'] and x.get('status')=='OBSERVED' and
                x.get('slow',{}).get('ok') is True and all(x['slow'].get(k)==b2['measuredPriorCandidateSlow'][x['candidateId']].get(k) for k in ['candidateId','tier','evaluatorId','version','dataId','metrics'])
                for x in b2['feedback'].get('slowFeedback',{}).get('observations',[])):
                consuming.append(b2['generation'])
        consumed=bool(consuming)
        def complete_inputs(inputs):
            return len(inputs)==planned_generations and {x['generation'] for x in inputs}==expected_generations
        removed=bool(complete_inputs(all_b3) and all(x['identityMatched'] and
            explicit_slow_removed(x['feedback'],x['structured']) for x in all_b3))
        both_complete=complete_inputs(all_b2) and complete_inputs(all_b3)
        no_tools=bool(both_complete and all(x['toolsAbsent'] for x in all_b2+all_b3))
        no_final=bool(both_complete and all(x['finalAbsent'] for x in all_b2+all_b3))
        audits.append({'repeat':repeat,'plannedGenerations':planned_generations,'consumingGenerations':sorted(set(consuming)),'b2CandidateSlowConsumed':consumed,'b3ExplicitSlowRemoved':removed,
            'generatorToolsAbsent':no_tools,'finalAbsent':no_final,
            'state':'ACTIVATED' if consumed and removed and no_tools and no_final else 'INACTIVE_OR_UNVERIFIED','inputs':all_b2+all_b3})
    expected={(r,m) for r in range(1,repeats+1) for m in ['B0','B1','B2','B3']}
    complete=len(rows)==len(expected) and {(r['repeat'],r['method']) for r in rows}==expected and all(
        x['status']=='completed' and x['receiptStatus']=='PASS' and x['finalScore'] is not None and not x['unknownCost']
        and x['overlayExecutionVerified'] and x['transportMatchesProtocol'] and x.get('searchContextVerified',True) for x in rows)
    known=sum(Decimal(str(x['knownCostCny'])) for x in rows)
    report={'status':('REAL_COMPARISON_COMPLETED' if protocol['live'] else 'FUNCTIONAL_CONTROL_COMPLETE') if complete else 'INCOMPLETE',
        'realMethodComparisonVerified':bool(protocol['live'] and complete),'realAblationActivated':bool(protocol['live'] and complete and all(x['state']=='ACTIVATED' for x in audits)),
        'evidenceKind':protocol.get('evidenceKind','real_model_on_synthetic_task') if protocol['live'] else 'scripted_transport_control',
        'currency':'CNY','totalCostCny':None if any(x['unknownCost'] for x in rows) else float(known),'knownCostCny':float(known),
        'paidCalls':sum(x['paidCalls'] for x in rows),'syntheticRequests':sum(x['syntheticRequests'] for x in rows),
        'arms':rows,'ablationControls':audits,'plannedIndependentSearchRepeatsPerMethod':repeats,
        'attemptedIndependentSearchRepeats':{m:sum(r['method']==m and r['status']!='NOT_RUN' for r in rows) for m in ['B1','B2','B3']},
        'completedIndependentSearchRepeats':{m:sum(r['method']==m and r['status']=='completed' and r['receiptStatus']=='PASS' for r in rows) for m in ['B1','B2','B3']},
        'improvementProven':False,'limitations':protocol['limitations']}
    save(out/'comparison-result.json',report)
    return report


def main(kind='fact'):
    if kind not in ['fact','code']:raise ValueError('Unknown comparison task kind')
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--mode',choices=['offline','prepare-live','execute','inspect'],required=True)
    for name in ['output','dsh-package','dataset','answer-key','target','pricing','authorization']:
        p.add_argument('--'+name,type=Path,required=name=='output')
    p.add_argument('--benchmark-pack',type=Path,help='Code-only frozen dataset/key/manifest directory')
    p.add_argument('--search-profile',choices=['legacy-v1','history-structured-v2','properties-structured-v3'],default='history-structured-v2' if kind=='code' else None,
                   help='Code study composition; v2 uses full history and three assigned structural operators')
    p.add_argument('--warm-start-config',type=Path,help='Code v2 native warmStart JSON; selected history never imports costs or authority')
    p.add_argument('--journal-root',type=Path,help='Existing native Journal directory for optional code v2 history reuse')
    p.add_argument('--optimization-arm-cost-cny',type=float,help='Optional lower equal CNY ceiling for properties-structured-v3 search arms; never spending authorization')
    args=p.parse_args();out=args.output.resolve()
    if kind!='code' and any([args.search_profile,args.warm_start_config,args.journal_root]):p.error('Code history options do not alter the existing fact study')
    if args.optimization_arm_cost_cny is not None and (kind!='code' or args.search_profile!='properties-structured-v3'):
        p.error('A reduced search-arm cap applies only to the property study')
    if args.mode in ['execute','inspect']:
        if args.mode=='execute' and (not (out/'comparison-prepared.json').exists() or not args.authorization):
            p.error('Frozen comparison and explicit current allocation required')
        protocol=read(out/'comparison-protocol.json')
        if args.mode=='inspect':print(json.dumps(inspect(out,protocol),ensure_ascii=False));return 0
        frozen=read(out/'comparison-prepared.json');auth=read(args.authorization)
        if (out/'execution-claim.json').exists():p.error('Existing study claim; inspect retained results, no automatic replay')
        if not protocol['live'] or manifest_digest(frozen)!=frozen['manifestDigest']:p.error('Frozen live study manifest mismatch')
        if any(auth.get(k)!=frozen[k] for k in ['scope','manifestDigest','currency','maxCostCny','maxModelRequests']) or auth.get('approvedBy')!='user' or not auth.get('authorizationText'):
            p.error('Authorization does not match the frozen CNY/request study envelope')
        for file,expected in frozen['fileHashes'].items():
            if sha(Path(file))!=expected:p.error('Frozen input changed: '+file)
        if not os.environ.get('DEEPSEEK_API_KEY'):p.error('DEEPSEEK_API_KEY absent; no dispatch')
        with (out/'execution-claim.json').open('x') as file:
            json.dump({'authorizationSha256':sha(args.authorization),'manifestDigest':frozen['manifestDigest']},file);file.flush();os.fsync(file.fileno())
        save(out/'authorization-used.json',auth)
        for arm in protocol['arms']:
            child=read(out/arm['directory']/'prepared.json')
            allocation={k:child[k] for k in ['scope','currency','maxCostCny','maxModelRequests','manifestDigest','planDigest']}
            allocation.update(approvedBy='user',authorizationText=auth['authorizationText'],batch=auth.get('batch'),parentManifestDigest=frozen['manifestDigest'],method=arm['method'],repeat=arm['repeat'])
            save(out/arm['directory']/'study-authorization.json',allocation)
            run_child(out,arm,'execute')
            report=inspect(out,protocol)
            if any(row['unknownCost'] for row in report['arms']) or report['knownCostCny']>protocol['maxCostCny'] or report['paidCalls']>protocol['maxModelRequests']:break
        report=inspect(out,protocol);print(report['status']);return 0 if report['status']=='REAL_COMPARISON_COMPLETED' else 2
    if kind=='code':
        if not args.benchmark_pack or args.dataset or args.answer_key:p.error('Code comparison requires --benchmark-pack; do not override its dataset/key separately')
        args.dataset=args.benchmark_pack/'dataset.json';args.answer_key=args.benchmark_pack/'answer-key.json'
    elif args.benchmark_pack:p.error('--benchmark-pack is for the code entry')
    if not all([args.dsh_package,args.dataset,args.answer_key,args.target]) or args.mode=='prepare-live' and not args.pricing:
        p.error('Supply existing DSH, frozen task/key and original Target; fresh pricing for live preparation')
    if out.exists():p.error('Use a new output; previous attempts are immutable')
    env={**os.environ,'DUO_DSH_PACKAGE':str(args.dsh_package.resolve())}
    prepare_script='scripts/prepare_code_comparison.mjs' if kind=='code' else 'scripts/prepare_fact_comparison.mjs'
    prepare_command=['node','--loader','./scripts/dsh_native_loader.mjs',prepare_script,str(out),
        str(args.dataset.resolve()),str(args.answer_key.resolve()),str(args.target.resolve()),str(args.mode=='prepare-live').lower()]
    if kind=='code':prepare_command += [args.search_profile,str(args.warm_start_config.resolve()) if args.warm_start_config else '',str(args.journal_root.resolve()) if args.journal_root else '',str(args.optimization_arm_cost_cny) if args.optimization_arm_cost_cny is not None else '']
    made=subprocess.run(prepare_command,cwd=ROOT,env=env,capture_output=True,text=True)
    if made.returncode:p.error(made.stderr)
    protocol=read(out/'comparison-protocol.json')
    for arm in protocol['arms']:
        if run_child(out,arm,args.mode,dsh=args.dsh_package,pricing=args.pricing)!=0:
            print('Preparation/control failed; retained '+arm['id']);return 2
    if args.mode=='offline':
        report=inspect(out,protocol);print(report['status']);return 0 if report['status']=='FUNCTIONAL_CONTROL_COMPLETE' else 2
    files={str(out/'comparison-protocol.json'):sha(out/'comparison-protocol.json')}
    for path in [*sorted((out/'inputs').rglob('*')),Path(__file__),ROOT/prepare_script,
                 *([ROOT/'scripts/run_code_comparison.py'] if kind=='code' else [])]:
        if path.is_file():files[str(path.resolve())]=sha(path)
    if kind=='code' and args.search_profile=='properties-structured-v3':
        source_manifest=read(args.benchmark_pack/'manifest.json')
        for name,expected in source_manifest['sourceBindings'].items():
            if sha(Path(name))!=expected:raise ValueError('Qualification input identity changed during preparation')
            files[str(Path(name).resolve())]=expected
        files[str((ROOT/'scripts/prepare_code_property_study.py').resolve())]=sha(ROOT/'scripts/prepare_code_property_study.py')
    for arm in protocol['arms']:
        path=out/arm['directory']/'prepared.json';files[str(path)]=sha(path);files.update(read(path)['fileHashes'])
    frozen=seal_manifest({'status':'PREPARED_NOT_EXECUTED','scope':protocol['scope'],'currency':'CNY','maxCostCny':protocol['maxCostCny'],'maxModelRequests':protocol['maxModelRequests'],'fileHashes':files})
    save(out/'comparison-prepared.json',frozen)
    save(out/'authorization-template.json',{k:frozen[k] for k in ['scope','currency','maxCostCny','maxModelRequests','manifestDigest']}|{'approvedBy':None,'authorizationText':None,'batch':'CURRENT_ALLOCATION_REQUIRED'})
    print('All'+str(len(protocol['arms']))+'profiles frozen; zero model calls');return 0


if __name__=='__main__':
    raise SystemExit(main())
