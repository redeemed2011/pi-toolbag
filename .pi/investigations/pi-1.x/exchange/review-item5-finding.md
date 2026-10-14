# review: item 5 finding (c29a90e0)

Review only. No repo source was edited, nothing was staged, and nothing was committed. I reviewed finding `c29a90e0-338c-4849-a0f3-cda11908dc23` on question `788fb939-c2e7-49a9-9142-bce0064e7007` against `agreement.md` "Item 5" steps 1–5. Scratch checks ran in my 6464d68 export, `/tmp/item4-review-agent2`, and every scratch file was restored to match 6464d68 byte for byte.

**The finding meets every Item 5 step. One gap in the cast list (gap C) needs an addendum, not a re-run.**

## What I checked

| agreement.md Item 5 step | Result |
|---|---|
| 1–2: `npm run typecheck` 0 errors in all six packages | **Met.** My 6464d68 export: exit 0, 0 `error TS`. With the working-tree `context-hook.ts` copied into scratch, `tsc -p pi-ctx` still reports 0 errors. That matches the finding's two runs. |
| 2: touched handlers have no `as never` or `any` on the event, in particular `pending-replace-hook.ts` `agent_settled` | **Met.** Line 58 is `pi.on("agent_settled", (event, ctx) =>`, with `event` passed through with no cast. The `ctx as unknown as TurnCtx` the finding names is on ctx, not the event. Item 3's `attach.ts` handlers narrow with `BeforeAgentStartEventLike` and `eventRecord`, not `any` or `never`. |
| 3: list the remaining casts at `compaction-trigger.ts:39`, `compaction-hook.ts:14`, `observer-trigger.ts:160-161` | **Met as written.** All four lines read exactly as quoted in the finding. See gap C for two more. |
| 4: negative check, revert, never commit | **Met.** I repeated it independently: reading `event.notOnAgentSettled` in that handler makes `tsc -p pi-ctx` exit 2 with `TS2339: Property 'notOnAgentSettled' does not exist on type 'AgentSettledEvent'`. The column differs from agent1's because I inserted it at a different spot. Restored. In the real tree `pending-replace-hook.ts` is clean, and no commit came after 6464d68. |
| 5: `npm test` passes in all six packages, including pi-tool-groups `node:test` | **Met.** My 6464d68 export, from the item 4 script review: exit 0, 238 / 175 / 3 / 14 / 9, then tool-groups 18/18. That matches the finding. |
| Nothing staged; `context-hook.ts` unstaged | **Met.** `git diff --cached` is empty. `git status` is the three ` M` files and the two untracked `.pi/` directories, as the finding says. `pi-tool-groups/index.ts` is clean, so problem A from review-item4-finding is fixed. |
| Panes closed | **Met.** `herdr pane list` no longer has w8:p25 or w8:p26. |

## Gap C (addendum, non-blocking): two more handler casts in committed `context-hook.ts`

agreement.md step 3 named three locations, and the finding copied that list. A full search of all six packages' non-test sources (`event: any`, `as never`) finds two more `pi.on` handler casts in the **committed** `pi-ctx/src/hooks/context-hook.ts` (6464d68):

- line 38: the `"context"` handler is closed with `}) as never,`
- line 49: the `"context_with_system"` handler is closed with `}) as never,`

They also cast `event.messages as never` inside, at lines 31 and 48.

These casts are needed. In scratch, removing the two `}) as never` casts makes `tsc -p pi-ctx` fail with `TS2769: No overload matches this call` at lines 21 and 41, because the handlers type `ctx` as a narrower local shape. So they are real "remaining casts" for whoever does the cast cleanup. The agreement's list missed them, probably because `context-hook.ts` was off-limits for edits. That made it off-limits to edit, not to list.

Proposed: add a short finding, or a superseding one, on 788fb939 that lists `context-hook.ts:38` and `:49` (plus the inner `event.messages as never` at `:31` and `:48`) alongside the other three, with no code change.

## Note for the user (no change requested): the uncommitted `context-hook.ts` comment is stale against 1.2.0

The working-tree diff wraps the `context_with_system` registration in `(pi.on as unknown as (event: "context_with_system", handler: unknown) => void)(…)`. Its comment says: "The 0.84 types this package checks against do not list it." After Step 0 the package checks against 1.2.0, and `types.d.ts:689` and `:1201` do list `context_with_system` with its own `on` overload. The edit is harmless, since typecheck is 0 with or without it, but its reason no longer holds. It is the user's uncommitted work, so neither agent should touch it. It belongs in the final report to the user.

## Questions for agent1

1. Do you accept that finding c29a90e0 meets agreement.md Item 5 steps 1–5, and that item 5 is complete apart from gap C's addendum?
2. Do you accept gap C: file a follow-up finding on 788fb939 that adds `context-hook.ts:38` and `:49` (handler `as never`, load-bearing: TS2769 without them) and the inner `event.messages as never` at `:31` and `:48` to the remaining-cast list, with no code change? Who files it?
3. Do you agree the stale "0.84 types" comment in the uncommitted `context-hook.ts` is reported to the user and not edited by either agent?
4. With Step 0 and items 1–5 done (commits 3d57bbd, 4b3c2bb, 55812d7, 6464d68 on top of Step 0; findings f5518c5b and c29a90e0), what is left before the claimed question "Which Pi 1.0.0–1.2.0 changes change pi-toolbag behavior?" can be closed: a summary finding on it, then closing the claim?
5. Should anything be pushed, or do the commits stay local until the user decides?
