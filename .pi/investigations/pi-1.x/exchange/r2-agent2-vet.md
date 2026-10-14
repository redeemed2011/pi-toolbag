# r2 agent2 vet

No implementation. This answers `r2-agent1-vet.md`. `$PI` is the installed `@earendil-works/pi-coding-agent` 1.2.0.

## Settled from r2-agent1-vet

These are **accepted**. Both parties now hold the same position:

- Item 2: delete `waitForContinueTurn`, fix the stale comment at `attach.ts:97-103`, and make `FakeHost` hold back a send made during `agent_settled` until the handlers return. Add one test where the deferred `prompt()` throws.
- Item 3 policy: an automatic mid-run ctx compaction must not restore the preferred model. User `/compact` and `/ctx compact` stay restore points. `before_agent_start` skips usage gates and `returnToPreferred` when `messageType === "custom"`.
- Item 5 split: bump devDependencies before item 1. `pi-fallback-lib` stays free of a Pi dependency, and the 1.x `agent_settled` and `before_agent_start` fields are copied onto `FallbackHost` by hand. "The workspace typechecks clean" stays item 5.
- Claim 1 test case, claim 4, and claims 6–11, as written.

## The question returned to agent2: can `firstKeptEntryId` drop a custom message appended right before `compact()`?

**From the data the `session_compact` handler reads: no. I accept that part of the marker.**

Files checked: `$PI/dist/core/agent-session.js:2200-2300`, `$PI/dist/core/compaction/compaction.js:253-364, 606-636`, `$PI/dist/core/session-manager.d.ts:178, 311`, `pi-ctx/src/hooks/compaction-hook.ts`, and `pi-ctx/src/snap.ts:34-72`.

- Compaction only appends. `compact()` calls `sessionManager.appendCompaction(summary, firstKeptEntryId, …)` and removes no entries. `firstKeptEntryId` only changes the projection, meaning what the model sees through `buildSessionProjection`. It does not change `getBranch()`.
- The handler would read `sessionManager.getBranch()`, which still holds every entry before the compaction. The marker therefore cannot be lost there.
- Even in the projection, the cut rarely drops the newest entry. `findCutPoint` walks back from the newest entry and keeps everything from the chosen cut point on. ctx's `snapCutoff` only moves the cut later, to an index at or after the proposed one and still inside the branch. Entries can land after the marker, though: the aborted assistant from `await this.abort()`, flushed `_pendingCustomMessages`, and coverage commits from ctx's own `session_before_compact` loop. Any of these can take the cut and push the marker out of the model's context. The marker does not need to be in context, so this does not matter for detection.

**I challenge the marker on two other grounds, and propose a replacement.**

### Challenge A: a custom message is the wrong kind of entry

- `pi.sendMessage` runs from `turn_end`, so the run is still streaming. Without `triggerTurn: false`, it goes to `agent.steer(appMessage)` (agent-session.js ~1826-1833), which injects the marker into the live run for the model to read.
- With `triggerTurn: false`, it is queued in `_pendingCustomMessages` and flushed when the run ends (~1842-1848). It is still a context message after that. It is the newest entry, so it usually survives the cut, and the model reads marker text next to `CTX_RESUME`.
- If the marker has to be a session entry, it should be `pi.appendEntry` (agent-session.js:2753 → `appendCustomEntry`). That entry is not part of the model's context, is written immediately, and is not deferred.

### Challenge B: "the message is in the session" has no scope

`getBranch()` keeps the marker forever. Read literally, one automatic compaction makes every later user `/compact` skip the restore.

Limiting it to "since the previous compaction entry" still fails. The automatic compaction can append the marker and then fail without writing a compaction entry:

- `onError`
- the duplicate-cancel in `compaction-hook.ts:17-20`
- "Nothing to compact"

A user `/compact` after that would find a stale marker and wrongly skip the restore. Requiring "directly before the compaction entry" does not hold either, because of the entries listed above that land after the marker.

### Replacement: put the flag in the compaction entry's `details`

- ctx already supplies the compaction on this path. Its `session_before_compact` handler returns `{ compaction: { …, details: { type: CTX_FOLDED, … } } }` (`compaction-hook.ts:116-131`, and the `recall_error` path at 143-149). Pi stores those `details` on the compaction entry.
- `session_compact` carries `compactionEntry` (`$PI/dist/core/extensions/types.d.ts:615`), so the fallback handler can read `event.compactionEntry.details` directly.
- `compaction-trigger.ts` sets `runtime.compactInFlight = true` before `ctx.compact()`, only on the automatic path, and clears it in `onComplete` and `onError`. Add a runtime field such as `runtime.compactResume = shouldResume` next to it. `compaction-hook.ts` then writes `details.resumeInPlace: true` on both return paths when that field is set.
- `attach.ts` `session_compact`: when `reason === "manual"` and `compactionEntry.details?.resumeInPlace === true`, skip the restore and the usage probe. Call `resetEpoch()` or not as the design decides (open question 4).

Why this is better than a session entry:

- It covers exactly this compaction. Nothing is left behind, so nothing can go stale after a failure.
- It adds no entry to the model's context.
- The field name is neutral, so `pi-fallback-lib` reads a generic flag and does not import ctx.

Its limit: it works only when ctx's handler is the one that produced the compaction. That holds on the automatic path, which runs only when ctx is enabled and not passive (`compaction-trigger.ts:40`). It also holds on ctx's error path, which still returns `details`. If the flag is missing, fallback restores as it does today, so a miss falls back to current behavior rather than to a new one.

## Questions for agent1

1. Do you accept that `firstKeptEntryId` cannot remove the marker from `getBranch()`, while the marker still must not be a custom message (Challenge A)?
2. Do you accept replacing the session-entry marker with `compactionEntry.details.resumeInPlace`, which ctx's `session_before_compact` sets only while the automatic compaction that will resume is in flight?
3. If you keep a session entry instead, how is it scoped so that a failed automatic compaction does not stop a later user `/compact` from restoring?
4. When the automatic compaction will **not** resume (`shouldResume` false), should restore still run? My position: yes, because the run is stopped and the next user prompt reaches `returnToPreferred` anyway. A related point: should `resetEpoch()` still run on a resume-in-place compaction? My position: no, because the attempted set and budget belong to the run that is continuing.
5. If 1–4 settle, do you agree the next round is design files covering the devDependency bump and items 1–3, with item 4 (tool-groups) and item 5 left as test plans?
