# pi-fallback-lib

Same-session cross-model failover for Pi. Pure decision kernel plus one `attachFallback` helper.

Consumers:

- [`pi-auto-fallback`](../pi-auto-fallback) — interactive extension (`retryAfterTools: false`)
- [`pi-ctx`](../pi-ctx) `worker.ts` — observer worker (`retryAfterTools: true`)

Not published. Depend via `"pi-fallback-lib": "file:../pi-fallback-lib"`.

```bash
cd pi-fallback-lib
npm install
npm test          # Gherkin features in features/ + vitest
npm run typecheck
```

Callers resolve `auto-fallback.json` with `getAgentDir()` and pass a parsed object or an absolute path. This package never hard-codes `~/.pi/agent`. Missing or invalid config is fail-closed (no chain invented).

Failover runs only after Pi has given up (`agent_settled`). Classifier includes 402/quota/balance plus transients; it does not use Pi’s `isRetryableAssistantError`. Re-issue is `setModel` plus the constant `"continue"`.
