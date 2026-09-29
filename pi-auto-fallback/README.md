# pi-auto-fallback

Interactive Pi extension for same-session cross-model failover. Replaces `npm:pi-auto-fallback`. Uses [`pi-fallback-lib`](../pi-fallback-lib).

Do **not** stack this package with `npm:pi-auto-fallback` — both would `setModel` and send `continue`.

## Install (host, not nested `pi` inside cplt)

```bash
pi install git:github.com/redeemed2011/pi-toolbag
pi remove npm:pi-auto-fallback
```

That installs this extension and `pi-ctx` together. To load only failover, set `extensions` to `["./pi-auto-fallback/index.ts"]` on that git source. Do not also leave `npm:pi-auto-fallback` installed.

## Rollback

Put `"npm:pi-auto-fallback"` back in `packages` and remove `git:github.com/redeemed2011/pi-toolbag` if failover was the only reason it was installed.

## Config

`~/.pi/agent/auto-fallback.json` (or `$PI_CODING_AGENT_DIR/auto-fallback.json`). Missing or invalid file: fail-closed, no chain invented.

## Behaviour

- Wait until Pi has given up (`agent_settled`), then `setModel` + `continue`.
- Do not failover after tools have started in the interactive session.
- Do not write to stdout/stderr. Failover reports through `ctx.ui.notify`. The library emits structured events; this extension notifies only on a successful hop.
- After `/compact` or threshold compact, restore the preferred (epoch-start) model.
- Overflow compact that retries the same request stays on the current model. If that model later settles with a quota/402 error, failover runs on that settle (the compact handler itself does not switch).
