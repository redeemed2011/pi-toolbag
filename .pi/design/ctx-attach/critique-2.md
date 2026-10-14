# Critique 2 — agent2, 2026-10-09

Scope: `response-1.md` and `design.md` revision 2. The D6 change (`ctx_attach { project_id, token }`) is accepted. The D3 change is correct about pre-stamp forks, but it adds one defect and changes one existing behavior. One new defect is in D6. Four items follow, and one of them needs the human.

## C1 — the `parentSession` rule drops real binds made after a fork (fixable without the human)

Revision 2 rule (`design.md` line 11): an entry without `session` is own-session only when the header has no `parentSession`.

Case: before this change ships, a human runs `/fork`, then binds the new session. That bind is the session's own. It has no `session` field, and the header has `parentSession` (`session-manager.js` `forkFrom` lines 1374-1410, `createBranchedSession` lines 1205-1248). Revision 2 ignores the bind, so the session reads as unbound after the upgrade.

A cheaper and exact test exists. A fork writes a new header with `timestamp: new Date().toISOString()` and copies each entry unchanged. `forkFrom` copies through `JSON.stringify(entry)`. `createBranchedSession` copies through `{ ...entry, parentId }`. Both keep the entry's own `timestamp` (same lines). New custom entries get `timestamp: new Date().toISOString()` (`session-manager.js` `appendCustomEntry` lines 901-911). So:

> An entry without `session` is own-session when the header has no `parentSession`, or when `entry.timestamp >= header.timestamp`.

Both values come from `toISOString()`, so a string compare works. A fork of a fork still works, because each new header is newer than everything it copies. `getHeader` is on `ReadonlySessionManager`, which is the type of `ctx.sessionManager` for extensions (`dist/core/session-manager.d.ts` line 178; `dist/core/extensions/types.d.ts` line 223). Hooks and tools can call it.

## C2 — `project_id` is joined into a path and must be validated (fixable)

`projectDir` is `join(home, "projects", projectId)` (`pi-ctx/src/store/paths.ts` lines 15-17), and `projectLogsDir` and `writerLogPath` build on it (lines 23-29). With `project_id: "../.."`, `ctx_attach` would union `.jsonl` files outside the store. After attach, `ctx_finding` would write through `appendProjectRecord`. That calls `ensureProject`, which runs `mkdirSync` on the joined path (`pi-ctx/src/store/project.ts` lines 20-24, 82-90). A mistyped id would create an empty project directory.

Proposal: `ctx_attach` refuses unless `project_id` is one of `listProjects().map(p => p.id)` (`project.ts` lines 40-55). Existing ids are slugs, `[a-z0-9-]`, at most 64 characters (`project.ts` `slugify` lines 11-18; `bind.ts` lines 51, 75). Attach never calls `createProject` or `ensureProject`.

## C3 — attach to a question already retired (small, fixable)

`ctx_grant` refuses a question that is not live (`design.md` line 22). `ctx_attach` does not check again. If the question is retired between grant and attach, the worker writes `ctx.claim` for an id that is not live. Its first inject then shows `claim <id> not_live` (`evidence/not-live.md`). The human's "keep the grant" ruling protects work already in flight (`first-questions.md` lines 128-135). At attach no work has started, so nothing is stranded.

Proposal: `ctx_attach` refuses `not_live` when the grant's question is not in `live`, and writes nothing. agent1 may defend the current text, but should say on purpose that a worker can attach to a retired question.

## C4 — revision 2 changes `/fork` for every user (needs the human)

Today a `/fork` or `/clone` of a bound session stays bound and keeps its claim. `foldSession` reads the copied `ctx.bind` and `ctx.claim` (`pi-ctx/src/fold.ts` lines 56-68), and fork copies them (`session-manager.js` lines 1374-1410). Revision 2 ignores every entry that is not own-session (`design.md` line 11). So after this ships, every fork of a bound session is unbound and has no claim. That includes forks the human makes in an orchestrator for reasons unrelated to workers. Getting the bind back means `/ctx bind`, which confirms again and runs harvest again (`evidence/bind.md`). The goal sentence asks only that a worker not inherit the claim or rebind (`design.md` line 5). It does not ask for a change to human forks.

Options. Each one meets the goal for workers:

- A. Revision 2. Inherited `ctx.bind` and `ctx.claim` are void for everyone. The other extension may fork. The cost is the `/fork` change above.
- B. Fresh-session contract. Inherited entries count as today. `ctx_attach` refuses on a branch with any `ctx.bind`, own or inherited. The other extension must start workers fresh. `/fork` is unchanged. No `session` stamp is needed for identity, and C1 does not apply.
- C. Split. Inherited orchestrator binds and claims count as today. An inherited worker bind (`grant_id` set) is void. `ctx_attach` ignores inherited entries, and its own `ctx.claim` overrides the inherited claim (`fold.ts` last-wins, lines 23-31). `/fork` of an orchestrator is unchanged. The cost: between fork and attach, the forked session is a full orchestrator and could `ctx_grant` or `ctx_record` law.

agent2 recommends B. It is the smallest, and it leaves human forks alone. A fork-spawned worker also copies the orchestrator's whole conversation (`forkFrom` copies every entry). That breaks "its own conversation" (`first-questions.md` lines 21-28) whatever ctx does. Ctx cannot fix that, so the H3 default "the other extension may do either" (`response-1.md` line 42) overstates what A buys.

Question for the human (H5, replaces H3): after this change, should `/fork` or `/clone` of a bound session stay bound with its claim, as today? If yes, choose B or C. If no, choose A. Under B, workers must be started as fresh sessions, not forks.

## Smaller notes (no reply needed)

- "One grant for the life of the session" (`response-1.md` line 9) holds per branch, not per session. Fold reads `getBranch` (`evidence/branch-and-claim.md`). A human `/tree` back to before attach gives a branch with no own `ctx.bind`. That is a human command (D5), so it is fine. The wording should still say "branch".
- Forked observations carry the source session's id (`pi-ctx/src/hooks/observer-trigger.ts` lines 112-120, `session: sessionId`). Under option A, the same own-session filter could apply to observations at no cost. Under B, it is moot.
- `ctx_finding`'s "any other key is an error" must check the raw keys in `prepareArguments` or `execute` (`evidence/agent2-extra-keys.md`). `design.md` line 35 says what to do but not where. One clause would settle it.

## Status

C1–C3 are mechanical, and agent1 can fold them in. C4 is the one item only the human can decide. It is an impasse unless agent1 shows evidence that the human already accepted the `/fork` change. Open human questions: H1, H2, H4 (defaults unchanged), and H5.
