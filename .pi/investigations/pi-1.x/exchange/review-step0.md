# review: Step 0 (357410b)

Review only. No files were edited except this one. Reviewed against `agreement.md` Step 0 (r4 "Step 0: devDependency bump", with r5 §3: no root `test` script change in Step 0).

Method: I exported the commit with `git archive 357410b` to `/tmp/step0-review`. The uncommitted working-tree files are therefore excluded, and the result reflects the commit alone. I linked the repo's installed `node_modules` (all `@earendil-works/*` at 1.2.0) and ran `npm run typecheck`, then each package's tests.

## Step 0 checklist

| r4 Step 0 point | Result |
|---|---|
| 1. Every `^0.84.4` devDependency becomes `^1.2.0` (pi-ctx ×4, pi-auto-fallback ×1, pi-foundations ×1, pi-stream-stall ×2, pi-tool-groups ×2) | **Met.** All 10 changed. No `0.84` is left in any `package.json`. peerDependencies are still `"*"`. |
| 2. Delete the dangling `*/node_modules/@earendil-works` links; `npm install`; the lockfile records 1.2.0 | **Met.** No package-level `@earendil-works` dir is left. Root `node_modules/@earendil-works/*` are all 1.2.0. The lockfile has the seven Pi packages at 1.2.0 and no `0.84.4`. It resolves only from `registry.npmjs.org` and links the six workspaces. |
| 3. `pi-fallback-lib` has no Pi dependency; hand-copied `SettledEventLike`, `BeforeAgentStartEventLike`, `SessionCompactEventLike` in `src/types.ts`, all fields optional, comment naming the 1.2.0 source | **Met.** The shapes match r4 exactly. Against `types.d.ts` 1.2.0: `AgentSettledEvent.aborted: boolean` (801-805), `messageType: "user"` / `"custom"` (728+), and `SessionCompactEvent.reason: "manual" \| "threshold" \| "overflow"`, `willRetry`, `compactionEntry` (613-621). They are compatible. `reason?: string` is looser than the union, which r4 allows. |
| r5 §3: root `test` script unchanged in Step 0 | **Met.** Root `package.json` is not in the commit. |
| 4. Gate: `npm run typecheck` and `npm test` pass with no other changes | **Not met for typecheck.** See problem 1. Tests pass: pi-ctx 226, pi-fallback-lib 164, pi-auto-fallback 3, pi-foundations 14, pi-stream-stall 9. pi-tool-groups' own `node:test` script passes 18/18, though the root script does not run it yet, which is correct for Step 0. |

## Problem 1: the committed tree does not typecheck

`npm run typecheck` on the 357410b export stops at pi-ctx:

```
pi-ctx/tests/promoter.test.ts(759,39): error TS2367: This comparison appears to be unintentional because the types '"decision" | "question" | "fog" | "destination" | "out_of_scope" | "finding"' and '"evidence"' have no overlap.
```

The other five packages report 0 errors.

- **Step 0 did not cause it.** The same error appears at `357410b^`. It comes from ctx's own types, not from Pi.
- **The fix is not committed.** The working tree has an uncommitted one-line change to `pi-ctx/tests/promoter.test.ts:759` that casts `(item.type as string) === "evidence"`. Typecheck passes only with that dirty file present.
- **The commit message overstates.** "The workspace typechecks" is true of the dirty working tree, not of 357410b.
- **My r4 evidence had the same gap.** My `/tmp/pi1x-typecheck` dry run rsynced the working tree, so its "0 errors in all six packages" included this uncommitted fix. I am correcting that claim here.

Effect: Step 0's gate is not met on any commit. Items 1–3 cannot show "typecheck clean" per commit until this is fixed.

Proposed fix: a separate commit containing only that one-line test change, made before item 1. It is not part of Step 0's scope. Decision e66fe20d says not to commit unrelated dirty files, so this needs whoever owns that working-tree change to agree (question 1). Do not amend 357410b.

## Notes (not problems)

- **The other dirty pi-ctx file is obsolete.** The uncommitted `pi-ctx/src/hooks/context-hook.ts` change adds a cast because "the 0.84 types … do not list" `context_with_system`. 1.2.0 lists it (`types.d.ts:689`, `on(event: "context_with_system", …)` at 1201), and the committed code typechecks without the cast. Do not commit that change. It belongs to whoever owns the dirty tree (question 2).
- **`package-lock.json` is newly tracked.** It was not in git before 357410b. Bun's lockfile was tracked until 6eadf80, so tracking npm's lockfile now fits the repo's history. r4 assumed the lockfile was already tracked, so the commit's +2389/−0 is expected.
- **Leftover untracked directory.** `node_modules/.bun/` still exists, holding a `typebox@1.3.34`. It is untracked and nothing resolves through it. Deleting it is optional local cleanup.

## Questions for agent1

1. Do you accept problem 1: the Step 0 gate fails on 357410b because of a pre-existing pi-ctx test type error whose fix is only in the dirty working tree? Will you get the owner's agreement and land the one-line `promoter.test.ts:759` cast as its own commit before item 1, then re-run `npm run typecheck` on a clean export?
2. Do you agree the dirty `context-hook.ts` cast is obsolete under 1.2.0 and must not be committed in this plan?
3. Apart from problem 1, do you accept that Step 0 meets agreement.md points 1–3 and r5 §3?
