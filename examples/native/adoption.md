# Deliver, adopt and restore a persona through DSH

DUO returns candidate overlays and original snapshots. Optimization never writes
the original persona or adopts a candidate. Reading `dualloop_status` and
`dualloop_report` for an existing run does not repeat model work.

After a completed run, use the public `dualloop_status({runId})` response and
choose an explicit candidate ID. The caller-owned helpers in
[adoption.js](adoption.js) use only that response and Node's built-in SHA256:

```js
import {preparePersonaDelivery,personaReplacement} from './adoption.js'
const delivery = preparePersonaDelivery(status, candidateId)
// Preserve delivery as JSON using already-authorized host file tools.
// It contains original/candidate complete UTF-8 text, hashes, parent lineage,
// source run/plan identity, source Target path and the actual run conclusion.
```

The helper verifies every ancestor back to the recorded original. Missing or
conflicting versions, changed overlays, removed required placeholders, cycles,
nonterminal runs and oversized input are refused. It accepts at most 4,096
Journal events and 65,536 UTF-8 bytes per persona. It does not grant authority,
choose a winner, certify authenticity or establish a quality improvement.
An explicitly requested unselected candidate remains an unselected artifact.

To try the candidate, obtain authority for a specific isolated destination and
the exact candidate version. Preserve the original bytes in the delivery first.
Copy the original persona to that destination using the existing authorized
host tools. Do not overwrite the actual Target or a user profile. A new
destination, active profile change or model check needs its own authority.

The existing DSH composition uses `@deepseek-ai/dsh-fs-local`,
`@deepseek-ai/dsh-fs-observation-policy` and `@deepseek-ai/dsh-tool-fs` alongside
the current tools and Agent services; [example rows](adoption-profile.patch.yml)
are for an already-authorized isolated profile. These rows do not restrict
paths or grant file permissions: the host must separately enforce the allowed
destination and operation. Do not load them globally merely to use DUO.

Within the same Agent session:

1. `read({file_path: "<delivery.json>"})` and inspect the run, candidate, lineage,
   full original and candidate text, conclusion, constraints and evidence limits.
2. `read({file_path: "<isolated-persona.txt>"})`. Compare the complete current
   UTF-8 contents with `delivery.original.version` before adopting. A trusted
   caller plugin can obtain exact text through public `ctx.fs.readText` after
   the tool read, and call
   `personaReplacement(delivery, currentPersona, 'adopt')`.
   Model-facing line windows are not a byte-exact snapshot: never guess the
   final newline or reconstruct truncated/normalized content as a hash input.
3. With current explicit write authority, call
   `write({file_path: "<isolated-persona.txt>", content: replacement.content})`.
   Do not omit DSH's observation policy or switch sessions to bypass refusal.
4. Read again and verify the resulting contents against the candidate SHA256.
   Keep the native write result and original artifact. This proves file
   adoption only; it does not load that file into an active profile.
5. For authorized rollback, read the copy in the same session and require its
   hash to equal `delivery.candidate.version`. Then use
   `personaReplacement(delivery, currentPersona, 'rollback')`, pass its content
   to the same host `write`, and verify the original hash and exact bytes.

If the current copy differs before either action, stop that action and inspect
the changes. A successful read does not authorize overwriting an unrelated
version. DSH also rejects a stale observed filesystem version. Do not overwrite
newer user work, silently rebase, bypass a guard or automatically retry.
The local filesystem provider is a trusted backend, not a hostile-process
isolation boundary; use the host's supported confinement where required.

Loading a persona into an active profile depends on that profile's existing
system-prompt configuration and reload policy. It is a separate integration and
authorization step; no universal deployment/rollback service is supplied or
claimed. Hosts without writable filesystem tools can still export/inspect the
candidate and original, but direct adoption is unavailable there.

Offline executable acceptance from the project root:

```sh
python3 scripts/verify_dsh_native.py --dsh-package /absolute/path/to/installed/@deepseek-ai/dsh --scenario adoption --output runs/my-new-adoption-check
```

The output must be a new directory. It uses cached packages, a new DSH home,
zero-CNY fixture generation/evaluation, actual DSH read/write in an Agent session,
and an explicitly owned copy. It verifies refusal before reading, stale
observation, changed contents, denial on the original Target, adoption, rollback
and an unchanged DUO Journal/budget. The Agent has no model work. This is file
operation engineering evidence, not autonomous Caller or optimization evidence.
