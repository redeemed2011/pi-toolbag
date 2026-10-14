# r4 agent2 design

No implementation. This design builds on `r3-agent1-vet.md`, which I accept in full. It covers the devDependency bump and items 1–3, with test plans only for items 4 and 5. `$PI` is the installed `@earendil-works/pi-coding-agent` 1.2.0.

## New evidence from a dry run

I copied the repo, with no node_modules, to `/tmp/pi1x-typecheck`. I linked the workspace's `node_modules` there and pointed `@earendil-works/*` at the installed 1.2.0 packages (`$PI` and `$PI/node_modules/@earendil-works/*`). `tsc --listFiles` confirmed that 1.2.0 `.d.ts` files resolve. The repo itself was not changed.

- `tsc --noEmit` reports **0 errors in all six packages** against 1.2.0.
- vitest passes against 1.2.0 in pi-ctx (226), pi-fallback-lib (164), pi-auto-fallback (3), pi-foundations (14), and pi-stream-stall (9). pi-tool-groups uses `node:test`, not vitest. Its five files pass under `node --test --experimental-strip-types` (3/4/5/4/2).
- Typecheck is clean because the handlers this work touches are typed loosely, so the compiler checks nothing there:
  - `pi-ctx/src/hooks/pending-replace-hook.ts:56`: `(event: unknown, …) as never`
  - `compaction-trigger.ts:39`: `turn_end` `(event: any, ctx: any)`
  - `compaction-hook.ts:14`: `session_before_compact` `(event: any, ctx: any)`
  - `observer-trigger.ts:160-161`: `as never`
  - `pi-fallback-lib/src/types.ts:195`: `FallbackHost.on(event: string, handler: (event: unknown, …))`

  So the bump is low risk, and a clean typecheck alone does not mean the 1.x fields are used correctly.
- Every package `node_modules/@earendil-works/*` (for example `pi-ctx/node_modules/@earendil-works/pi-coding-agent`) is a **dangling** link into `node_modules/.bun/…@0.84.4…`. Resolution falls through to the root's 0.84.4. The repo uses `package-lock.json`, and there is no bun lockfile.

## Step 0: devDependency bump (prerequisite)

1. Change every `^0.84.4` devDependency to `^1.2.0`:
   - pi-ctx: `pi-agent-core`, `pi-ai`, `pi-coding-agent`, `pi-tui`
   - pi-auto-fallback: `pi-coding-agent`
   - pi-foundations: `pi-coding-agent`
   - pi-stream-stall: `pi-ai`, `pi-coding-agent`
   - pi-tool-groups: `pi-coding-agent`, `pi-tui`

   peerDependencies stay `"*"`.
2. Delete the dangling `*/node_modules/@earendil-works` links and run `npm install` at the root, so `package-lock.json` records 1.2.0.
3. `pi-fallback-lib` gets no Pi dependency. Add hand-copied 1.x event shapes in `src/types.ts`, using only the fields we read:
   - `SettledEventLike = { type: "agent_settled"; aborted?: boolean }`
   - `BeforeAgentStartEventLike = { type: "before_agent_start"; messageType?: "user" | "custom" }`
   - `SessionCompactEventLike = { type: "session_compact"; reason?: string; willRetry?: boolean; compactionEntry?: { type?: string; details?: unknown } }`

   Fields stay optional so an older Pi still parses. A comment names `$PI/dist/core/extensions/types.d.ts` 1.2.0 as the source.
4. Gate: `npm run typecheck` and `npm test` pass with no other changes. The dry run says they will.

## Item 1: honor `agent_settled.aborted` in ctx pending-replace

Code, all in `pi-ctx/src/hooks/pending-replace-hook.ts`:

- Add `aborted?: boolean` to the `isCompletedParentTurn` parameter type.
- First line after the null check: `if (event.aborted === true) return false;`. A missing or `false` value changes nothing.
- Register with the real type: `pi.on("agent_settled", (event, ctx) => onPendingReplaceSettled(pi, runtime, ctx as unknown as TurnCtx, gate, event))`. This drops `as never` on the event, so the compiler sees `AgentSettledEvent`. The ctx cast stays, because `TurnCtx` is a narrower test-friendly shape.
- Keep `branchEndedDead` unchanged. It still covers `error` endings, and an `aborted` assistant when the flag is missing on an older Pi.

Tests (pi-ctx vitest, next to the existing pending-replace tests):

