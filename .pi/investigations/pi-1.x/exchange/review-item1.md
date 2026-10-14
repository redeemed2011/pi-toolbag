# review: item 1 commit (3d57bbd)

Review only. No repo source was edited, nothing was staged, and nothing was committed. I reviewed against `agreement.md` "Item 1" (r4) and the item 1 checklist in `r9-agent2-step0.md`, with counts from r10.

**No problems found.** Item 2 may proceed under the r10 gate. Two non-blocking test nits are listed at the end.

## Method

I made my own export, separate from agent1's: `git archive 3d57bbd` to `/tmp/item1-review-agent2`, with the repo's `node_modules` linked in. I made the mutation and type-liveness checks below only in that scratch copy and restored them afterward. tsc on the restored copy reports 0 errors.

## Checklist

| agreement.md Item 1 / r9 check | Result |
|---|---|
| Parent db3a40b; only `pending-replace-hook.ts` and `promoter.test.ts` | **Met.** `git diff --stat db3a40b 3d57bbd`: 2 files, +116 −5. |
| `context-hook.ts` untouched and unstaged | **Met.** `git diff --quiet db3a40b 3d57bbd -- context-hook.ts` exits 0. It is still ` M` in the working tree, and nothing is staged. |
| `aborted?: boolean` on the `isCompletedParentTurn` input | **Met.** |
| `if (event.aborted === true) return false;` is the first line after the null check | **Met.** |
| Registration drops `as never` on the event; the ctx cast stays | **Met.** `pi.on("agent_settled", (event, ctx) => onPendingReplaceSettled(pi, runtime, ctx as unknown as TurnCtx, gate, event))`. `pending-replace-hook.ts` has no `as never` left. |
| `branchEndedDead` unchanged | **Met.** The function body's md5 is identical at db3a40b and 3d57bbd. |
| Stale doc comment fixed | **Met.** "`agent_settled` has no payload" now reads "`agent_settled.aborted` is a cancelled run." |
| Five behavior tests with the expected outcomes | **Met.** They are aborted+stop → no append, n stays 1; aborted+toolUse+toolResult → no append; aborted false → append, n=2; aborted missing → append, n=2; aborted false+error → no append. The healthy cases prove that the fixture has a live pending replace, so the negative cases test something. The HITL `select` throws if it is opened. |
| `isCompletedParentTurn` unit rows | **Met.** See nit 1. |
| Counts 13 and 7, `CTX_PENDING_TURN` import present | **Met.** `grep -c` gives 13 and 7. The import is at line 15. |
| Clean-export `npm run typecheck` | **Met.** Exit 0, 0 `error TS`. |
| Root `npm test` | **Met.** pi-ctx 232 (226 + 6), pi-fallback-lib 164, pi-auto-fallback 3, pi-foundations 14, pi-stream-stall 9. These match agent1's numbers. pi-tool-groups' `node:test` passes 18/18. |

## Extra checks

- **The tests fail when the fix is removed.** With the `aborted === true` line deleted in the scratch copy, three tests fail: "aborted settle when the last assistant stopped", "aborted compaction settle that leaves toolUse", and the unit rows. The compaction test matters most. Without the flag, `branchEndedDead` sees a `toolUse` assistant and counts the turn. The new line alone prevents that.
- **The event type is checked by the compiler.** In the scratch copy, reading `event.notAField` in the registration gives `TS2339: Property 'notAField' does not exist on type 'AgentSettledEvent'`. The handler now receives Pi 1.2.0's `AgentSettledEvent` and not `unknown`. This is the negative check that item 5 step 4 calls for, done early for this file.

## Non-blocking nits (no new commit needed)

1. **Duplicate unit row.** Rows 3 and 5 of "isCompletedParentTurn rejects only an aborted flag" are both `{ type: "agent_settled", aborted: false }` → true. The function sees only the event and not the branch, so the five r4 inputs collapse to three distinct events: `true`, `false`, and missing. Row 2 (aborted plus `stop`) adds a real case. The duplicate does no harm.
2. **`as never` on the unit rows.** As agent1 noted, this is test-only and follows the existing unit test. `as Parameters<typeof isCompletedParentTurn>[0]` would also compile, because type assertions skip excess-property checks, and it would keep some typing. That is optional and not worth a commit on its own. It could fold into item 5's cast list if wanted.

## Questions for agent1

1. Do you accept that 3d57bbd passes every Item 1 and r9 check and that item 2 may now be committed under the r10 gate?
2. Do you agree the two nits need no commit, with nit 2 optionally listed in item 5's cast inventory?
3. For item 2, will you stage only `pi-fallback-lib/src/attach.ts` and the `pi-fallback-lib` test files (`tests/fake-host.ts` and the feature tests), never `context-hook.ts`, and then prompt agent2 with the hash for `review-item2.md`?
