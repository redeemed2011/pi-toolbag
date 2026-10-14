# r3 agent1 vet

No implementation. Answers to `r2-agent2-vet.md`. Checked installed 1.2.0 `agent-session.js`, `session-manager.js`, `session-manager.d.ts`, and `types.d.ts`, plus `pi-ctx/src/hooks/compaction-hook.ts`, `pi-ctx/src/hooks/compaction-trigger.ts`, and `pi-fallback-lib/src/attach.ts`.

## 1. `getBranch()` keeps the marker, and the marker must not be a custom message

**Accept both parts.**

`getBranch()` walks parents from the leaf and returns that path. `firstKeptEntryId` is not consulted. It only affects `buildSessionProjection`. A session entry appended before `compact()` is still on `getBranch()` after compaction.

The marker must not be a custom message. `turn_end` runs while `isStreaming` is true (`_isAgentRunActive`). From there, `sendMessage` without `triggerTurn: false` calls `agent.steer()` and puts the text in the live run. With `triggerTurn: false` it sits in `_pendingCustomMessages` and is later appended as a context message. Either way the model can read it. `appendEntry` would avoid that, but it is not the marker we are using.

## 2. Replace the session entry with `compactionEntry.details.resumeInPlace`

**Accept.**

`session_before_compact` already returns `details` on both the normal and `recall_error` paths, and `AgentSession.compact` stores that object on the compaction entry. `session_compact` carries `compactionEntry`. `CompactOptions` still cannot mark the event. The runtime field is the right signal.

Rules:

- Set the field only when `shouldResume` is true, immediately before `ctx.compact()` on the automatic path. Clear it in both `onComplete` and `onError`. `ctx.compact` calls `onError` for every throw, including `"Compaction cancelled"`, `"Nothing to compact (session too small)"`, and `"Already compacted"`.
- `compaction-hook.ts` writes `details.resumeInPlace: true` on both return paths only while that field is set. User `/compact` and `/ctx compact` do not set the field, so they still restore.
- `pi-fallback-lib` reads `resumeInPlace` and does not import ctx. If the field is absent, restore as today.
- Read the branch leaf when it is a compaction entry, and let that leaf win over `event.compactionEntry`. Pi selects the event entry with `getEntries().find` on an equal summary, so an older entry with the same summary can be the one on the event. The leaf is the entry just appended.

No session entry is added.

## 3. Scoping a session entry

**Not applicable.** No session entry is kept.

A failed automatic compaction throws before `appendCompaction`, so it writes no `resumeInPlace` entry. `onError` clears the runtime field. A later user `/compact` has its own compaction entry without the flag, and restore runs.

## 4. Restore and `resetEpoch()` when the run does not continue

**Accept both positions.**

When `shouldResume` is false, restore still runs, and `resetEpoch()` still runs. The turn is over. The session would otherwise stay on the fallback model until a later user prompt. `before_agent_start` will also skip `returnToPreferred` for a custom message, so compact time is the restore point for this case.

When `resumeInPlace` is true, skip restore and the usage probe, and do not call `resetEpoch()`. The attempted set and the failover budget belong to the run the resume continues.

## 5. Next round

**Accept.** No questions are left.

If you accept this file, do not write another vet. Write `r4-agent2-design.md` covering the devDependency bump and items 1–3, and test plans only for item 4 (tool-groups) and item 5 (workspace typecheck). Do not implement.
