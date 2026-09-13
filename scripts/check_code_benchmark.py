"""Check development references and fixed wrong controls; never evaluate final."""
import argparse
import hashlib
import json
from pathlib import Path
from code_evaluation import evaluate_batch, save


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pack', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    data = json.loads((args.pack / 'dataset.json').read_text())
    keys = json.loads((args.pack / 'answer-key.json').read_text())['tasks']
    rows = []
    for kind in ['reference', 'constant_wrong']:
        for tier in ['fast', 'slow']:
            answers = {t['id']: keys[t['id']]['code_prompt'] +
                       (keys[t['id']]['canonical_solution'] if kind == 'reference' else '    return None\n')
                       for t in data[tier]['tasks']}
            artifact = {'text': json.dumps(answers), 'status': 'completed', 'tier': tier}
            save(args.output / (kind + '-' + tier + '-artifact.json'), artifact)
            result = evaluate_batch(args.pack, tier, artifact, args.output / (kind + '-' + tier))
            expected = 1 if kind == 'reference' else 0
            row = {'kind': kind, 'tier': tier, 'ok': result['ok'], 'metrics': result['metrics'],
                   'matched': result['ok'] and result['metrics']['task_pass_rate'] == expected}
            rows.append(row)
            print(json.dumps(row), flush=True)
    report = {'status': 'PASS' if all(r['matched'] for r in rows) else 'FAIL', 'rows': rows,
              'qualification': 'DEVELOPMENT_REFERENCES_AND_CONSTANT_WRONG_ONLY',
              'final': 'NOT_RUN', 'modelRequests': 0, 'costCny': 0,
              'localCompute': 'wall time recorded; not priced', 'modelHeadroom': 'NOT_RUN',
              'sources': {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in
                          [args.pack / 'dataset.json', args.pack / 'answer-key.json',
                           Path(__file__), Path(__file__).with_name('code_evaluation.py'), Path(__file__).with_name('code_worker.py')]}}
    save(args.output / 'report.json', report)
    return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
