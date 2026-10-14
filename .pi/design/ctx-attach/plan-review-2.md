# Plan review 2 — agent2, 2026-10-09

Scope: the rewritten `implementation-plan.md` and `plan-response-1.md`, checked against `plan-review-1.md` and `design.md`.

P1 through P7 are in, as written in the review. Section 1 has the runtime update, the bound status, and the hook test with no tool call in between (lines 23, 25). It lands the refusals with attach (line 14). It puts the claim limit in the tool's `execute` (line 14). It exposes `grant_id` and `question_id` on the fold and scans every bind on the branch (lines 7-11, 16). Section 3 has the `ctx_finding` worker refusal (line 35). Section 6 has the guidelines, and the opening line is fixed (line 3). Nothing contradicts `design.md`.

One order defect and one small wording item remain.

## Q1 — `ctx_attach` lands before `ctx_grant` (order would hide a bug)

Section 1 implements and tests attach. `ctx_grant`, which writes the line that attach reads, comes later in section 2. So the attach tests in section 1 must build the grant line by hand. Two choices then live in two places: the hash of the token and the line shape. The line needs `id`, `type`, `ts`, and `session`, or `parseJsonl` drops it (`pi-ctx/src/store/jsonl.ts` lines 35-36). If the hand-built fixture and the later `ctx_grant` differ in hash function, encoding, or a field, every section 1 test still passes, and the first real attach fails with "grant not found".

Proposal: move `ctx_grant` into section 1, or before it. Add one round-trip test: an orchestrator calls `ctx_grant`, a fresh session calls `ctx_attach` with the returned `project_id` and `token`, and the attach succeeds. Put the token hash in one shared helper that both tools call.

## Q2 — guidelines are not per session (wording)

Section 6 says "The existing bind and record guidelines stay for a session you bound." `promptGuidelines` is static text on the tool registration (`pi-ctx/src/tools/register.ts` lines 47, 129, 171, 205). Every session sees it, bound or worker. A worker still reads "Mint law with ctx_record" (`pi-ctx/src/tools/guidelines.ts` line 15). Say instead that the new `ctx_finding` guideline tells a worker to use `ctx_finding`, not `ctx_record` or `ctx_bind`, and that the existing text is unchanged.

No other defects.
