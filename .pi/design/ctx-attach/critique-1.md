# Critique 1 — agent2, 2026-10-09

Scope: `design.md` and `OPEN.md` as of this date. Sources were re-read today, not taken from the excerpts alone. One new evidence file: `evidence/agent2-extra-keys.md` (a read-only validator test; it does not run Pi).

## Verdicts on O1–O5

| Item | agent2 position |
|---|---|
| O1 | Take the alternative. Delete `replaces`. One grant per session, applied only on a fresh branch. |
| O2 | Keep the design: findings check the grant, not the claim. Reject the alternative. |
| O3 | Drop `role: "orchestrator"`. Worker means "this session wrote a ctx.bind with `grant_id`". Every other session bound through the existing bind flow is an orchestrator. The real hole is fork (D3), not legacy binds. |
| O4 | Drop the new pull tool. Add a findings list to the existing `ctx_zoom`/`ctx_get` lookup of a question id. |
| O5 | Solved by the O4 change. Lookup already resolves ids that are not live. |

### O1 — second grant

1. A fresh session already gives the human what they asked for. The rule is "workers request a project change from orchestrator rather than silently rebinding" (`.pi/foundations/first-questions.md` lines 84-91). A new grant applied in a new session is not a silent rebind. The other extension carries the request and starts the session (`design.md` lines 9-11).
2. `replaces` cannot be the only route to a second grant. A human in the worker pane can run `/ctx unbind` (`pi-ctx/src/commands/ctx.ts` line 81 → `runUnbind`, `pi-ctx/src/commands/bind.ts` lines 140-151). That appends `{ project_id: null }`. After that, `foldSession` says unbound (`pi-ctx/src/fold.ts` lines 62-68, 89). Step 4's "first apply refuses if already bound" then allows any new grant with no `replaces`. So the `replaces` check adds code without closing the path it is meant for.
3. Under a grant, "project change" can only mean a different question. The grant line goes into the orchestrator's project logs (`design.md` step 3). The orchestrator is bound to one project (`fold.ts` lines 62-68, the last `ctx.bind`). A move to a different ctx project would need an orchestrator bound to that project, and it would have to check a grant in another project's logs. The design does not cover that.
4. A worker that keeps its session also keeps the old question's work in context, its claim history, and its findings parented to the old id (`design.md` steps 5 and 8). A new session starts clean. That matches "its own conversation, observations, compactions and task claim" (`first-questions.md` lines 21-28).

Proposal: attach refuses if the branch has any `ctx.bind` this session wrote, including an unbind entry (see D3 for how to tell). That closes the `/ctx unbind` path in point 2. One grant per session, for that session's whole life. Delete `replaces` from steps 3 and 4.

Question for the human (H1): when you wrote "request a project change", did you mean a different ctx project or a different question in the same project? Either way, is a new worker session per change acceptable?

### O2 — close versus new findings

Keep grant-gated findings. The alternative strands results in exactly the case the human ruled on:

- The human said a retired question must not strand an in-flight result. "Refusing the finding would strand it" (`first-questions.md` lines 128-135).
- Under the alternative, a worker that closes and later learns something cannot re-claim a retired question. `applyClaim` returns `not_found` for an id that is not live (`pi-ctx/src/tools/claim.ts` lines 54-57). The finding would be refused for good.
- The freeze does not hold anyway. Step 7 allows a re-claim of the granted question while it is live, so close followed by claim undoes the freeze. That is extra cost and no guarantee.
- Close means "this session is no longer focused" and does not revoke the grant (`first-questions.md` lines 119-126). Tying findings to the claim makes close partly revoke the grant.

### O3 — who is an orchestrator

1. A role field adds nothing that the bind source does not already tell us. `CTX_BIND` is written in only two places: the confirmed bind (`pi-ctx/src/commands/bind.ts` line 117) and unbind (line 145). A grep of `appendEntry(` in `pi-ctx/src` finds no other writer. So any bound session without a `grant_id` was bound by a human through `runBindFlow`. The rule in `first-questions.md` line 19 is "Only a session the user bound may create an attachment". That is the same set.
2. Proposal: no `role` key. `isWorker = last ctx.bind on this branch has grant_id and was written by this session`. `isOrchestrator = bound && !isWorker`. That needs no migration and leaves no legacy-entry question. A worker cannot become an orchestrator by tool: there is no unbind tool, and `ctx_bind` refuses a bound session (`bind.ts` lines 101-103; `register.ts` lines 166-197 has no unbind tool). Only the human's `/ctx unbind` then `/ctx bind` can do it, and that is the human confirming a bind.
3. The real way to widen the set is fork, not legacy binds. See D3.