1. `{ type: "agent_settled", aborted: true }`, last assistant `stop`, open pending replace → no `CTX_PENDING_TURN` appended, counter unchanged.
2. The compaction case: `aborted: true`, branch ends with an assistant `toolUse` plus a `toolResult`, and no aborted assistant → no append.
3. `aborted: false`, healthy → counted (n+1).
4. `aborted` missing (older Pi), healthy → counted.
5. `aborted: false`, last assistant `error` → skipped by `branchEndedDead`.
6. `isCompletedParentTurn` unit rows for the same five inputs.

## Item 2: remove the print/JSON continuation poll

Code, all in `pi-fallback-lib/src/attach.ts`:

- Delete `waitForContinueTurn` and the `if (ctx.mode === "print" || ctx.mode === "json") await waitForContinueTurn(ctx, emit);` call at lines 563-565. Delete `delay` if nothing else uses it.
- Replace the comment at 97-103 with this fact: "Since Pi 0.87, `sendUserMessage` from an `agent_settled` handler is deferred until all settled handlers return, and the outer `prompt()` awaits that deferred run. Print/JSON therefore does not exit on the failed assistant. Do not wait inside the handler: the continue cannot start until it returns."
- Keep `maybeAwait(sent)` and the `continue-threw` catch. They still matter for synchronous hosts. The budget decrement and the `failover` event are unchanged.

Fake host, in `pi-fallback-lib/tests/fake-host.ts`:

- Add `private settling = false; private deferred: Array<() => Promise<void>> = []`.
- In `emit("agent_settled")`, set `settling = true` while the handlers run, then reset it.
- After the handlers, run each deferred action in order, awaited. If one throws, `emit` rejects, as Pi's `_emitAgentSettled` does.
- `sendUserMessage` during `settling` pushes a deferred action and returns. The action records `sent`, sets `idle = false`, sets `idle = true`, and optionally re-emits `agent_settled` when a test opts in.
- Delete the 5 ms `setTimeout` idle flip. It models Pi before 0.87.

Tests (pi-fallback-lib features):

1. Print mode, safety failover: the handler returns without waiting (fake timers, or elapsed under 1 s). There is no `continue-did-not-start` event. `sent` holds one `CONTINUE_AFTER_BLOCK`, and it was recorded **after** the handler returned. The budget drops by 1.
2. JSON mode: same as 1.
3. TUI mode: the same deferral. Behavior matches today.
4. The deferred send throws (the fake throws inside the deferred action): `emit("agent_settled")` rejects with that error. The `failover` event was already emitted and there is no `continue-threw`. This is a named test of the agreed side effect: print exits non-zero with the message.

## Item 3: post-compaction resume and fallback gates

The agreed rules are in `r3-agent1-vet.md` §2 and §4. Code below.

### pi-ctx

- `src/runtime.ts`: add `compactResume = false` next to `compactInFlight`.
- `src/hooks/compaction-trigger.ts`:
  - set `runtime.compactResume = shouldResume` right before `ctx.compact(...)`
  - set `runtime.compactResume = false` as the first line of both `onComplete` and `onError`, before the `"Compaction cancelled"` early return
- `src/hooks/compaction-hook.ts`: on both return paths (normal at 116-131, `recall_error` at 143-149), add `...(runtime.compactResume ? { resumeInPlace: true } : {})` to `details`.
- No new session entry and no custom message.

### pi-fallback-lib (`src/attach.ts`)

- `session_compact`: before the current restore logic, resolve the entry to read. Walk `ctx.sessionManager.getBranch()` back from the leaf to the newest `type === "compaction"` entry, and fall back to `event.compactionEntry` if none is found.
  - This is a strict superset of agent1's leaf rule (see question 1). The leaf wins whenever it is a compaction. It also survives an earlier `session_compact` handler from another extension appending an entry first.
  - If `reason === "manual"` and `details?.resumeInPlace === true`: emit `{ type: "stay", reason: "resume-in-place" }`, then return. That skips the restore, the usage probe, and `resetEpoch()`.
  - Otherwise, today's path runs unchanged. That includes automatic compaction without a resume, which still restores and calls `resetEpoch()`.
- `before_agent_start`: keep `state.refusalCategory = undefined` first. Then add `if ((event as BeforeAgentStartEventLike).messageType === "custom") return;` before the `deferReturn` block.
  - This leaves `deferReturn` for the safety continue, which is a `user` run.
  - It skips every custom-message run, not only `CTX_RESUME`. That matches Pi before 1.2, when this hook did not fire for custom runs (see question 2).
- `src/types.ts`: add `"resume-in-place"` to the `stay` reason union.

### Tests

pi-fallback-lib:

