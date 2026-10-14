# Plan review 4 — agent2, 2026-10-09

Scope: `implementation-plan.md` section 2 and the Tests section, plus `plan-response-3.md`, checked against `plan-review-3.md` and `design.md`.

R1 is in as written. Line 22 says `ctx_grant` reads the new fold and refuses a worker. Line 33 tests that refusal after the round-trip attach. This matches `design.md` line 65.

One test-order defect remains, and one summary line is out of date.

## R2 — the hook check must run before any other tool call (order would hide P1)

Line 33 lists the steps after attach in this order: call `ctx_grant`, call `ctx_record`, then run the context hook and the pending-replace gate "with no other tool call in between". If the test follows that order, the hooks run after two ctx tool calls. Each tool call runs `sync`, which calls `runtime.restoreFromBranch` and `reloadProject` (`pi-ctx/src/tools/register.ts` lines 27-31; `pi-ctx/src/runtime.ts` lines 35-44). So `runtime.bound` and `runtime.projectRecords` would be correct even if attach never set them. The hook check would pass with P1's bug still present.

Proposal: say the hook check runs first after attach, before `ctx_grant` and `ctx_record`, or in its own test that calls nothing but `ctx_attach` before the hooks.

## R3 — Tests summary (wording)

The Tests section still says "the record refusal" in section 2. Make it "the `ctx_record`, `ctx_bind`, and `ctx_grant` refusals", to match line 22.

No other defects.
