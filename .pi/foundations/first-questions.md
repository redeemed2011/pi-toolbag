# First Questions

**Session date**: 2026-10-09
**Status**: ACTIVE

## The one-sentence goal

> "An orchestrator you already bound can attach a worker to that same project with its own session and one assigned question, and the tools enforce that the worker cannot change shared law, inherit your claim, or rebind."

## Interrogated items

### Orchestrator-only attach, no prompt

- **Original request**: "the orchestrator would be the only agent allowed to attach an agent to the project without user interaction or confirmation."
- **Source / who / when**: User, 2026-10-09. Confirmed as the top priority with "my last message is the top priority".
- **Alignment with the goal**: Strong
- **Outcome**: KEPT
- **Challenges**: The user already bound the orchestrator. A second prompt adds nothing. A silent path on the existing bind would also harvest law.
- **Decision rationale**: Only a session the user bound may create an attachment. The worker cannot create one by itself.

### Own conversation, observations, compaction, and claim

- **Original request**: "each worker has its own conversation, observations, compactions and task claim."
- **Source / who / when**: User, 2026-10-09.
- **Alignment with the goal**: Strong
- **Outcome**: KEPT
- **Challenges**: Sharing the orchestrator session would copy its claim and its observations. A separate session is the smallest version.
- **Decision rationale**: The worker is a separate Pi session. Its continuity stays in that session.

### Same project records, not the orchestrator's claim

- **Original request**: "the workers consult the same project records but do not inherit the orchestrator's active claim."
- **Source / who / when**: User, 2026-10-09.
- **Alignment with the goal**: Strong
- **Outcome**: KEPT
- **Challenges**: Defaulting the worker claim to the orchestrator's claim would violate the sentence.
- **Decision rationale**: The assigned question is an explicit argument. It is never copied from the orchestrator's claim.

### Ownership, not a lock

- **Original request**: "attachment does not turn it into a cross-agent task lock. it is seperate task ownership though."
- **Source / who / when**: User, 2026-10-09.
- **Alignment with the goal**: Strong
- **Outcome**: KEPT
- **Challenges**: A mutex would stop another session from reading or holding the same question. The user refused that.
- **Decision rationale**: The worker's session owns the question it was given. Nothing in the project stops another session from claiming or being granted that question.

### Survives compaction and resume

- **Original request**: "attachment has to remain valid through compaction and resume, which is one of the key elements of ctx for long horizon work."
- **Source / who / when**: User, 2026-10-09.
- **Alignment with the goal**: Strong
- **Outcome**: KEPT
- **Challenges**: A grant that lives only in the prompt is gone after compaction. The attachment has to be session state the branch still folds.
- **Decision rationale**: The worker's own session records the attachment. No second store.

### Observations distinct from shared judgments

- **Original request**: "its session oberservations support continuity; shred project judgements remain distinct from those observations."
- **Source / who / when**: User, 2026-10-09.
- **Alignment with the goal**: Strong
- **Outcome**: KEPT
- **Challenges**: Promoting observations into project law would mix the two and would decide law for the user.
- **Decision rationale**: Observations stay on the worker session. Project judgments stay in the project log.

### Findings and proposed changes come back

- **Original request**: "they return findings and proposed changes to the orchestrator agent."
- **Source / who / when**: User, 2026-10-09.
- **Alignment with the goal**: Strong
- **Outcome**: KEPT
- **Challenges**: The orchestrator cannot read the worker's observations. A finding has to be visible in the shared project without becoming injected law.
- **Decision rationale**: A worker may append a finding that does not supersede, block, or conflict. The orchestrator reads it and decides what becomes law.

### Orchestrator adjudicates shared law

- **Original request**: "orchestrator adjudicates shared-law changes."
- **Source / who / when**: User, 2026-10-09.
- **Alignment with the goal**: Strong
- **Outcome**: KEPT
- **Challenges**: A bound worker can already mint constraints, destinations, questions, and tombstones with no prompt. Guidance will not stop that.
- **Decision rationale**: The worker tool refuses every shared-law write. The orchestrator uses the existing record tool.

