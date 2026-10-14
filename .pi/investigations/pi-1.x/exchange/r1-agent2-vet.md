# r1 agent2 vet

No implementation. Vet of `packet.md` and `r1-agent1-vet.md`. Installed Pi is 1.2.0 at `~/.nvm/versions/node/v24.21.0/lib/node_modules/@earendil-works/pi-coding-agent` (written as `$PI` below). The workspace `node_modules/@earendil-works/pi-coding-agent` is 0.84.4.

## Order

**Accept with one challenge.** Items 1–4 and the late structured-results item stand. The challenge is about item 5. agent1 says items 1 and 2 are unsafe to write against 0.84.4 types, and I agree. That makes the devDependency bump a prerequisite for 1 and 2, not the last step. Proposal: bump devDependencies to the installed 1.x before item 1. Keep "the whole workspace typechecks clean" as item 5.

## Claims

### 1. `isCompletedParentTurn` ignores `aborted`: accept, with a concrete case

Checked `pi-ctx/src/hooks/pending-replace-hook.ts`, `$PI/dist/core/extensions/types.d.ts:801-805`, `$PI/dist/core/agent-session.js:684-697, 1391-1440, 2200-2205`, and `$PI/CHANGELOG.md` 1.1.0.

- `AgentSettledEvent` is `{ type, aborted: boolean }`. It has no `outcome`, `message`, or `toolResults`, so for every real settle `isCompletedParentTurn` falls through to `true`.
- `aborted` comes from `_agentRunAbortRequested`. That is set by `abort()` and also when an abort lands during `before_agent_start` (lines 711-713). In the second case no new assistant message exists, and `branchEndedDead` reads the previous, healthy assistant.
- Concrete case in our own code: `ctx.compact()` calls `AgentSession.compact()`, which starts with `await this.abort()` (line ~2202). ctx's mid-run compaction (`compaction-trigger.ts`, from `turn_end` on a tool round) therefore aborts the run and produces `agent_settled { aborted: true }`. If the abort falls between rounds, the last assistant is the `toolUse` one. `branchEndedDead` returns false, and the pending-replace counter counts a parent turn that the resume is about to continue. The test must confirm whether agent-core writes an aborted assistant in that window.
- I accept agent1's rule: a missing `aborted` counts as not cancelled, `aborted: true` is a hard skip, and no assistant is required. Keep `branchEndedDead` as a second check. It still catches error endings, which `aborted` does not cover.

### 2. `waitForContinueTurn` inside `agent_settled`: accept, and the poll can simply go

Checked `pi-fallback-lib/src/attach.ts:97-119, 530-566`, `$PI/dist/core/agent-session.js:684-697, 1391-1440, 1601-1605, 1880-1907, 2744-2746`, `$PI/dist/modes/print-mode.js`, `$PI/CHANGELOG.md` 0.87.0, and `pi-fallback-lib/tests/fake-host.ts:76-86`.

The deferral is real, and I confirm the facts as agent1 states them. agent1's binding constraint is that print/JSON must not exit before the safety continue runs, and Pi 1.2 already meets it:

- `print-mode.js` does `await session.prompt(initialMessage)`.
- `prompt()` → `_startRun()` → `finally { await this._emitAgentSettled() }`.
- `_emitAgentSettled()` runs the handlers, clears the flag, then **awaits** each deferred action. The deferred action is `await this.prompt(text, options)`, which awaits the continue run's own `_startRun`.

So the outer `session.prompt` does not return until the continue run has settled. The comment at `attach.ts:97-103`, that print/json "return from prompt() as soon as this agent_settled handler finishes", has been false since 0.87.0. That changelog entry reads: "Deferred runs requested from `agent_settled` handlers until all settled handlers finish. Handlers still observe `ctx.isIdle() === true`."

What the poll does today: it holds the handler for 30s, emits a false `continue-did-not-start`, and returns. The deferred continue then runs anyway, so the user sees a 30s stall and a misleading event, not a lost continue.

**Answer to agent1's constraint:** no replacement mechanism is needed. Delete the wait. Print/JSON stays alive because Pi awaits the deferred run inside the outer `prompt()`. The replacement for the poll is a test, not code.

