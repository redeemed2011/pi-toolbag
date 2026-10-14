# Critique 5 — agent2, 2026-10-09

Scope: the readable `design.md` and `OPEN.md`, checked against revision 4 (`response-3.md`, `critique-4.md`) and the four human decisions. The older critique files are used only to name what revision 4 contained.

The four decisions are stated correctly and consistently in `design.md` (lines 13, 22, 25, 31, 58-66) and `OPEN.md` (lines 5-8). The pending-replace statements match the source. The hook already returns when unbound (`pi-ctx/src/hooks/pending-replace-hook.ts` line 71), it fires after `PENDING_HITL_TURNS = 3` (`pi-ctx/src/promoter/schema.ts` line 4), and accepting can append a constraint (`pi-ctx/src/promoter/hitl.ts` lines 47, 130).

Three defects follow. E1 needs the human. E2 and E3 are text that agent1 can fix.

## E1 — the `ctx_bind` tool is not "the bind command you invoked" (needs the human)

The decision: no user-facing question unless bound, "the bind command you invoked" excepted (`design.md` line 66, `OPEN.md` line 8). There are two entry points to the same prompts. `/ctx bind` is typed by the human (`pi-ctx/src/commands/ctx.ts` lines 66-78). The `ctx_bind` tool is called by the model (`pi-ctx/src/tools/register.ts` lines 166-197). Both call `runBindFlow`, which opens `select`, `input`, and `confirm` in an unbound session (`pi-ctx/src/commands/bind.ts` lines 61, 68, 78, 109). The tool guideline tells the model to call it when the user asked "or you propose one" (`pi-ctx/src/tools/guidelines.ts` line 15). So the model can open the bind prompt on its own initiative.

Read literally, the decision forbids that. `ctx_bind` would then have to refuse in every case, because an unbound session is the only one it can bind (`bind.ts` lines 101-103). `design.md` line 22 says "the bind command is the exception", which reads as covering both.

Question for the human (H6): does the exception cover the model's `ctx_bind` tool as well as `/ctx bind`?
- Yes: the model may still open the bind prompt. Change `design.md` line 66 and `OPEN.md` line 8 to "a bind the human typed or a `ctx_bind` call the human then confirms".
- No: `ctx_bind` refuses and tells the model to ask the human to type `/ctx bind`. That changes the tool and its guideline for every user.

The other prompt sites already follow the rule or are listed as changes. `executeRecord` refuses unbound before any `select` (`pi-ctx/src/tools/record.ts` line 14; `pi-ctx/src/commands/record.ts` lines 97-103). The occupancy confirm needs gate=1, and an unbound session has no records (`pi-ctx/src/runtime.ts` lines 47-51; `pi-ctx/src/commands/occupancy.ts` lines 48-62). The close-and-claim confirm does fire unbound today. `runUnbind` leaves the claim in place (`bind.ts` lines 140-151), and `runClaimFlow` confirms before `applyClaim` checks `bound` (`pi-ctx/src/commands/claim.ts` lines 20-36). `design.md` line 22 lists that as a change, which is correct.

## E2 — checks from revision 4 that the readable file dropped (agent1 can fix)

`design.md` is now the only design (agent1's instruction). Revision 4 had these checks, and the readable file no longer states them. An implementer reading only `design.md` would miss them:

1. `project_id` validation. Attach refuses unless the id matches `^[a-z0-9-]{1,64}$` and `readProjectMeta(id)?.id === id`. It never calls `createProject` or `ensureProject`. Without this, the id is joined into a path and can leave the store (`pi-ctx/src/store/paths.ts` lines 15-29). A later finding would also `mkdirSync` it (`pi-ctx/src/store/project.ts` lines 20-24, 82-90). This was C2 in `critique-2.md`, accepted in `response-2.md`.
2. The grant line shape. It needs `id`, `type`, `ts`, and `session`, or `parseJsonl` drops it (`pi-ctx/src/store/jsonl.ts` lines 35-36). It must be read with `unionLogDir`, because `loadProjectRecords` keeps only judgments (`project.ts` lines 68-75). `design.md` line 36 says only "a line the law fold ignores".
3. Where the finding allowlist is checked. Extra keys pass Pi's validator (`evidence/agent2-extra-keys.md`), so the check must be on the raw keys in `prepareArguments` or `execute`. Line 19, "Any other field is refused", keeps the meaning but not this constraint.

Proposal: add a short "Implementation checks" section at the end of `design.md` that keeps these three, so the readable part above it stays as it is.

## E3 — two wording slips (agent1 can fix)

- Line 18: "If the question is gone, blocked, or too large". Revision 4 refuses any question that is not live (`response-3.md` line 7; `pi-ctx/src/tools/claim.ts` lines 54-57). A retired question is still in the log, so "gone" can be read as "missing" only. Suggest "not live (missing or retired)".
- Line 36: "the project file stores only the project's name". `project.json` holds `{ id, name, created_at }` (`pi-ctx/src/store/project.ts` lines 9, 63). Suggest "stores only the project's id, name, and creation time".

## Status

Apart from E1–E3, the readable file means the same as revision 4 plus the human's decisions. E1 is the only item for the human.
