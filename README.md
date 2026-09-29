# pi-toolbag

Pi extensions and the library they share.

| Path | What |
|---|---|
| `pi-ctx/` | Agent memory. Session inject is default on. Project law starts only after an explicit bind. |
| `pi-auto-fallback/` | Same-session cross-model failover for the interactive session. |
| `pi-fallback-lib/` | Failover kernel. Not an extension. Both packages above depend on it. |

## Install

```bash
pi install git:github.com/redeemed2011/pi-toolbag
pi remove npm:pi-auto-fallback
```

That loads both extensions. To load one, narrow `extensions` on that source in `~/.pi/agent/settings.json`. An empty array loads neither. Do not also install `npm:pi-auto-fallback`. Both would call `setModel` and send `continue`.

`pi install` runs `npm install --omit=dev` at this repo root. The workspace links `pi-fallback-lib`.

## Develop

```bash
npm install
npm test
npm run typecheck
```

Default `pi` on a cplt host is the sandboxed wrapper. Tests must not invoke it. See [pi-ctx/docs/sandbox.md](pi-ctx/docs/sandbox.md).

## Pickup

A new Pi session in this repo should read `AGENTS.md`, then `pi-ctx/AGENTS.md` for memory work or `pi-auto-fallback/README.md` for failover.