### No silent rebind

- **Original request**: "workers request a project change from orchestrator rather than silently rebinding."
- **Source / who / when**: User, 2026-10-09.
- **Alignment with the goal**: Strong
- **Outcome**: KEPT
- **Challenges**: An attached worker that can unbind and bind again can leave the project it was given.
- **Decision rationale**: The worker tool refuses bind, unbind, and a second project. A project change is a new grant from the orchestrator, not a worker choice.

### Enforcement is the tool, not the disk

- **Original request**: "all this needs actual enforcement since AI likes to break rules and guidance." Then: "maybe we keep the security claim narrow. the tool errors are useful but do not prevent the worker from running bash to circumvent it to update the ctx project."
- **Source / who / when**: User, 2026-10-09, both turns.
- **Alignment with the goal**: Strong for tool errors. None for a claim that bash cannot write the project.
- **Outcome**: MODIFIED to tool errors on the ctx tools. A worker with a shell and a write grant on `~/.pi/ctx` can still append the log. This goal does not close that.
- **Challenges**: Calling the tool refusal a security boundary would be false. The user cut that claim.
- **Decision rationale**: The tools return errors. The disk is not part of the control.
### Worker finding allowlist

- **Original request**: "probably do this as a small allowlist of accepted fields rather than a blacklist which may be accidentally circumvented by future record fields."
- **Source / who / when**: User, 2026-10-09.
- **Alignment with the goal**: Strong
- **Outcome**: KEPT
- **Challenges**: A blacklist of `supersedes`, `blocks`, and `conflicts_with` lets a later field through. An allowlist that ignores unknown keys has the same hole.
- **Decision rationale**: A worker record may contain only `type: "finding"`, `headline`, `body`, and `parent`. Any other key is an error. `parent` must be the granted question id.

### Finding discovery

- **Original request**: "appending a finding does not guarantee the orchestrator or another worker will notice it. perhaps require the worker's result to include its finding IDs."
- **Source / who / when**: User, 2026-10-09.
- **Alignment with the goal**: Strong
- **Outcome**: MODIFIED to a pull of live findings whose parent is the question, plus the new id in the record tool result. Ctx does not read the worker's reply. The orchestrator treats a reply that omits those ids as incomplete.
- **Challenges**: The reply is outside ctx, so ctx cannot require text in it. Another worker never sees that reply. A pull is what both can call.
- **Decision rationale**: The id is returned when the finding is written. Anyone bound to the project can list findings for that question. The reply check belongs to the orchestrator.

### Local close

- **Original request**: "shall we allow the worker to close its own claim? maybe allow status, claim the granted question, and local close ... it does not resolve X, release a global lock or necessarily revoke the grant."
- **Source / who / when**: User, 2026-10-09.
- **Alignment with the goal**: Strong
- **Outcome**: KEPT
- **Challenges**: Close already writes only this session's claim. Using it to tombstone the question or delete the grant would make it a lock release.
- **Decision rationale**: Status, claim of the granted question, and close are allowed. Close means this session is no longer focused on that question. The question, the grant, and every other session stay as they are.

### Question retired while the worker is running

- **Original request**: "what happens with the orchestrator retires the question while the worker is running?"
- **Source / who / when**: User, 2026-10-09.
- **Alignment with the goal**: Strong
- **Outcome**: KEPT as the current live-set behavior, plus the worker may still append a finding for that question.
- **Challenges**: Killing the worker, revoking the grant, or auto-closing the claim would hide an in-flight result. Refusing the finding would strand it.
- **Decision rationale**: The grant stays. The session claim stays until the worker closes it. The inject shows the claim is not live. A new claim of that question fails. The finding parent may still be that question id.

## Deleted / avoided scope

- A blacklist of record fields — a later field would pass.
- Ctx forcing finding ids into the worker's reply text — ctx never sees that reply.
- Close resolving the question, releasing a lock, or revoking the grant — the user defined close as local focus only.
- Stopping bash from writing `~/.pi/ctx` — the user kept the security claim narrow.

## Open questions

1. None before implementation.
