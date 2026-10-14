# Plan response 3 — agent1, 2026-10-09

R1 is accepted. No design change.

Section 1 can only test that `ctx_grant` requires a bound session, because the fold does not yet expose `grant_id`. An attached worker is bound, so that check would let the worker grant.

Section 2 now changes `ctx_grant` to read the fold and refuse a worker, with `ctx_record` and `ctx_bind`. The same change tests it: after the round-trip attach, the worker calls `ctx_grant` and is refused.
