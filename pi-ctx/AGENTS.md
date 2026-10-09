# ctx — agent pickup

Pi 0.84.4 extension in the pi-toolbag repo. Spec: agent memory — Pi spec (both injects) (not shipped in this repo). New session: read `HANDOFF.md`, then this file.
Goals and closed non-goals: `GOALS.md`. Read that before changing what ctx is for.

Do not reopen closed leftovers (15k/5k, cap/stub, stop-hook, Order-flip A, F-packer). The spec’s “PR 1–10” is a **local sequence**, not GitHub pull requests.

## Run

```bash
cd pi-ctx
npm test          # vitest; sets no real ~/.pi/ctx; never invoke the `pi` wrapper
npm run typecheck
```

Default `pi` is cplt. Details: [docs/sandbox.md](docs/sandbox.md). Tests use `CTX_HOME`. Project-law store is `~/.pi/ctx/projects/<id>/` and needs a host write grant. Observer model: live session (`getModel`) unless `ctx.models.observer` is set. Fallback is `auto-fallback.json` via `pi-fallback-lib` in `worker.ts`. Tests isolate `PI_CODING_AGENT_DIR`.
Before committing, run `npm test` from the pi-toolbag root. `npm test` in this directory is only the ctx suite.

## What exists

| Surface | Where |
|---|---|
| Extension factory | `index.ts` |
| Observer worker (no orchestrator hooks; in-process failover via `pi-fallback-lib`) | `worker.ts` |
| Compact inject (unbound / GE / CS) | `src/hooks/compaction-hook.ts`, `src/render/` |
| F-once A | `src/hooks/context-hook.ts`, `src/render/fonce.ts` |
| Tools | `src/tools/` — `ctx_get` `ctx_zoom` `ctx_frontier` `ctx_claim` `ctx_bind` `ctx_record` |
| Commands | `src/commands/ctx.ts` — on/off, compact, status, occupancy, bind, unbind, claim |
| Occupancy switch | `src/commands/occupancy.ts` — TUI GATE confirm; print refuse-with-reason |
| Bind HITL | `src/commands/bind.ts` (name + confirm; nested bind-consent harvest; no observation-promotion quiz). |
| Bind-consent promoter | `src/promoter/`, `promoter-worker.ts` — after attended bind; project `pending_replace`; HITL again after 3 settled parent turns (`agent_settled`), not tool rounds. |
| Mint GATE overflow HITL | `src/commands/record.ts` — TUI refuse-first `select` vs supersede/split; print `"gate"` |
| Mint live_conflict HITL | `src/commands/record.ts` — TUI `select` which to supersede; print `"live_conflict"` |
| Mismatch Banner | `src/render/banner.ts` — `MATCH`/`DIVERGED` + `n`; omit empty/stale/unstamped tail |
| Mint / refuse | `src/mint.ts` |
| Store | `src/store/` — `CTX_HOME` or `~/.pi/ctx` |

Print mode (`hasUI === false`): bind refuse; occupancy **switch** refuses with a reason (session stays on previous / default GE); mint GATE stays `"gate"`; mint live_conflict stays `"live_conflict"`.

## After compact

`cd pi-ctx && npm test`. Sequence 1–10 is in tree. Bind does not promote observations. GATE TUI is refuse-first `select`. Confirm with the user before coding held items.

## Next

Held / out of scope only (Spawn Envelope, packing leftovers). Do not invent Spawn Envelope. Do not reimplement shipped surfaces.
