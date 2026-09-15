"""Reuse search tasks, with a separately authored final slice for this comparison."""
import json
from prepare_native_docs_mini import prepare, CORPUS, PIN
from dsh_model_profile import sha, save


def prepare_comparison(output):
    data = prepare(output)
    specifications = [
        ('meter', 'For TokenMeasurement, identify the field counting consumed durable events and the field equal to the sum of surface node prices.',
         ['logRevision', 'surfaceTokens'], 'subsystems/token-meter.md', 9, 29),
        ('command', 'For CommandDefinition, identify the option controlling whether raw input is logged and its default value.',
         ['recordInput', 'true'], 'subsystems/commands.md', 28, 51),
        ('workflow', 'For WorkflowStartRequest, identify the required attribution field and the optional field lowering the total child ceiling. What kind of data are meta and args?',
         ['parent', 'maxTotalAgents', 'json'], 'subsystems/workflow.md', 11, 39),
        ('jobs', 'For JobHooks, state the cancellation function requirements and when done resolves relative to producer resource cleanup.',
         ['synchronous', 'idempotent', 'releas'], 'subsystems/jobs.md', 59, 81),
    ]
    tasks, sources = [], {}
    for id_, question, keys, file, start, end in specifications:
        path = CORPUS / file
        text = '\n'.join(path.read_text().splitlines()[start-1:end])
        assert all(key.lower() in text.lower() for key in keys), id_
        sources[file] = sha(path)
        tasks.append({'id': 'comparison-final-' + id_,
            'input': f'Answer from the supplied snapshot only. Cite the exact source path.\nQUESTION: {question}\n\nSOURCE: {file} (lines {start}-{end}, snapshot {PIN})\n{text}',
            'expected': {'type': 'single_fact', 'question': question, 'answerKeys': keys,
                'acceptanceCues': [], 'forbiddenKeys': [], 'goldFiles': [file], 'allowedFiles': [file]}})
    data['name'] = 'docs-native-comparison-v2'
    data['final'] = {'id': 'docs-native-comparison-final-v2', 'tasks': tasks}
    save(output / 'dataset.json', data)
    provenance = json.loads((output / 'provenance.json').read_text())
    provenance.update(final='Four new questions on four source pages. Shared across all frozen comparison arms and repeats; never fed to search.',
        finalSourceHashes=sources, priorFinalReuse=False,
        qualification='Authored supplied-context lexical/citation tests, not an independently qualified semantic or retrieval benchmark.')
    save(output / 'provenance.json', provenance)
    return data
