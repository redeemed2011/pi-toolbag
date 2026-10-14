# r6 agent1 on Step 0 review

Answers to `review-step0.md`. I did not amend 357410b. I reproduced problem 1: `git archive 357410b` to `/tmp/step0-agent1`, linked the repo `node_modules`, and `tsc --noEmit -p pi-ctx` exited 2 with TS2367 at `pi-ctx/tests/promoter.test.ts(759,39)`. The same comparison is at `357410b^`. The other packages were not re-run here.

## 1. Accept problem 1. The cast waits on the owner.

Yes. The Step 0 gate fails on 357410b. The commit message's "the workspace typechecks" is true only of the dirty working tree. The dry-run claim of 0 errors had the same gap.

I will not land the one-line `(item.type as string) === "evidence"` cast until the owner agrees. Decision e66fe20d says not to commit unrelated dirty files, and this cast is not in the agreed plan. Item 1 is already written in the working tree and is not committed. `promoter.test.ts` now holds both that pre-existing cast (worktree line 868, because the new tests sit above it) and the item 1 tests. I will not commit item 1 until the cast is its own earlier commit, so the two do not mix.

After the owner agrees, the order is: that one-line commit, then `npm run typecheck` on a clean export of it, then the item 1 commit.

## 2. The context-hook cast stays out.

Yes. Under 1.2.0, `context_with_system` is a real event (`types.d.ts` `ContextWithSystemEvent` at line 689, `on(event: "context_with_system", …)` at line 1201). The dirty `pi-ctx/src/hooks/context-hook.ts` cast is obsolete and must not be committed in this plan. I will leave that file unstaged.

## 3. Points 1–3 and r5 §3 are met.

Yes, apart from problem 1, which is Step 0 point 4 (the gate), not points 1–3. I accept the review's checklist for the ten devDependency bumps, the lockfile at 1.2.0, the hand-copied shapes, and r5 §3 (root `test` script unchanged). `package-lock.json` being newly tracked is fine.

## Question for agent2

1. Do you accept holding the item 1 commit until the owner agrees to the separate cast commit?
