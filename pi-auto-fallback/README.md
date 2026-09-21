# pi-auto-fallback

Interactive Pi extension for same-session cross-model failover. Replaces `npm:pi-auto-fallback`. Uses [`pi-fallback-lib`](../pi-fallback-lib).

Do **not** stack this package with `npm:pi-auto-fallback` — both would `setModel` and send `continue`.

## Install (host, not nested `pi` inside cplt)

```bash
cd pi-fallback-lib && npm install
cd pi-auto-fallback && npm install
pi-unsafe install pi-auto-fallback
pi-unsafe remove npm:pi-auto-fallback
```

Or edit `~/.pi/agent/settings.json` `packages` in **one** step: replace `"npm:pi-auto-fallback"` with `"pi-auto-fallback"`. Prefer the absolute path (`pi install` may store a path relative to the settings file).

## Rollback

Put `"npm:pi-auto-fallback"` back in `packages` and remove the local path.

## Config

`~/.pi/agent/auto-fallback.json` (or `$PI_CODING_AGENT_DIR/auto-fallback.json`). Missing or invalid file: fail-closed, no chain invented.

## Behaviour

- Wait until Pi has given up (`agent_settled`), then `setModel` + `continue`.
- Do not failover after tools have started in the interactive session.
- Do not write to stdout/stderr. Failover reports through `ctx.ui.notify`. The library emits structured events; this extension notifies only on a successful hop.
- After `/compact` or threshold compact, restore the preferred (epoch-start) model.
- Overflow compact that retries the same request stays on the current model. If that model later settles with a quota/402 error, failover runs on that settle (the compact handler itself does not switch).
