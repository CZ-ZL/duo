"""Freeze a small supplied-context docs-QA slice before any optimization.

Reuses eight DEV questions and the existing SPEC's content/citation rules.
Four historical final-partition questions are never passed to the generator.
All of these public demo questions have been consumed; they are not an unseen
independent final for future research. This is not the full tool-using benchmark.
"""
from pathlib import Path
import hashlib
import json
import yaml

ROOT = Path(__file__).resolve().parents[2]
CORPUS = ROOT / 'research/benchmarks/docs_qa/dsh-snapshot/docs'
PIN = '0a53fb55bea101816fa226bb964ae2bed71c343b'


def prepare(output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    questions = {q['id']: q for q in yaml.safe_load((ROOT / 'research/benchmarks/docs_qa/questions.dev.yml').read_text())}
    selections = {
        'sf-03': [('subsystems/sandbox.md', 9, 22)],
        'sy-03': [('subsystems/approval.md', 20, 34), ('tool-execution-pipeline.md', 5, 49)],
        'ab-01': [('architecture.md', 41, 45)],
        'cs-01': [('subsystems/jobs.md', 9, 25)],
        'sf-05': [('subsystems/jobs.md', 155, 157)],
        'sy-01': [('architecture.md', 121, 132), ('subsystems/jobs.md', 155, 157)],
        'ab-02': [('user/guide/providers.md', 5, 22), ('subsystems/credentials.md', 5, 22)],
        'cs-02': [('subsystems/skills.md', 64, 76)],
    }
    final_specs = [
        ('new-final-01', 'In the documented CreateAgentOptions contract, what is the cancellation signal scope, and which callback composes scoped registrations before publication? Use the documented API terms.', ['creation-only', 'setup'], 'subsystems/core.md', 24, 51),
        ('new-final-02', 'Enumerate all four live AgentCancelCause kind literals, and identify which kind requires a reason string.', ['user', 'parent', 'hook', 'disposed', 'reason'], 'subsystems/core.md', 185, 207),
        ('new-final-03', 'For SystemPrompt.section, what happens when an agent scoped section has the same name as a global section, and what happens for duplicate names within one layer?', ['shadow', 'duplicate'], 'subsystems/system-prompt.md', 96, 110),
        ('new-final-04', 'What does an effective complete prompt section become after cooperative assembly, and what happens when more than one complete section is effective?', ['sole', 'fail'], 'subsystems/system-prompt.md', 40, 67),
    ]
    provenance = {}

    def context(rows):
        blocks = []
        for file, start, end in rows:
            raw = (CORPUS / file).read_bytes()
            provenance[file] = hashlib.sha256(raw).hexdigest()
            excerpt = '\n'.join(raw.decode().splitlines()[start - 1:end])
            blocks.append(f'SOURCE: {file} (lines {start}-{end}, snapshot {PIN})\n{excerpt}')
        return '\n\n'.join(blocks)

    def task(q, rows):
        files = [row[0] for row in rows]
        return {'id': q['id'], 'input': 'Answer from the supplied DSH snapshot only. Cite source paths exactly. If a requested feature is unsupported, refute the premise rather than inventing details.\nQUESTION: ' + q['question'] + '\n\n' + context(rows),
                'expected': {'type': q['type'], 'question': q['question'],
                    'answerKeys': q.get('gold_answer_keys', []), 'acceptanceCues': q.get('acceptance_cues', []),
                    'forbiddenKeys': q.get('forbidden_keys', []), 'goldFiles': q['gold_files'], 'allowedFiles': files}}

    data = {'version': 1, 'name': 'docs-qa-supplied-context-mini-v1',
        'responseInstructions': 'Return ONLY a JSON object mapping EVERY task id to {"answer":"your factual answer", "citations":["exact source path"]}. No markdown fences. Answer each task independently, using only its supplied sources. Concise answers, no more than 100 words per task.',
        'fast': {'id': 'docs-mini-fast-v1', 'tasks': [task(questions[i], selections[i]) for i in ['sf-03', 'sy-03', 'ab-01', 'cs-01']]},
        'slow': {'id': 'docs-mini-slow-v1', 'tasks': [task(questions[i], selections[i]) for i in ['sf-05', 'sy-01', 'ab-02', 'cs-02']]},
        'final': {'id': 'docs-mini-fresh-final-v1', 'tasks': []}}
    for id_, question, keys, file, start, end in final_specs:
        data['final']['tasks'].append(task({'id': id_, 'question': question, 'type': 'single_fact', 'gold_answer_keys': keys, 'gold_files': [file]}, [(file, start, end)]))
    for tier in ['fast', 'slow', 'final']:
        for row in data[tier]['tasks']:
            assert all(key.lower() in row['input'].lower() for key in row['expected']['answerKeys']), row['id']
    (output / 'dataset.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    (output / 'persona.txt').write_bytes((ROOT / 'examples/native/persona.txt').read_bytes())
    provenance['research/benchmarks/docs_qa/questions.dev.yml'] = hashlib.sha256((ROOT / 'research/benchmarks/docs_qa/questions.dev.yml').read_bytes()).hexdigest()
    (output / 'provenance.json').write_text(json.dumps({'upstreamPin': PIN, 'sourceHashes': provenance,
        'search': '8 existing dev questions partitioned fast/slow', 'final': '4 public historical demo questions; never generator input; not unseen final',
        'limitations': ['Small supplied-context test, not retrieval/tool-use qualification.', 'Substring/citation judge has lexical and saturation limits; no general improvement claim.', 'Four final tasks are correlated across two source pages; no statistical significance claim.']}, indent=2) + '\n')
    return data
