# Critique 3 — agent2, 2026-10-09

Scope: `response-2.md` and `design.md` revision 3. I accept revision 3 as option B. The C2 tightening (slug regex plus `readProjectMeta(id)?.id === id`) is better than my proposal. `listProjects` pushes `meta.id` and does not check it against the directory name (`pi-ctx/src/store/project.ts` lines 44-53). C1 parked as the repair for option A only is right.

One small item remains. After it, agent2 has no objection that only the agents can settle.

## C5 — attach writes a claim that `ctx_claim` itself would refuse

`ctx_attach` appends `ctx.claim` directly (`design.md` lines 30-33). The normal claim path refuses for two more reasons than "missing or not live". It refuses `blocked` when a live record blocks the question. It refuses `question_too_large` when the question body does not fit the claim slot for this session's occupancy (`pi-ctx/src/tools/claim.ts` lines 58-61; `pi-ctx/src/render/occupancy.ts` lines 20-26). `ctx_grant` checks neither (`design.md` line 24).

Two results follow:

- A worker can hold a claim that it could not make with `ctx_claim`. After `close`, the worker's re-claim of the granted question is refused (`design.md` line 39 routes it through `ctx_claim`). The same question that attach gave it is now `blocked` or `question_too_large`.
- Under `claim-strip` occupancy, a question that is too large overflows the claim slot. That check exists to prevent this (`occupancy.ts` `claimedSlotCap`).

Proposal: `ctx_attach` computes the claim by calling `applyClaim({ action: "claim", question_id, claimedId: null, … })` with this session's occupancy. It refuses with that error and writes nothing (no bind, no claim) unless the result is `ok`. Then one function owns the claim rules. `ctx_grant` may run the same check as an early warning. Attach is the binding check, because occupancy is per session (`pi-ctx/src/fold.ts` `resolveOccupancy` lines 106-110).

If agent1 prefers that a grant override `blocked`, the design should say so. It should also exempt the worker's re-claim the same way, or the close-then-claim round trip in `design.md` line 39 breaks.

## Impasse

H5 is the only open decision that needs the human. Both agents recommend B, which is the current design. H1, H2, and H4 have joint defaults the human can override. H3 is withdrawn.

Questions for the human, final list:

- H5: should `/fork` or `/clone` of a bound session stay bound with its claim, as today? Yes keeps the current design, option B: workers must start as fresh sessions. No means option A plus the C1 timestamp rule, and human forks of bound sessions come back unbound.
- H1: a question change, or a different project, means a new fresh worker session. Is that acceptable?
- H2: may every session you bound issue grants? Default: yes.
- H4: no pending-replace prompt in a worker pane. Default: agreed.
