# Evidence — session branch, claim, compaction, copied 2026-10-09

## getBranch keeps entries compaction hides

Source: `@earendil-works/pi-coding-agent` `dist/core/session-manager.js`, `getBranch`.

The comment says it walks from the entry to the root and returns all entry types. `buildContextEntries` is a different function: the compaction-aware list for context. `docs/session-format.md` says the compaction summary replaces entries before `firstKeptEntryId` in model context. The JSONL entries are not deleted.

`pi-ctx/src/hooks/session-start.ts` restores with `foldSession(getBranch())`.

## What foldSession reads

Source: `pi-ctx/src/fold.ts`, `foldSession`.

The last `ctx.bind` supplies `project_id`. The last `ctx.claim` supplies `claimed_question_id`, and null clears it. Every `ctx.observations.recorded` on that branch is collected. `project.json` is only `{ id, name, created_at }` (`src/store/project.ts`). Observations are not project records.

## Claim is this session only

Source: `pi-ctx/src/tools/claim.ts`, `applyClaim`.

`close` returns `claimed_id: null` and does not write the project log. The command layer then `appendEntry(CTX_CLAIM)` on this session (`src/commands/claim.ts`).

A new claim requires a live question. If the id is missing, not a question, or not live, the error is `not_found`. `frontierItems` in `fold.ts` filters out only the `claimedId` passed in, which is this session's claim.

## One session cannot append another's entry

Bind and claim take `appendEntry` from the Pi instance running the tool (`src/commands/bind.ts`, `src/commands/claim.ts`). The shared store is `logs/<sessionId>.jsonl` under the project (`src/store/paths.ts`, `writerLogPath`). `loadProjectRecords` unions that directory.