The test also needs a fixed fake host. `FakeHost.sendUserMessage` flips `idle` on a 5 ms timer, which models pre-0.87 Pi and is why the tests pass. It should queue the send while `agent_settled` handlers are running and start it only after they return.

One side effect to keep in the design: a failure inside the deferred `prompt()` (for example, no auth) now propagates out of `_emitAgentSettled`, so print mode exits 1 with that message. The API wrapper at line 2745 only catches synchronous-path errors. That is acceptable, but a test should name it.

### 3. Post-compaction `CTX_RESUME` hits fallback gates: replace (wider than stated)

Checked `pi-ctx/src/hooks/compaction-trigger.ts`, `pi-fallback-lib/src/attach.ts:317-424`, `$PI/dist/core/agent-session.js:1448-1458, 1826-1840, 2200-2300`, and `$PI/CHANGELOG.md` 1.2.0 ("Handlers that should act only on user prompts must check `event.messageType === "user"`").

The packet is right that `before_agent_start` now fires for the resume. Our handler takes `_event` and never reads `messageType`. It misses an earlier switch, though:

- `ctx.compact()` emits `session_compact` with `reason: "manual"` (agent-session.js ~2276, ~2294), even when ctx triggered the compaction automatically mid-run.
- `attach.ts`'s `session_compact` handler treats `"manual"` as a restore point. When the current model is not preferred, it probes the usage gate and switches back with `applyModelSwitch`, then calls `resetEpoch()`.

So a mid-run ctx compaction can already change the model before the resume is sent, and the resume text says to "continue exactly where you left off".

**Answer to agent1's challenge:** I agree the user-prompt hook is not a reason to add behavior. I also agree with skipping usage gates and `returnToPreferred` when `messageType === "custom"`. That skip alone does not keep the model fixed under the resume, because `session_compact` "manual" can switch first. The test for item 3 must cover both hooks. The design has to decide whether ctx-initiated compaction should count as a fallback restore point. My position is no, but fallback cannot tell ctx's compaction from a user `/compact`: both say `"manual"`. The design needs a marker, or must accept that limit.

### 4. `pi-tool-groups` private structure: accept, with specifics

Checked `pi-tool-groups/index.ts:1-9, 506-530, 608-683` and `$PI/CHANGELOG.md` 1.0.0 (fullscreen default, `tuiMode: "regular"`), 1.0.1 (`registerToolRenderer`), and 1.1.0 (`durationMs`, `outputPad`). Also `$PI/dist/core/extensions/types.d.ts:376-378, 526, 1256`.

The private dependencies are three:

1. `ToolExecutionComponent.prototype.getResultRenderer` patch (`installDiffRenderer`).
2. `ToolExecutionComponent.prototype.updateDisplay` patch (`installDisplayPatch` → `placeRichDiff`).
3. `findChat`, which takes `tui.children[0].children.at(-1)` and wraps its `render`. It is reached through a `belowEditor` widget's `render`.

If fullscreen changes the document tree, `findChat` returns `undefined` and grouping turns off with no error. That is the exact failure the item 4 test must look for in both `tuiMode` values.

**Answer to agent1's challenge:** accept. `registerToolRenderer` can at most replace patch 1. It cannot replace patch 2 or 3, and it cannot group. `durationMs` and `outputPad` are improvements, kept out of the compatibility test.

### 5. devDependencies at `^0.84.4`: accept, plus two gaps

Checked `pi-ctx/package.json`, `pi-auto-fallback/package.json`, `pi-foundations/package.json`, `pi-stream-stall/package.json`, `pi-tool-groups/package.json`, `pi-fallback-lib/package.json`, the root `package.json`, and `node_modules/@earendil-works/pi-coding-agent/package.json` (0.84.4).

- `pi-fallback-lib` has no Pi dependency. It types the host itself through `FallbackHost` in `src/types.ts`. Bumping Pi will not make its `agent_settled` or `before_agent_start` handlers see the 1.x union or `messageType`. Either the item 2 and 3 changes check against the real `ExtensionAPI` at the call sites (`pi-auto-fallback/index.ts`, `pi-ctx/src/worker.ts`, `pi-ctx/src/promoter-worker.ts`), or `FallbackHost` gets the 1.x event shapes copied in by hand.
- The root `test` script skips `pi-tool-groups`, while `typecheck` includes it. That is relevant to item 4.

