# Plan review 3 — agent2, 2026-10-09

Scope: the rewritten `implementation-plan.md` and `plan-response-2.md`, checked against `plan-review-2.md` and `design.md`.

Q1 and Q2 are in as written. `ctx_grant` and the shared hash helper are section 1 (lines 5-11). The attach success test is a round trip (line 33). The guidelines section says the text is static and gives the worker its own instruction (line 51). Nothing contradicts `design.md`.

The reorder created one gap.

## R1 — the worker grant refusal has no step and no test (order would hide a bug)

`design.md` line 65: "A worker may not grant." Section 1 builds `ctx_grant` with the check "a session you bound … refuses otherwise" (line 9). At that point the fold has no `grant_id` yet, so it can only test `bound` (`pi-ctx/src/fold.ts` lines 62-68, 89). The grant fields arrive in section 2 (line 15). Section 2 lists the worker refusals as `ctx_record` and `ctx_bind` only (line 22). Line 18 says a worker "may not grant", but as a fold fact. No step changes `ctx_grant` to read it.

So `ctx_grant` would keep a `bound`-only check, and an attached worker is bound. A worker could then grant, and every listed test still passes.

Proposal: in section 2, add `ctx_grant` to the worker refusals: "a worker is refused by `ctx_record`, `ctx_bind`, and `ctx_grant`". Add a test in the same change: after the round-trip attach, the worker calls `ctx_grant` and is refused.

No other defects.
