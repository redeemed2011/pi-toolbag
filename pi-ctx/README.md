# ctx — Pi agent memory

Pi 0.84.4 extension. **Session inject** (observers + model-free compact inject) is **default on**. **Project law** (shared append-only records) starts only after an explicit bind to a named, machine-global project.

Occupancy: **Gated Edge** default, per-session switch to **Claim Strip**. Both renderers ship. Spec: agent memory — Pi spec (both injects) (not shipped in this repo).

The spec’s “PR 1–10” is a **local implementation sequence**, not GitHub pull requests.

## Status (2026-09-14)

Shipped: local sequence **1–10** — session inject (observers + model-free compact inject); fold; both occupancy renderers; F-once **A**; tools `ctx_get` `ctx_zoom` `ctx_frontier` `ctx_claim` `ctx_bind` `ctx_record`; `/ctx bind` `/unbind` `/claim`; confirm-only promotion; per-writer JSONL; mint refuse path; occupancy-switch GATE warn + print refuse-with-reason; golden slot-table inject tests; `sendGuardTokens` on compact-trigger live usage; mint GATE overflow HITL (TUI refuse-first `select`); mint `live_conflict` TUI `select`; promotion mint uses `runRecordFlow`; Mismatch Banner + Directive Off-Window; sequence 9 tests (Pi `estimateTokens` identity, observer cannot mint judgments, enabled compact hook never `undefined` except off/passive, no `search_similar`). Spawn Envelope held.

Do not reopen closed leftovers (packing 15k/5k, suffix cap/stub, stop-hook evaluator, Order-flip A, F-packer).

**Next:** sequence 1–10 is in tree; remaining is held / out of scope. After compact: `cd pi-ctx && npm test`, then confirm with the user before coding held items. Pickup: `AGENTS.md` and `AGENTS.md`.

## Install (development)

```bash
cd pi-ctx
npm install
npm test
```

Load without installing into `~/.pi/agent/extensions`:

```bash
pi-unsafe -e pi-ctx/index.ts
```

Default-on for every session (spec path): symlink or copy this directory to `~/.pi/agent/extensions/ctx/` so `index.ts` is auto-discovered. That write is **outside** the cplt jail (extensions is host-persistence). Do it on the host, not from a sandboxed agent.

Project-law store: `~/.pi/ctx/projects/<id>/`. The stock Pi cplt profile does not grant that path. See [docs/sandbox.md](docs/sandbox.md).

## Configuration

Observer model, in order: explicit `ctx.models.observer` → the **live session** model (`getModel` / thinking level) → Pi `defaultProvider` / `defaultModel` → last-resort OpenRouter GLM.

The worker uses the same `~/.pi/agent/auto-fallback.json` as the main session (`pi-fallback-lib`, `retryAfterTools: true`). Pin only if you want observers off the chat model:

```json
{
  "ctx": {
    "models": {
      "observer": { "provider": "xai", "id": "grok-4.6", "thinking": "low" }
    }
  }
}
```

`PI_CTX_PASSIVE=1` disables clocks.

## Test

```bash
npm test                     # unit + sandbox probe; no LLM, no nested pi
npm run typecheck
bash scripts/check-sandbox.sh
```

**Default `pi` is cplt-sandboxed.** Tests must not use it. Details and the live-Pi recipe: [docs/sandbox.md](docs/sandbox.md). Tests that write a store set `CTX_HOME`.

## Commands

| Command | Purpose |
|---|---|
| `/ctx off` `/ctx on` | Per-session gate (default on) |
| `/ctx compact` | Force compact; still model-free inject |
| `/ctx status` | Bound?, occupancy, claim, GATE flags, observer inflight |
| `/ctx occupancy` | `gated-edge` \| `claim-strip` (print refuses a switch with a reason; TUI confirms if target would `gate=1`) |
| `/ctx bind` / `/ctx unbind` | Project law: name HITL, confirm, promotion pass |
| `/ctx claim` | HITL claim / re-claim / close |

Named tools: `ctx_get`, `ctx_zoom`, `ctx_frontier`, `ctx_claim`, `ctx_bind`, `ctx_record`. Print mode refuses HITL bind/promotion (no silent bind). Mint GATE overflow: print refuses `"gate"`; TUI refuse-first `select` vs supersede/split. Promotion uses the same record flow. Mint `live_conflict`: print refuses; TUI `select` which to supersede.

## Layout

Matches the spec §5.10 package layout.

- `index.ts` — orchestrator (hooks + commands + tools)
- `worker.ts` — observation-only; no compact / observer-clock hooks. In-process failover via `pi-fallback-lib` (`retryAfterTools: true`). Spawn stays `--no-extensions -e worker.ts`. If the observer's fallback chain needs an extension provider (e.g. `npm:pi-grok-cli` for `grok-cli/*`), that installed package is also passed as an extra `-e` so `setModel` can find it. Failover logs are worker stderr only; the parent ignores worker stderr unless the process exits non-zero. In print mode the attach helper waits for the continue turn so Pi does not exit 1 on the failed model’s assistant error.
- `src/render/` — unbound, Gated Edge, Claim Strip, pack, F-once A
- `src/tools/` — LLM-visible pull/writes
- `src/store/` — `CTX_HOME` / `~/.pi/ctx`, per-writer JSONL, `project.json`
- `src/commands/bind.ts` — shared bind HITL used by `/ctx bind` and the `bind` tool
- `src/commands/occupancy.ts` — per-session occupancy switch (TUI GATE warn; print refuse)
- `src/commands/record.ts` — mint GATE overflow HITL (print `"gate"`; TUI refuse-first `select` vs supersede/split) and `live_conflict` TUI `select` (print `"live_conflict"`)
- `src/render/banner.ts` — Mismatch Banner (`MATCH`/`DIVERGED`; omit empty/stale/unstamped tail)