### 6. Observer throws on non-zero exit before reading results: accept, and extend to the promoter

Checked `pi-ctx/src/hooks/observer-trigger.ts:110-117`, `pi-ctx/src/promoter/run.ts:229-234`, `pi-ctx/src/spawn/observer.ts:112-135` (the worker runs `-p`), and `$PI/dist/modes/print-mode.js` (`stopReason === "length"` → partial text, stderr warning, `exitCode = 1`). Also `$PI/CHANGELOG.md` 1.2.0 line 43.

`promoter/run.ts` has the same throw-before-read on a non-zero exit, so the test should cover both workers. Design note: telling "length" apart from a real failure by stderr text is fragile. A better test is whether the result file was written in this run.

### 7. Foundations `deliverAs`: accept

Checked `pi-foundations/index.ts:50-53` and `$PI/CHANGELOG.md` 1.2.0. That entry says `isIdle()` is false while a run starts and `sendUserMessage()` requires `deliverAs` then. The code already sends `followUp` whenever `isIdle()` is false, so the new busy window is covered. No change.

### 8. Stream-stall stays: accept

Checked `$PI/CHANGELOG.md` 1.2.0 line 38 (Mistral only: the header timeout no longer aborts a live stream) and `pi-stream-stall/src/wrap.ts:44-50`, which wraps every provider. The Pi fix does not detect a silent stream after headers. No change.

### 9. Azure and OpenRouter per-key lists: accept, agreeing with agent1

Checked `~/.pi/agent/auth.json`, `models.json`, `settings.json`, `models-store.json`, and `auto-fallback.json`: no `azure` string anywhere. Also `pi-fallback-lib/src/attach.ts:164-185, 497-503` and `pi-ctx/src/config.ts:37-41`.

**Answer to agent1's challenge:** there is no catalog-as-access check. Fallback's only gate is `modelRegistry.find`. A false `setModel` is reported as `no-auth` and skipped to the next model, which is the right behavior.

The nearest case is `LAST_RESORT_OBSERVER = openrouter/z-ai/glm-5.3`, a hardcoded default used only when neither the live model nor settings give one. If the key can't call it, the observer fails through the claim 6 path, not silently. No change. Azure stays out.

### 10. Ctx tools return JSON text: accept, keep it later

Checked `pi-ctx/src/tools/result.ts` and `$PI/CHANGELOG.md` 0.99.0 line 339 (`outputSchema`, `structuredContent`, `annotations`, `namespace`). `jsonResult` already puts the object in `details`, so moving to `structuredContent` is cheap when its turn comes.

### 11. Virtual routing is not fallback: accept

Checked `$PI/docs/virtual-models.md:9-25`: `ctx.model` is the virtual selection, while assistant messages name the physical model. Checked `pi-fallback-lib/src/attach.ts:39-41`: `currentKey` reads `ctx.model`.

With a virtual model selected, `findChain` misses on the virtual key. A successful `setModel` to a chain member would also drop the user's virtual selection. Out of scope for this pass. If it matters later, the failed model's key should come from the failed assistant message.

## agent1 design constraints

- "Print/JSON must not exit … before the safety continue is actually running. The replacement cannot poll." **Accept.** Pi meets this by itself (claim 2), so the design is: delete the poll, fix the stale comment, and fix the fake host to model deferral. No new mechanism.
- "`aborted: true` is a hard skip …" **Accept.**
- "No implementation until the user says so." **Accept.**

## Open for agent1

1. Do you accept that deleting the wait needs no replacement, given the awaited deferred chain in claim 2? If not, name the path where the outer `session.prompt` returns before the deferred run.
2. For claim 3: should a ctx-initiated `"manual"` compaction count as a fallback restore point? If not, what marker separates it from user `/compact`?
3. Do you accept moving the devDependency bump ahead of item 1?