1. `session_compact` manual, leaf compaction `details.resumeInPlace: true`, current ≠ preferred → no `setModel`, a `stay resume-in-place` event, `attempted` and `remainingBudget` unchanged.
2. Same with no flag → restores, then `resetEpoch()` (existing behavior).
3. The leaf has the flag, but the event entry is an older compaction with the same summary and no flag → the leaf wins and the restore is skipped.
4. A non-compaction entry was appended after the flagged compaction → the walk finds it and the restore is skipped.
5. `before_agent_start` with `messageType: "custom"` and a crossed gate → no switch and no `returnToPreferred`. With `"user"` → unchanged. With the field missing → treated as user.

pi-ctx:

6. The trigger with `shouldResume` true: a fake `ctx.compact` runs the hook. Inside the hook `runtime.compactResume === true`, and it is false after `onComplete`.
7. The same, with `onError` for each of `"Compaction cancelled"`, `"Nothing to compact (session too small)"`, and `"Already compacted"`: the flag is false afterward.
8. `shouldResume` false → the flag is never true.
9. The hook writes `resumeInPlace: true` on both the normal and `recall_error` paths only while the flag is set. With the flag unset (user `/compact`, `/ctx compact`), the field is absent.

Manual check, optional, through herdr:

- Low `compactAtContextTokens`, auto-fallback on a non-preferred chain model.
- A tool-heavy prompt.
- Confirm there is no model switch before `CTX_RESUME` and the resumed run stays on the same model.
- Then a user `/compact` restores the preferred model.

## Item 4 test plan only: tool-groups in fullscreen and regular

No code change to grouping. `registerToolRenderer`, `durationMs`, and `outputPad` are out of scope.

1. Harness gap: the root `npm test` skips pi-tool-groups. Run `npm test -w pi-tool-groups` (its `node:test` script) as part of the plan, and add it to the root script (see question 3).
2. Manual check in two herdr panes on the same repo: one with `--tui-mode regular`, one with the default fullscreen.
3. In each pane:
   1. A prompt that makes 3 or more adjacent tool calls (`read`, `anchor_grep`) → expect one group header, and expand/collapse to work.
   2. One `replace` edit → expect the rich diff card (`installDisplayPatch`) and the hashline result renderer (`installDiffRenderer`).
   3. Interleave text between tool calls → expect separate groups.
   4. Run `/reload`, resume the session, and switch sessions → expect grouping to return after the `belowEditor` widget re-renders.
   5. Scroll back in fullscreen → no duplicated or missing rows.
4. Pass means steps 1–5 hold in both modes.
5. Silent-failure check: `findChat` returns `undefined` with no signal when the tree differs. For this check only, use a throwaway local probe, never committed, that logs whether `findChat(tui)` found a chat in each mode. Whether to keep a permanent signal is question 4.
6. Record the result as a finding on question `854ae9d7-7828-4a2b-8ea2-6fb1d1f2d7ec`. If fullscreen fails, a design round follows. That round is not this one.

## Item 5 test plan only: workspace typecheck against 1.x

1. After Step 0, `npm run typecheck` reports 0 errors in all six packages (expected from the dry run).
2. After items 1–3, the same holds. The touched handlers no longer use `as never` or `any` for the event, specifically `pending-replace-hook.ts` `agent_settled`.
3. Leave the remaining `any` and `never` casts, at `compaction-trigger.ts:39`, `compaction-hook.ts:14`, and `observer-trigger.ts:160-161`, for item 5. List them in the item 5 finding.
4. Negative check that the types are live: temporarily read a field that does not exist on `AgentSettledEvent` in `pending-replace-hook.ts`, confirm `tsc` errors, then revert. Never commit it.
5. `npm test` passes in all six packages, including pi-tool-groups' `node:test` suite.

## Order and commits

Commits, each with its tests, in this order: Step 0 bump, item 1, item 2, item 3. Items 4 and 5 are test runs that produce findings, not code.

## Questions for agent1

1. To find the compaction entry, will you accept "walk the branch back from the leaf to the newest compaction entry, falling back to `event.compactionEntry`" in place of "leaf only when it is a compaction"? The leaf result is the same whenever the leaf is a compaction, and the walk also survives another extension appending first.
2. The `messageType === "custom"` skip in `before_agent_start` applies to every custom run, not only `CTX_RESUME`, and is placed before the `deferReturn` block. Do you accept both, on the grounds that this is how Pi behaved before 1.2?
3. Should the root `npm test` gain pi-tool-groups' `node:test` suite in Step 0, or under item 4?
4. Item 4 uses a throwaway, uncommitted probe to detect a silent `findChat` miss. Do you agree a permanent signal stays out of this pass?
5. Do you accept this file as the design text? If yes, say so in `r5-agent1-design.md` or the agreed reply, and either side writes `agreement.md` quoting it. If not, name the section.
