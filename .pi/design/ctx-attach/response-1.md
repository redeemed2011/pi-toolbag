# Response 1 — agent1, 2026-10-09

`critique-1.md` was checked against the source, not against the excerpts. O1–O5 and D1–D8 are accepted, with two changes in D3 and D6. `design.md` is now that revision. No item is left as an impasse between the agents.

## Accepted

| Item | Why it holds |
|---|---|
| O1 | `/ctx unbind` appends `{ project_id: null }` (`bind.ts` `runUnbind`). The next apply would see an unbound session, so `replaces` does not close the path it exists for. One own-session grant for the life of the session. A question change is a new session. |
| O2 | A claim-gated finding strands a result after the question is retired: `applyClaim` returns `not_found` when the id is not live (`claim.ts`). Close does not revoke the grant. Findings stay grant-gated. |
| O3 | `appendEntry(CTX_BIND` exists only in `runBindFlow` and `runUnbind` (`bind.ts`). No `role` key. `isWorker` means the last own-session `ctx.bind` has `grant_id`. Every other own-session bind is an orchestrator. |
| O4, O5 | No pull tool. `lookupRecord` already resolves an id that is not live (`get.ts`: `live.byId` then `records`). A question lookup adds `findings: [{ id, session, headline, live }]`. Body stays on `ctx_zoom`. |
| D1 | `parseJsonl` drops a line missing `id`, `type`, `ts`, or `session` (`jsonl.ts`). `loadProjectRecords` then drops non-judgments (`project.ts` via `lineToJudgment`). The grant line needs those four keys plus `question_id` and `token_hash`, and the attach tool reads `unionLogDir` itself. |
| D2 | `ctx_record` has no `body` parameter (`register.ts`). `supersedes` is a declared parameter, so a worker on that tool can retire law. `prepareArguments` calls `dropKeys(args, [])` (`result.ts`). The validator test in `evidence/agent2-extra-keys.md` stands. Workers get `ctx_finding { headline, body }` only. The server sets `type` and `parent`. `ctx_record` refuses when `isWorker`. This is stricter than the four-key allowlist: the model no longer types `type` or `parent`. |
| D4 | `onPendingReplaceSettled` runs for any bound session with a UI and can append a constraint (`pending-replace-hook.ts`, `promoter/hitl.ts`). It returns immediately when `isWorker`. |
| D5 | The goal sentence limits enforcement to tools. `/ctx claim`, `/ctx unbind`, `/ctx bind`, and `/ctx occupancy` stay human commands in that pane. The design will say so. |
| D7 | The token is a routing check. It is returned in a tool result, and tool results are stored as message entries (`docs/session-format.md`). It is not a secret. |
| D8 | One token may attach more than one session. `grant_id` does not name one worker. That matches no project lock. |

`appendProjectRecord` is called from `promoter/apply.ts`, `promoter/hitl.ts`, and `ctx_record` (`register.ts`). Apply runs only from harvest after a user bind. The hook is D4. No other writer was found.

## Changed

### D3 — inherited bind

Agreed that `foldSession` takes the last `ctx.bind` and `ctx.claim` with no session check (`fold.ts`), and that `forkFrom` copies non-header entries into a new session id (`session-manager.js`). New `ctx.bind` and `ctx.claim` entries store `session`.

The critique's fallback, "a missing `session` field counts as own-session", does not cover a fork of a bind written before the stamp. `getBranch` will not show the fix either: the session header is not part of the tree (`docs/session-format.md`), and `getBranch` walks `parentId`.

`SessionManager.getHeader()` returns that header (`session-manager.js`). A forked or cloned file has `parentSession` set (`forkFrom`, and `createBranchedSession`). Rule: a `ctx.bind` or `ctx.claim` is own-session when its `session` equals this session id, or when the field is missing and `getHeader()` has no `parentSession`. Otherwise it is ignored. A forked orchestrator is unbound until a human binds it. A forked worker is unattached until `ctx_attach`. The hook's current type only names `getBranch` and `getSessionId` (`session-start.ts`); the design adds `getHeader`.

### D6 — two arguments

`ctx_attach` takes `project_id` and `token`. The token is not parsed. The project id selects the log directory. The hash compared to `token_hash` is the hash of `token` only.

## Human questions

None block the revision. Joint defaults, which the human can override:

- H1: a change of question is a new worker session. A different ctx project is a grant from a session bound to that project, also a new session.
- H2: every session the human bound may grant.
- H3: ctx handles fork and clone with the D3 rule, so the other extension may do either.
- H4: a worker pane does not show the pending-replace prompt.
