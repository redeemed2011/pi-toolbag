# First Principles

**Session date**: 2026-10-09
**Scope**: An orchestrator you already bound can attach a worker to that same project with its own session and one assigned question, and the tools enforce that the worker cannot change shared law, inherit your claim, or rebind.

## Bedrock facts

### Fact 1 — User bind is the only attended attach, and it harvests

**Statement**: `ctx_bind` and `/ctx bind` call `runBindFlow`. A session that is already bound is refused. A session with no UI is refused with "bind requires HITL". After the user confirms, the session stores `ctx.bind` as `{ project_id, project_name }` and `harvestAfterBind` may mint constraints and other project records from that chat.
**Why it is load-bearing**: A silent flag on this function would attach a worker by running the harvest. That writes shared law without the orchestrator adjudicating it.
**Source / evidence**: `pi-ctx/src/commands/bind.ts` (`already bound`, `bind requires HITL`, confirm text, `harvestAfterBind`), read 2026-10-09. `pi-ctx/src/tools/register.ts` tool `ctx_bind`.
**Status**: Verified

### Fact 2 — Bind, claim, and observations are entries on one session branch

**Statement**: `foldSession` reads the last `ctx.bind`, the last `ctx.claim`, and every `ctx.observations.recorded` entry on the branch it is given. Claim and bind are not fields of `project.json`. Observations are not project records.
**Why it is load-bearing**: A second session does not inherit the orchestrator's claim or observations. The worker's attachment survives only if it is stored on the worker's own branch.
**Source / evidence**: `pi-ctx/src/fold.ts` `foldSession`, read 2026-10-09. `pi-ctx/src/store/project.ts` `ProjectMeta` is `{ id, name, created_at }`.
**Status**: Verified

### Fact 3 — The branch walk keeps entries compaction summarized away

**Statement**: Pi `getBranch` walks parent links from the leaf to the root and returns every entry type on that path. Compaction does not delete earlier entries. `buildContextEntries` omits entries before `firstKeptEntryId` from model context, but `getBranch` still returns them. `session_start` restores ctx by folding `getBranch()`.
**Why it is load-bearing**: A `ctx.bind` and `ctx.claim` written on the worker session are still there after compaction and after resume. A second attachment store is not required for survival.
**Source / evidence**: `@earendil-works/pi-coding-agent` `dist/core/session-manager.js` `getBranch` comment and implementation, read 2026-10-09. `docs/session-format.md` "Context Building", same day. `pi-ctx/src/hooks/session-start.ts` calls `restoreFromBranch(getBranch())`.
**Status**: Verified

### Fact 4 — One session cannot append another session's entry

**Statement**: Bind and claim call `appendEntry` on the Pi session that is running the tool. The project log is the only store every bound session reads. It is one file per writer session, `logs/<sessionId>.jsonl`, folded as a union.
**Why it is load-bearing**: The orchestrator cannot write the worker's `ctx.bind` or `ctx.claim`. It can write a grant into the project log. The worker session has to apply that grant to itself.
**Source / evidence**: `pi-ctx/src/commands/bind.ts` and `src/commands/claim.ts` take `appendEntry`. `pi-ctx/src/store/paths.ts` `writerLogPath`. `pi-ctx/src/store/project.ts` `loadProjectRecords` unions the log directory.
**Status**: Verified

### Fact 5 — Any bound session can mint law, and any record can retire law

**Statement**: `ctx_record` checks that the session is bound, then `putJudgment`. Only a constraint is refused for `live_conflict` or `gate`. `decision`, `destination`, `out_of_scope`, `question`, `tombstone`, `finding`, `fog`, `citation`, and `evidence` are written with no prompt. `foldLive` retires a live id when any later record lists it in `supersedes`, whatever the new record's type. Destination text and out-of-scope headlines are injected. Constraint directives are injected. Findings are not in that inject.
**Why it is load-bearing**: Attaching a worker with today's record tool lets it change shared law. Refusing law types is not enough if a finding may still supersede. Findings are the existing record the orchestrator can read without them becoming instructions.
**Source / evidence**: `pi-ctx/src/mint.ts` `putJudgment` (constraint-only `live_conflict` and `gate`). `pi-ctx/src/fold.ts` `foldLive` supersede loop and `bodySetGE`. `pi-ctx/src/render/gated-edge.ts` injects constraints, destination, and out-of-scope headlines, and only the fog count. `pi-ctx/src/tools/register.ts` `ctx_record` type enum, including `evidence`.
**Status**: Verified

### Fact 6 — A claim is this session's pointer, not a lock

**Statement**: `applyClaim` checks that the id is a live question on this session. `frontierItems` hides only the claimed id of the session it is given. No project record lists which session owns a question.
**Why it is load-bearing**: Assigning question A to worker A does not block worker B or the orchestrator. Ownership has to be the worker's own `ctx.claim`, or it does not exist. A new mutex would contradict the user.
**Source / evidence**: `pi-ctx/src/tools/claim.ts` `applyClaim`. `pi-ctx/src/fold.ts` `frontierItems`. User, 2026-10-09: attachment is not a cross-agent task lock.
**Status**: Verified

### Fact 7 — The project log is readable by every attached session

**Statement**: `ctx_get` and `ctx_zoom` return stored record bodies for the bound project. A secret written into a project record can be read by another session bound to that project.
**Why it is load-bearing**: An attach token stored in the clear can be copied by any reader. The grant can store only a hash.
**Source / evidence**: `pi-ctx/src/tools/get.ts` `lookupRecord` returns `body`. `pi-ctx/src/store/jsonl.ts` `lineToJudgment` keeps the body.
**Status**: Verified

