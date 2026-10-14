# Plan review 1 — agent2, 2026-10-09

Scope: `implementation-plan.md` checked against `design.md` and the pi-ctx source. The plan does not change the design. No step contradicts a settled decision: fork, grant by any bound session, a new session per question, and the bind and pending-replace rules all match. The defects below are missing work and order. P1 and P2 would leave bugs that unit tests of pure functions do not catch.

## P1 — attach must update the runtime and the bound status, as bind does (missing work)

Step 3 says attach "writes this session's bind … and its focus". Writing the entries is not enough. `runBindFlow` also sets `runtime.bound`, `runtime.projectId`, calls `runtime.reloadProject()`, and publishes the bound status (`pi-ctx/src/commands/bind.ts` lines 117-120, 137). Attach is a tool, so the next tool call re-syncs from the branch (`pi-ctx/src/tools/register.ts` lines 27-31). The hooks do not re-sync:

- The context hook folds `bound` from the branch but takes the law from `runtime.projectRecords` (`pi-ctx/src/hooks/context-hook.ts` lines 15, 29-33). Until some ctx tool runs, a freshly attached worker gets a status line and inject that show no law.
- Pending-replace returns while `runtime.bound` is false (`pi-ctx/src/hooks/pending-replace-hook.ts` line 71). That breaks the decision that it runs in a worker session.
- The footer bound status stays "unbound" (`pi-ctx/src/render/bound-status.ts`).

Add to step 3: on `ok`, set `runtime.bound`, `projectId`, and `claimedId`, call `reloadProject()`, and call `publishBoundStatus` with the project name from `readProjectMeta`. Add a test that runs the context hook and the pending-replace gate right after attach, with no other tool call in between.

## P2 — worker refusals land after attach (order would hide a bug)

Step 3 adds `ctx_attach`. The worker refusals on `ctx_record` and `ctx_bind`, and the limit on `ctx_claim`, come later in step 4. Between those steps, an attached worker is just a bound session. `ctx_record` refuses only when unbound (`pi-ctx/src/tools/record.ts` lines 13-14), so the worker can write law. Every attach test written at step 3 passes with that hole open.

Proposal: land step 1, the worker refusals, and `ctx_attach` in one change, with the test "attached worker calls `ctx_record` and is refused" in that same change. Write each layer's tests with its step, not in a final pass.

## P3 — where the worker claim limit goes (missing detail that would break a decision)

Step 4 limits `ctx_claim` for a worker. `applyClaim` is shared by three callers: the tool (`register.ts` lines 147-157), `/ctx claim` through `runClaimFlow` (`pi-ctx/src/commands/claim.ts` line 36), and attach in step 3. `design.md` line 30 says `/ctx claim` in a worker pane is the human and is not limited. So the limit belongs in the `ctx_claim` tool's `execute`, not in `applyClaim`. If it goes in `applyClaim`, the slash command is limited too. Say so in step 4.

## P4 — the fold must expose the granted question, and keep old binds as orchestrators

Step 1 reads only `grant_id`. Today `foldSession` reads only `project_id` from `ctx.bind` (`pi-ctx/src/fold.ts` lines 62-68), and `SessionFold` has no grant fields. Two later steps need the question id from that same bind: the finding parent (step 4) and the claim limit (P3). Have step 1 expose `grant_id` and `question_id` from the last bind. The alternative is to re-read the grant line from the log on every call, and the plan should pick one.

Step 1 tests should also cover: a legacy bind with no `grant_id` stays an orchestrator, and `{ project_id: null }` after a worker bind is neither. Attach (step 3) must scan every `ctx.bind` on the branch, not the fold's last one, because the fold collapses an unbind to "not bound".

## P5 — `ctx_finding` must refuse a session that is not a worker (missing)

Revision 4 said `ctx_finding` "refuses unless `isWorker`". The readable design keeps that meaning: `design.md` line 19 says the worker files a finding, and line 72 says the server sets the parent question. The plan does not say it. An orchestrator has no grant to take the parent from. Add the refusal to step 4.

The write path can reuse `putJudgment` then `appendProjectRecord` and `reloadProject`, as `ctx_record` does (`register.ts` lines 339-342). `putJudgment` does not require `parent` to be live (`pi-ctx/src/mint.ts` lines 60-173), so a finding on a retired question still succeeds, as the design requires.

## P6 — tool guidelines (missing work, small)

The current guidelines point the model at tools a worker cannot use. `BIND_GUIDELINE` says "Mint law with ctx_record". `CLAIM_GUIDELINE` says to claim whatever `ctx_frontier` shows (`pi-ctx/src/tools/guidelines.ts` lines 11-15). A worker following them gets refusals. Add guideline text for `ctx_grant`, `ctx_attach`, and `ctx_finding`. For example: a worker files results with `ctx_finding` and claims only its granted question.

## P7 — wording

Plan line 3: "Nothing else starts workers or reads their replies." `design.md` line 11 says another extension starts the worker and reads its result. Suggest: "Ctx does not start workers or read their replies."
