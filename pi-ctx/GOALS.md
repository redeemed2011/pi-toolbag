# ctx goals

A Pi extension that, by default, keeps a session coherent across compact cycles, and that shares append-only law only after an explicit bind to a named, machine-global, repo-independent project.

The long spec stays in the vault note "agent memory — Pi spec (both injects)". This file is the statement a later checkout can follow. It is not a copy of that note.

## Goals the code still has

- Session inject is default on. `PI_CTX_PASSIVE=1` and `/ctx off` are the off switches.
- Project law starts only after an explicit bind. The store is `~/.pi/ctx/projects/<id>/`, or `CTX_HOME`. Bind is HITL. Print mode refuses bind. Bind does not ratify observer notes.
- Compact inject is model-free, typed, and capped at 8000 tokens (`INJECT_CAP` in `src/render/estimate.ts`). F-once A adds that budget once, on the first model call after compact, and only when a project is bound.
- Tools are `ctx_get`, `ctx_zoom`, `ctx_frontier`, `ctx_claim`, `ctx_bind`, and `ctx_record`. There is no `search_similar`.
- Both occupancy renderers ship. Default is Gated Edge. A session may switch to Claim Strip. Print refuses a switch and gives a reason. The TUI confirms when the target would gate.
- One extension. Do not fork Pi.

## Non-goals — do not reopen

- Packing at 15k/5k, a suffix cap or stub, the stop-hook evaluator, Order-flip A, and F-packer.
- Spawn Envelope. Do not invent it.
- A third occupancy, or deleting either renderer.
- Growing the inject with the context window. The cap stays 8000.
- Observers minting judgment records.
- A missing `applies_to` becoming `all`. Mint refuses with `applies_to required`.
- Embeddings, `search_similar`, or a shared sqlite store.
- Silent bind, and a bind that turns observer notes into law.

## Held

Sequence 1–10 is in the tree. Confirm with the user before coding anything this file marks held.
