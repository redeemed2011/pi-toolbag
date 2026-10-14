# review: cast commit (db3a40b)

Review only. No source was edited, nothing was staged, and nothing was committed. I reviewed against `r10-agent1-step0.md` and `r9-agent2-step0.md` ("What each review will check: Cast commit").

**No problems found.** Item 1 may proceed under the r10 gate.

## Method

I made my own export, separate from agent1's: `git archive db3a40b` to `/tmp/cast-review-agent2`, with the repo's installed `node_modules` linked in. Uncommitted working-tree files are therefore excluded.

## Checks

| r9 / r10 check | Result |
|---|---|
| Parent is 357410b; 357410b not amended | **Met.** `db3a40b^` = `357410b8b60981bd20591b9b86c9aec474550219`. The log is `db3a40b` → `357410b` → `4aaa16a`. |
| Diff is exactly one line in `pi-ctx/tests/promoter.test.ts`, no other file | **Met.** `git diff 357410b db3a40b --stat`: 1 file, +1 −1. The line is `item.type === "evidence"` → `(item.type as string) === "evidence"`, which is identical to the working-tree hunk reviewed in r7. |
| `context-hook.ts` and `pending-replace-hook.ts` untouched | **Met.** `git diff --quiet 357410b db3a40b -- <both>` exits 0. Both are still unstaged in the working tree. Nothing is staged (`git diff --cached` is empty). |
| Counts equal 357410b (7 and 2) | **Met.** In the export's `promoter.test.ts`, `grep -c` gives `isCompletedParentTurn` 7 and `onPendingReplaceSettled` 2. |
| `npm run typecheck` 0 errors, all six packages | **Met.** Exit 0, and 0 `error TS`. This closes `review-step0.md` problem 1: the Step 0 gate now holds on a commit. |
| Root `npm test` passes | **Met.** pi-ctx 226, pi-fallback-lib 164, pi-auto-fallback 3, pi-foundations 14, pi-stream-stall 9. These match agent1's numbers. |
| (extra) pi-tool-groups' own `node:test` | Passes 18/18. Not yet in the root script, which is correct until item 4. |

## Other observations

- **The assertion still tests something.** Casting both sides to `string` keeps the runtime comparison identical. The test still asserts that neither `evidence` nor `constraint` items reach `parsed.shelf`. The cast only removes the compile-time "no overlap" error. The commit message says the same.
- **The working tree now holds only item 1 in this file.** `git diff -U0 pi-ctx/tests/promoter.test.ts` shows only the two item 1 hunks (`-14,0 +15` and `-648,0 +650,108`). The cast hunk is gone because it now matches HEAD. Item 1 can therefore be staged by whole file, with no `-p` split. `pending-replace-hook.ts` is the only other item 1 file, and `context-hook.ts` must still stay out.

## Questions for agent1

1. Do you accept that db3a40b passes every check in r9/r10 and that item 1 may now be committed?
2. For the item 1 commit, will you stage exactly `pi-ctx/src/hooks/pending-replace-hook.ts` and `pi-ctx/tests/promoter.test.ts`, never `context-hook.ts`, and then prompt agent2 with the hash for `review-item1.md`?
