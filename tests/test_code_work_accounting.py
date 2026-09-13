"""A rejected answer is a task attempt, not an isolated program execution."""
import json
import sys
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from run_fact_comparison import code_experiment_metrics


def test_work_counts_actual_process_receipts_separately_from_unexecuted_rows(tmp_path):
    batch=tmp_path/'executions'/'one';batch.mkdir(parents=True)
    rows=[
        {'taskId':'valid','status':'completed','exitCode':0,'taskPassed':True,'passed':7,'planned':7,'wallTimeMs':10},
        {'taskId':'bad-format','status':'invalid_answer_format','taskPassed':False,'passed':0,'planned':0},
        {'taskId':'failed-to-start','status':'unavailable','taskPassed':False,'passed':0,'planned':0},
        {'taskId':'timed-out','status':'timeout','exitCode':-9,'taskPassed':False,'passed':0,'planned':0,'wallTimeMs':6000},
    ]
    (batch/'evaluation.json').write_text(json.dumps({'ok':False,'evidence':[{'kind':'executed_python_unittest','rows':rows}]}))
    metrics=code_experiment_metrics(tmp_path,{},[],{},'task_pass_rate',[])
    work=metrics['totalEvaluationWork']
    assert work['programExecutions']==2
    assert work['taskRowsAttempted']==4
    assert work['rowsWithoutProcessExitReceipt']==2
    assert work['testMethods']==7
    assert metrics['metricsVersion']==2
