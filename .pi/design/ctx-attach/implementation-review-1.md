# Implementation review 1 — agent2, 2026-10-09

Scope: the uncommitted `pi-ctx` diff in `/home/bo/src/pi-toolbag`, checked against `design.md`, `implementation-plan.md`, and `implementation-note.md`. agent2 read the source and did not edit `pi-ctx`.

## Runs

From `pi-ctx`:

- `node ../node_modules/vitest/vitest.mjs run`: 33 files and 214 tests, all passed.
- `node ../node_modules/typescript/bin/tsc --noEmit --pretty false` exits 2 with the same two errors the note gives. Both errors are already in `HEAD`. I extracted `HEAD`'s `pi-ctx` with `git archive` and ran `tsc` on it. It fails on `context-hook.ts(41,3)` and `promoter.test.ts(757,39)`. In this diff the promoter error is at line 759 only because the fixture above it gained two fields (`grantId`, `grantQuestionId`). This diff does not cause either error.

No test runs Pi.

## Plan sections against source

1. **Grant and hash.** `grant.ts` has one `hashGrantToken` helper, and `tools/grant.ts` and `findGrantByToken` both use it. The grant line has `id`, `type: "ctx.grant"`, `ts`, `session`, `question_id`, and `token_hash`, and never the token. `executeGrant` refuses when ctx is off, when the session is unbound or a worker, when `question_id` is missing, and when the question is missing or not live. It does not run the claim check or read focus. The test grants a question too large for the claim slot while another question is focused, and checks that focus is unchanged and the log holds the hash, not the token. It also checks that `loadProjectRecords` and `lineToJudgment` skip the grant line.
2. **Fold, refusals, and attach.**
   - `foldSession` exposes `grantId` and `grantQuestionId` from the last bind. A legacy bind, a worker bind, and an unbind fold as the plan says, and the test covers all three.
   - `ctx_grant`, `ctx_record`, and `ctx_bind` refuse a worker before any HITL prompt. The test checks there are no confirms and the log does not change.
   - The claim limit is in the `ctx_claim` tool's `execute` and not in `applyClaim`. `/ctx claim` through `runClaimFlow` is not limited, and the test checks that.
   - `executeAttach` checks every `ctx.bind` on the branch with `branchHasBind`. It checks `PROJECT_ID_RE` and that the project file's id matches, and it creates no project. It reads the grant directly from the log, then runs `applyClaim` with `bound: true` and this session's occupancy. It writes nothing unless the claim check returns `ok`. On `ok` it appends the bind (project, grant, and question ids) and the focus, sets `runtime.bound`, `projectId`, and `claimedId`, calls `reloadProject`, and publishes the bound status. It does not harvest.
   - The success test is a real round trip. Right after attach, before any other tool call, it runs the context hook and the pending-replace gate. A second fresh session reuses the token. The failure tests cover a bad id, a missing project, a mismatched project file id, a bad token, an unbound session, a blocked question, a question too large for the slot, and a retired question. Each leaves the branch unchanged.
3. **Finding.**
   - `prepareArguments` receives the raw arguments before Pi's validator runs (`pi-agent-core/dist/agent-loop.js` lines 378-402). It refuses any extra key, including a model-supplied `__refuse`. The refusal marker then passes the validator, because the schema does not forbid extra keys, so `execute` returns the error instead of throwing.
   - `executeFinding` refuses a session that is not a worker. It sets the type to `finding`, the parent to the granted question, and the session itself. It then appends the record and reloads, the same way `ctx_record` does.
   - The tests file a finding after focus is dropped and after the question is retired.
4. **Question lookup.** `lookupRecord` on a question lists its findings with `id`, `session`, `headline`, and `live`, and no body. Nothing injects them.
5. **Unbound close-and-claim.** `runClaimFlow` returns "ctx is off" or "no project bound" before it asks for any confirm. The test checks there are zero confirms and the claim is unchanged.
6. **Guidelines.** `GRANT_GUIDELINE`, `ATTACH_GUIDELINE`, and `FINDING_GUIDELINE` were added, and the existing text is unchanged.

`design.md` line 23 says a worker cannot focus a question again after you retire it. No new test covers that, but `applyClaim` already returns `not_found` for a question that is not live, and the attach test with a retired question exercises the same check.

## Result

No defects. agent2 has no objection to committing this diff.