Question for the human (H2): may every session you bound to a project issue grants, or must exactly one session be named? agent2 recommends the first. Each of those sessions passed your confirm.

### O4 — pull shape

A new tool is more weight than the job needs. The existing lookup already does most of it:

- `ctx_zoom` and `ctx_get {id}` both call `lookupRecord` (`pi-ctx/src/tools/zoom.ts` line 14; `pi-ctx/src/tools/get.ts` lines 35-58). It resolves through `live.byId`, which holds every record, live or not (`fold.ts` lines 140-143). It falls back to `records`.
- Proposal: when the looked-up record is a `question`, add `findings: [{ id, session, headline, live }]` for records with `type === "finding"` and `parent === id`. Body stays one more `ctx_zoom` away. That keeps the "never paraphrase" body path (`register.ts` line 75).
- After compaction, the orchestrator still has the question id. It is in the grant line, in `ctx_frontier`, and in its own claim. It does not need the finding ids. That covers the compaction risk in `OPEN.md` lines 25-27 without a new tool.
- Any bound session can already write a finding with any `parent`. `putJudgment` does not check `parent` (`pi-ctx/src/mint.ts` line 137; `evidence/law-and-findings.md`). So the list also shows findings the orchestrator wrote. The `session` field tells them apart.

### O5 — retired question

The O4 change solves it. `lookupRecord` does not filter by `live` (`get.ts` line 42). A retired question id still resolves, and its findings list with it. Nothing new is needed.

## Defects not in OPEN.md

### D1 — a grant line shaped as in step 3 is dropped on read

`parseJsonl` drops any line without non-empty `id`, `type`, `ts`, and `session` (`pi-ctx/src/store/jsonl.ts` lines 35-36). Step 3 lists project id, question id, token hash, and `replaces`. It lists none of those four keys. The grant needs `{ id, type: "<non-judgment>", ts, session, question_id, token_hash }`. Two more facts follow:

- `parseJsonl` dedups by `id` across lines of one file (`jsonl.ts` lines 38-40). Use a UUID like `mint.ts` line 127.
- `loadProjectRecords` keeps only judgment types (`pi-ctx/src/store/project.ts` lines 68-75; `jsonl.ts` line 107). `runtime.projectRecords` never holds a grant. The grant lookup must call `unionLogDir(projectLogsDir(id))` itself.

### D2 — `ctx_record` has no `body` key, and the schema does not reject extra keys

- The `ctx_record` parameters have no `body` (`register.ts` lines 206-248). `execute` never passes one (`register.ts` lines 312-328), so a finding's body is its headline (`mint.ts` line 132). Step 5's allowlist names `body`, which today would be an unknown key.
- TypeBox `Type.Object` lets undeclared keys through Pi's validator to `execute` (`evidence/agent2-extra-keys.md`). The allowlist has to check the raw keys in code. The schema will not do it.
- Proposal: do not change `ctx_record` for workers. Register a separate `ctx_finding { headline, body }` tool. The server sets `type: "finding"` and sets `parent` from the grant, so the model never types a parent and cannot get it wrong. `ctx_record` refuses every call from a worker. One tool with two keys is a smaller allowlist than four keys checked inside a ten-type tool. It also matches the user's allowlist rule (`first-questions.md` lines 101-108): `type` and `parent` are fixed by the server. Any key besides `headline` and `body` is an error.
- If agent1 keeps step 5 on `ctx_record`, adding `body` to the schema changes the tool for every session, not only workers.

### D3 — fork copies bind, claim, and observations into a new session id

- `SessionManager.forkFrom` copies every non-header entry into a new file with a new id (`.../pi-coding-agent/dist/core/session-manager.js` lines 1374-1410). `createBranchedSession` does the same for one path (lines 1205-1248). `docs/session-format.md` line 72 names `/fork` and `/clone` as such sessions.
- If the other extension starts a worker by forking the orchestrator, the worker's branch has the orchestrator's `ctx.bind` and `ctx.claim`. `foldSession` takes the last of each with no session check (`fold.ts` lines 56-68). The worker then (a) is bound, so step 4 refuses the apply; (b) inherits the claim, against the goal sentence (`design.md` line 3); (c) counts as an orchestrator under step 2; and (d) carries the orchestrator's observations, against "its own … observations" (`first-questions.md` line 23; `fold.ts` lines 70-85).
- A forked worker also gets the same `grant_id` under a new session id. The new session writes to its own writer log (`pi-ctx/src/store/paths.ts` line 27-28).
- Proposal: every new `ctx.bind` (unbind included) and `ctx.claim` stores `session: <this session id>`. `foldSession` already receives `sessionId` (`fold.ts` line 47; `pi-ctx/src/hooks/session-start.ts` line 16). Grant power and worker identity require a bind written by this session. Attach requires no own-session bind on the branch. Inherited worker binds are void, so a forked worker is unattached until given its own grant.
- Legacy binds without `session` cannot be told apart from inherited ones. The cheapest rule treats them as own-session, which is today's behavior.

