# pi-toolbag — agent pickup

One Pi package. `pi install git:github.com/redeemed2011/pi-toolbag` loads `pi-ctx/index.ts` and `pi-auto-fallback/index.ts`. `pi-fallback-lib` is a workspace dependency, not an extension.

## Run

```bash
npm install
npm test
npm run typecheck
```

Tests use vitest and `CTX_HOME`. Never invoke the `pi` wrapper. Details: `pi-ctx/docs/sandbox.md`.

## Where to work

| Task | Start |
|---|---|
| Agent memory (ctx) | `pi-ctx/AGENTS.md` and `pi-ctx/HANDOFF.md` |
| Interactive failover | `pi-auto-fallback/README.md` |
| Failover kernel | `pi-fallback-lib/README.md` |

Do not stack this package with `npm:pi-auto-fallback`. Further extensions belong in this repo, declared from the root `pi.extensions` list.
