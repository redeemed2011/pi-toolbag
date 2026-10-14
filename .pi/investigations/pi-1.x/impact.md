# Impact of Pi 1.0.0–1.2.0 on pi-toolbag

Installed package: `@earendil-works/pi-coding-agent` 1.2.0. Source of the bullets: `changelog-1.x.md` in this folder. Types and runtime checked in that install: `dist/core/extensions/types.d.ts`, `dist/core/agent-session.js`.

No package source was changed. The `subagent` tool was not in this session's tool list (`subagent_supervisor` was), so this was done in one session, not fanned out.

## Breaks

None verified. The call sites that the 1.2 busy-session rule can throw from already guard it, or they do not call `sendUserMessage`.

`sendUserMessage` without `deliverAs` throws `Agent is already processing` when `isStreaming` is true. `isStreaming` is set at the start of `_startRun`, before `before_agent_start`. `agent_settled` clears that flag before the event is emitted, so `pi-fallback-lib`'s safety path still sees idle and may omit `deliverAs` (`attach.ts` `onFailover`, safety branch). `pi-foundations` already sends `deliverAs: "followUp"` when `ctx.isIdle()` is false (`index.ts` `runRitual`).

## Behavior changes

1. `before_agent_start` now also fires for idle `pi.sendMessage(..., { triggerTurn: true })`. The event is a union: `"user"` has `prompt`, `"custom"` has `message` and no `prompt`.
   - `pi-ctx` `registerCompactionTrigger` sends `{ customType: CTX_RESUME, triggerTurn: true }` from compaction `onComplete` (`src/hooks/compaction-trigger.ts`). That resume is now a custom `before_agent_start`.
   - `pi-fallback-lib` `before_agent_start` ignores the event and still runs the usage gate and return-to-preferred (`src/attach.ts`). Those now apply to the ctx resume turn, not only to user prompts. It does not read `event.prompt`, so the union does not throw.
   - `pi-stream-stall` reinstalls its stream wrap on every `before_agent_start` (`index.ts`). The wrap is idempotent (`WRAPPED`). Extra calls on resume turns do not change the stall.
   - While a run is already active, `sendCustomMessage` steers instead of throwing. A ctx resume that completes during a live run can land in that run instead of failing with "Agent is already processing".

2. `agent_settled` now has `aborted: boolean` (`AgentSettledEvent`). `pi-ctx` `isCompletedParentTurn` still treats a payload-less settle as a completed parent turn and does not read `aborted` (`src/hooks/pending-replace-hook.ts`). It then drops the turn only if the last assistant `stopReason` is `error` or `aborted` (`branchEndedDead`). An abort during `before_agent_start` (1.2 aborts the run once it starts) can settle with `aborted: true` and no aborted assistant. That turn would count toward pending-replace HITL. Not observed in a run.

3. Pi now retries, before failover sees them, errors it used to end the turn on: "The upstream provider returned an error" (1.2.0), `server_busy` / "servers are currently busy" (1.1.0), "Selected model is at capacity" (1.0.3), Mistral `finish_reason: "error"` (1.1.0). `pi-fallback-lib` still runs only at `agent_before_settle` / `agent_settled`, after Pi gives up. `classifyError` (`src/classify.ts`) has no needle for those phrases. If the exhausted error is that text and has no 5xx status, the class is `other` and failover does not hop. Quota, timeout, and 5xx paths are unchanged.

4. Pi estimates input at 3.5 characters per token instead of 4 when calculating output limits (1.1.0). `pi-ctx` inject billing is still local `chars/4` (`src/render/estimate.ts`) and is tested against Pi `estimateTokens` for `compactionSummary`, which is a different estimator. Effect is fewer output-limit overflows, not a ctx math change.

5. `serializeConversation()` omits thinking (1.2.0). `pi-ctx` does not call it. Compaction still uses `session_before_compact`, whose `preparation`, `reason`, and `willRetry` fields are still on the 1.2 types. Pi's own summary text no longer contains thinking.

6. Print mode exits 1 when the final response is cut off at the output limit (1.2.0). `waitForContinueTurn` already exists so `pi -p` does not exit 1 on the failed assistant before the safety continue finishes. A truncated success is now also exit 1. That is Pi, not a toolbag exit.

## No impact

- `context` and `context_with_system` are unchanged. `pi-ctx` `registerContextHook` still uses both. The 0.84 types comment in that file is about the devDependency, not a 1.2 removal.
- `agent_before_settle` still accepts `{ continue, entries }` with `context_edit`. Replay failover still matches.
- `session_compact` still has `reason` and `willRetry`. Fallback restore on manual, threshold, and overflow still matches.
- `durationMs` and `outputPad` are additive. Fallback listens only to `tool_execution_start`. `pi-tool-groups` does not read those fields.
- `registerToolRenderer`, MCP resource counts, Azure provider rename, experimental server removal, `~` expansion in extension settings, theme schema, fullscreen default, and codemode prompt changes: no call site in these packages. No `azure` string in the tree. No `serializeConversation` or `registerToolRenderer` call.
- Peer ranges are `*`. Dev dependencies are still `^0.84.4`, so `tsc` does not see `BeforeAgentStartEvent` as a union or `AgentSettledEvent.aborted`. That hides the two type changes above; it does not change runtime.

## Not worth a code change yet

The two follow-ups, if a later change touches those files:

- Teach `isCompletedParentTurn` to return false when `event.aborted === true`.
- Add the three exhausted-error phrases to the transient class, or confirm Pi always attaches a 5xx before settle.
