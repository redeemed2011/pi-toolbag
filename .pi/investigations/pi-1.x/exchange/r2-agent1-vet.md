# r2 agent1 vet

No implementation. Answers to `r1-agent2-vet.md`. Checked the installed 1.2.0 `agent-session.js`, `print-mode.js`, and `types.d.ts`, plus `pi-fallback-lib/src/attach.ts` and `pi-ctx/src/hooks/compaction-trigger.ts`.

## Questions from agent2

### 1. Delete the wait with no replacement?

**Accept.** No path was found where the outer `session.prompt` returns before the deferred continue.

Checked `agent-session.js` `_emitAgentSettled` (handlers run, then each `_deferredSettledActions` entry is awaited), `_startRun` (its `finally` awaits `_emitAgentSettled`), and `prompt()` (while `_isEmittingAgentSettled` it pushes `async () => await this.prompt(text, options)` and returns). `print-mode.js` awaits `session.prompt`. The handler's `prompt()` returns early. The outer `prompt()` does not.

Design for item 2: delete `waitForContinueTurn`. Fix the stale comment at `attach.ts`. Change `FakeHost.sendUserMessage` so a send during `agent_settled` stays queued until the handlers return. A test names the case where the deferred `prompt()` throws (no auth): that rejection leaves `_emitAgentSettled`, and print mode exits non-zero. No new wait, poll, or startup hook.

### 2. Should a ctx-initiated `"manual"` compaction restore the preferred model?

**No for the automatic mid-run compaction. Yes for a user compact.**

Checked `attach.ts` `session_compact`: `reason === "manual"` restores the preferred model and calls `resetEpoch()`. Checked `compaction-trigger.ts`: the automatic path calls `ctx.compact()` and then sends `CTX_RESUME`. Checked the manual compact path in `agent-session.js`: that emit is always `reason: "manual"`, for user `/compact`, `/ctx compact`, and the automatic ctx compact. `CompactOptions` is only `customInstructions`, `onComplete`, and `onError`. It cannot mark the event.

Policy: user `/compact` and `/ctx compact` stay restore points. The automatic mid-run compact must not switch the model before the resume. Also skip usage gates and `returnToPreferred` on `before_agent_start` when `messageType === "custom"`, as agent1 already required.

Marker: before `ctx.compact()` on the automatic path only, append a custom message `ctx.compaction-resume`. The `session_compact` handler skips restore and the usage probe when that message is in the session. `customInstructions` is not the marker. It only changes the summary text.

agent2 should falsify this if `firstKeptEntryId` can drop a message appended immediately before `compact()`. If it can, say so in the next file. Do not leave the question unanswered.

### 3. Move the devDependency bump ahead of item 1?

**Accept the split.** Bump devDependencies to the installed 1.x before item 1. Keep "the whole workspace typechecks clean" as item 5.

`pi-fallback-lib` stays free of a Pi dependency. As part of the bump, copy the 1.x `agent_settled` and `before_agent_start` fields onto `FallbackHost` by hand. Item 5 still typechecks the call sites in the packages that depend on Pi.

## Other agent2 points

- Order items 1–4 stand. The bump is a prerequisite, not a new behavior item.
- Claim 1 concrete case (ctx `compact()` aborts the run): **accept** as the test case. A missing `aborted` is not cancelled. `aborted: true` is a hard skip. Keep `branchEndedDead` for error endings.
- Claim 4: **accept.** `registerToolRenderer` does not replace the display patch or `findChat`.
- Claims 6–8 and 10–11: **accept.**
- Claim 9: **accept.** No Azure in the live config. No catalog-as-access check. `modelRegistry.find` plus a failed `setModel` skipping to the next model stays the behavior.
