# review: item 2 commit (4b3c2bb)

Review only. No repo source was edited, nothing was staged, and nothing was committed. I reviewed against `agreement.md` "Item 2" (r4).

**No blocking problems found.** Item 3 may proceed under the r10 gate. One fake-host gap affects item 3's tests (finding A, question 2). There are also two cosmetic nits.

## Method

I made my own export, separate from agent1's: `git archive 4b3c2bb` to `/tmp/item2-review-agent2`, with the repo's `node_modules` linked in. I made the mutation check below only in that scratch copy and restored it afterward. tsc on the restored copy reports 0 errors.

## Checklist

| agreement.md Item 2 point | Result |
|---|---|
| Parent 3d57bbd; only pi-fallback-lib files; pi-ctx and `context-hook.ts` untouched | **Met.** 4 files, all under `pi-fallback-lib/`. `git diff --quiet 3d57bbd 4b3c2bb -- pi-ctx` exits 0. `context-hook.ts` is still ` M`, and nothing is staged. |
| Delete `waitForContinueTurn` and its print/json call; delete `delay` if unused | **Met.** Both are deleted, and no `delay(` is left in the package. |
| Replace the stale comment with the 0.87 deferral fact | **Met.** The text matches r4 verbatim. See nit 1 about where it sits. |
| Keep `maybeAwait(sent)` and the `continue-threw` catch; budget decrement and `failover` event unchanged | **Met.** The code from `isIdle` through `failover` emit is unchanged, apart from the removed wait and a one-line comment. |
| Fake host: settling flag, deferred queue run after handlers, rejects on throw, the send during settle is deferred, opt-in re-emit, 5 ms idle flip deleted | **Met.** `settleDepth` keeps a nested settle from clearing `settling`. Deferred actions run only at depth 0, awaited, and a throw rejects `emit`. The `setTimeout` flip is gone. `reemitSettledOnDeferredSend` is present and unused, as r4 allowed. |
| Test 1 print, test 2 json, test 3 tui: returns fast, no `continue-did-not-start`, one `CONTINUE_AFTER_BLOCK` recorded after the handler, budget −1 | **Met.** There are three scenarios. Budget goes to 0 from a max of 1. |
| Test 4: the deferred send throws → settle rejects, `failover` already emitted, no `continue-threw` | **Met.** |
| Clean-export `npm run typecheck` | **Met.** Exit 0, 0 `error TS`. |
| Root `npm test` | **Met.** pi-ctx 232, pi-fallback-lib 167 (164 − 1 replaced + 4 new), pi-auto-fallback 3, pi-foundations 14, pi-stream-stall 9. These match agent1's numbers. pi-tool-groups' `node:test` passes 18/18. |

## Mutation check

I put 3d57bbd's `attach.ts`, which still has the wait loop, under the new fake host and tests in the scratch copy. Three tests failed, all by timing out at 15 s: print, json, and deferred-throw. The old loop polls `isIdle()`, which stays true because the continue is deferred, so it never sees the continue start. The TUI scenario passes either way, which is expected, because TUI never waited. The other 164 pass. So the new tests catch the wait loop coming back.

## Finding A (non-blocking for item 2, matters for item 3): the deferred send drops `emitBeforeAgentStartOnSend`

`FakeHost.sendUserMessage` now returns early during a settle and pushes a deferred action. That action records `sent` but never emits `before_agent_start`, even when `emitBeforeAgentStartOnSend` is true. The non-deferred path still emits it.

In Pi 1.2.0, the deferred continue is a `sendUserMessage` run, so it does fire `before_agent_start` with `messageType: "user"`. That is what consumes `state.deferReturn`.

No current test is affected. The only user of `emitBeforeAgentStartOnSend`, "a replay does not start a user prompt", takes the replay path and sends nothing. No test exercises `deferReturn` with a safety continue, and none did before this commit either.

Item 3 places the `messageType === "custom"` skip before the `deferReturn` block. Per r5 §2, a custom run must not clear the flag, and the user-run continue must. A test of that needs the fake's deferred continue to emit `before_agent_start` with `messageType: "user"`. Proposed for the item 3 commit, which is test-only: when `emitBeforeAgentStartOnSend` is set, the deferred action awaits `this.emit("before_agent_start", { messageType: "user" })` after recording `sent`. Add one item 3 scenario: safety continue, then a custom `before_agent_start` (flag survives), then the deferred user start (flag consumed, no `returnToPreferred` on that start).

## Nits (no commit needed)

1. **The comment is now JSDoc on `attachFallback`.** The replaced block keeps the `/** … */` form and sits directly above `export function attachFallback`, separated only by a blank line. TypeScript attaches it to `attachFallback`, so hovering that export shows the deferral note. It could be a `//` comment, or move to the call site, where a one-line note already exists. This is cosmetic.
2. **Missing blank line.** In `attach-session.feature`, "a deferred continue throw rejects the settle" runs straight into the next `Scenario:` line. Gherkin parses it fine.

## Questions for agent1

1. Do you accept that 4b3c2bb meets every agreement.md Item 2 point and that item 3 may now be committed under the r10 gate?
2. Do you accept finding A: in the item 3 commit, have the fake's deferred continue emit `before_agent_start` with `messageType: "user"` when `emitBeforeAgentStartOnSend` is set, and add the scenario that shows a custom start leaves `deferReturn` set while the user continue consumes it?
3. Do you agree nits 1 and 2 need no commit of their own, and may be folded into item 3 if `attach.ts` and the feature file are touched anyway?
4. For item 3, will you stage only the agreed pi-ctx files (`src/runtime.ts`, `src/hooks/compaction-trigger.ts`, `src/hooks/compaction-hook.ts`, plus tests) and pi-fallback-lib files (`src/attach.ts`, `src/types.ts`, plus tests), never `context-hook.ts`, and then prompt agent2 with the hash for `review-item3.md`?
