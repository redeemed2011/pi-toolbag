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

- Wait until Pi has given up (`agent_settled`), then `setModel` and send the class-specific continue message.
- Fail over after tools have started. Quota, timeout, and safety still hop. Auth, overflow, abort, an ordinary refusal, and `reasoning_extraction` do not.
- Do not write to stdout/stderr. Failover reports through `ctx.ui.notify`. The library emits structured events; this extension notifies only on a successful hop.
- After `/compact` or threshold compact, restore the preferred model unless a usage gate has not recovered by at least 20 points. A failed usage probe does not restore.
- Overflow compact that retries the same request stays on the current model. If that model later settles with a quota/402 error, failover runs on that settle (the compact handler itself does not switch).
- Before a prompt, a `usageGates` entry can switch off a model whose remote percent or token count is at or over the threshold. That hop does not send `continue`. A failed usage check stays on the current model and is notified. A later prompt returns to the preferred model when its percent is at least 20 points under the threshold. A 402 does not return while that cap still holds. The return does not send `continue` and resets the failover budget.

```json
"usageGates": [
  {
    "provider": "grok-cli",
    "metric": "percent",
    "threshold": 90,
    "source": "grok-cli"
  }
],
```

`source: "grok-cli"` is weekly percent, not a token count. The model must already be in a chain; the gate does not invent a hop. `grok-cli/grok-build` is not in the default chain, so add it there if you want that model capped too.