### Fact 8 — Lines that are not judgment types are stored and ignored by the fold

**Statement**: `lineToJudgment` returns nothing when `type` is not a judgment type. Those lines remain in the writer file. They are not injected and they do not supersede.
**Why it is load-bearing**: The grant has to live in the shared log without becoming law. A new judgment type is not required.
**Source / evidence**: `pi-ctx/src/store/jsonl.ts` `lineToJudgment`. `pi-ctx/src/types.ts` `isJudgmentType` and `RecordKind`.
**Status**: Verified

### Fact 9 — Tool refusal is the control the model actually hits

**Statement**: The user required enforcement because a model will ignore guidance. `ctx_bind` already enforces the user step by returning an error when there is no UI. Prompt guidelines do not stop a tool call.
**Why it is load-bearing**: The worker and orchestrator checks have to be return values from the tools. A prompt sentence does not meet the goal.
**Source / evidence**: User, 2026-10-09. `pi-ctx/src/commands/bind.ts` returns `{ ok: false, error: "bind requires HITL" }`.
**Status**: Verified

## Accepted limit

A worker process that can write `~/.pi/ctx` can append `logs/<sessionId>.jsonl` or edit its session file without calling a ctx tool. The tool errors do not prevent that. This goal does not try to. Source: user, 2026-10-09.
## Reconstructed minimal solution

### Core approach

The user bind stays the only way a session becomes an orchestrator, and it still harvests only there. That session writes an attach grant into the project log. The worker, in its own session, applies the grant once. The apply writes `ctx.bind` and `ctx.claim` on the worker branch and does not harvest. Later compaction and resume fold that same branch. The worker record tool accepts four fields and returns the new finding id. A pull lists findings for the granted question. Tool errors stop the ctx tools only.

### Justified components

1. **Orchestrator marker on the existing user bind.** `runBindFlow` adds `role: "orchestrator"` to the `ctx.bind` entry it already writes. Fact 1: only that attended path may create an attach. Existing sessions bound before this field are orchestrators, because that path was the only way to bind.
2. **Grant line, not a judgment.** The orchestrator tool appends one JSONL line with a new non-judgment type, the project id it is already bound to, the question id the caller passed, and a hash of a token. It refuses if this session's role is not orchestrator. It refuses if the question is missing or is not a live question. It never reads `claimedId`. Facts 4, 5, 6, 7, and 8.
3. **Worker apply, once.** The worker tool takes the token, hashes it, and finds a matching grant. It appends `ctx.bind` `{ project_id, role: "worker", grant_id }` and `ctx.claim` for that question on its own session. It does not call `harvestAfterBind`. It refuses if the session is already bound. Facts 2, 3, and 4.
4. **Worker record allowlist.** If role is worker, the raw arguments may contain only `type`, `headline`, `body`, and `parent`. `type` must be `finding`. `headline` and `body` are required. `parent` is required and must equal the question id on this session's grant, whether or not that question is still live. Any other key is an error, not a dropped field. The server sets `id`, `ts`, and `session`. The tool result includes the new id. Facts 5 and 9, and the allowlist decision.
5. **Finding pull.** A read returns live findings whose `parent` is a question id, each as id and headline. It does not inject them. Facts 2 and 5: a finding is otherwise invisible to the orchestrator and to another worker. The orchestrator treats a worker reply that omits those ids as incomplete. Ctx does not see that reply, so it cannot enforce the sentence.
6. **Worker claim gate.** If role is worker, claim allows `status`, `claim` of the granted question while that question is live, and `close`. Close appends `ctx.claim` null on this session only. It does not tombstone the question, revoke the grant, or write another session. `ctx_bind` and unbind refuse. Facts 2 and 6.
7. **Retired question.** No new write. The grant line is not a judgment, so retiring the question does not remove it. The session claim stays until the worker closes it. The existing inject reports `claim_not_live`. A later claim of that id returns `not_found`. The finding allowlist still accepts that parent. Fact 6, and `claimedBodyOrEmpty` in `pi-ctx/src/render/gated-edge.ts`.
8. **No lock.** `frontierItems` and `applyClaim` stay single-session. Two grants may name one question. Fact 6.

### Explicitly rejected approaches

- A silent flag on `runBindFlow` — Fact 1: it harvests shared law from the worker chat.
- Prompt text telling the worker not to mint — Fact 9: the model can call the tool.
- Treating observations as the return channel — Fact 2: the orchestrator cannot read them.
- A blacklist of record fields, or an allowlist that ignores unknown keys — a later field would be stored.
- The orchestrator writing the worker's session file — Fact 4: `appendEntry` does not reach another session, and a direct file write races the worker.
- A project-level claim mutex — Fact 6, and the user barred a cross-agent lock.
- Copying the orchestrator's `claimedId` when the question argument is omitted — the user barred inheriting the active claim.
- A new store for attachment — Fact 3: the session branch already survives compaction and resume.
- Ctx parsing the worker's reply to require finding ids — ctx does not see that reply.
- Close tombstoning the question or deleting the grant — the user defined close as this session dropping focus.
- Auto-closing or revoking the grant when the question is retired — that would strand the in-flight finding.
- A sandbox that stops bash from writing `~/.pi/ctx` — the user kept the security claim narrow. Tool errors are not that boundary.

## Open questions on foundations

1. None. The pull is a read of the existing log. The tool name is an implementation choice.