Question for the human (H3): does the orchestration extension start a worker as a fresh session or as a fork or clone of the orchestrator? If fresh-only is a contract, ctx can refuse attach on any branch that has a `ctx.bind` and skip the `session` stamp.

### D4 — the pending-replace hook can write a constraint from a worker session

`onPendingReplaceSettled` runs in any bound session with a UI (`pi-ctx/src/hooks/pending-replace-hook.ts` lines 70-99). After enough turns it opens HITL and can supersede into a constraint via `appendProjectRecord(…, opts.sessionId, …)` (`pi-ctx/src/promoter/hitl.ts` lines 47 and 130). It is not a tool, so step 5 does not cover it. The written line carries the worker's session id.

Proposal: the hook returns early when `isWorker`. The human adjudicates pending replaces in the orchestrator.

Question for the human (H4): should a worker pane ever show the pending-replace prompt? agent2 recommends no.

### D5 — `/ctx` commands bypass the worker tool rules

`/ctx claim <id>` calls `runClaim` with no role check and can close-and-claim any live question after a confirm (`pi-ctx/src/commands/claim.ts` lines 20-50). `/ctx unbind` and `/ctx bind` are covered in O1 and O3. These are human commands, so this may be fine. `design.md` should say whether the worker rules apply to tools only or also to `/ctx` commands. The goal sentence says "the tools enforce" (`design.md` line 3).

### D6 — an unbound worker cannot find the grant without the project id

Step 4 hashes the token and "finds the grant". Before attach the worker is unbound and has no project id (`fold.ts` lines 89-90). Grants live under each project's `logs/` (`paths.ts` lines 23-29). With the token alone, the worker must scan every project's logs. Proposal: the token string carries the project id (`<project_id>.<secret>`), or the attach tool takes `project_id` and `token`.

### D7 — the token is not secret from a shell

The orchestrator tool returns the token in a tool result. Pi stores tool results as plain `message` entries in the session file (`docs/session-format.md` line 92). Hashing the grant line hides it from the project log, not from the orchestrator's session JSONL. This matches the narrow claim (`first-questions.md` lines 93-100). `design.md` should call the token a routing check against a wrong or accidental attach, not a secret.

### D8 — reuse of one token

Nothing in steps 3–4 makes a grant single-use. Two sessions with one token become two workers on one `grant_id`. That fits "no lock" (`design.md` step 9; `first-questions.md` lines 39-46). `design.md` should still say it on purpose, because `grant_id` then does not name one worker.

## Smaller design, if O1–O4 go agent2's way

1. Orchestrator tool `ctx_grant { question_id }`: refuses a worker or an unbound session, and refuses a question that is missing or not live. It appends `{ id, type: "ctx.grant", ts, session, question_id, token_hash }` to its own writer log and returns `token = <project_id>.<secret>`.
2. Worker tool `ctx_attach { token }`: refuses if the branch has an own-session `ctx.bind`. It finds the grant by hash in that project's logs. It appends `ctx.bind { project_id, grant_id, question_id, session }` and `ctx.claim { claimed_question_id, session }`. It does not harvest.
3. Worker tool `ctx_finding { headline, body }`: `parent` and `type` come from the grant. Any other key is an error. Returns the id.
4. `ctx_record`, `ctx_bind`, and the pending-replace hook refuse or skip when `isWorker`. `ctx_claim` for a worker allows status, close, and claim of `grant.question_id` only.
5. `lookupRecord` on a question adds the `findings` list.

There is no role key and no `replaces`. The design adds no pull tool.

## Questions for the human (summary)

- H1 (O1): "project change" means a different ctx project or a different question? Is a new worker session per change acceptable?
- H2 (O3): may every session you bound issue grants, or exactly one?
- H3 (D3): does the orchestration extension start workers fresh or by fork/clone?
- H4 (D4): should a worker pane ever get the pending-replace prompt?

None of these block agent1's revision. agent2's defaults are: H1 new session, H2 every bound session, H3 handle forks with the `session` stamp, and H4 no.
