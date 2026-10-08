# pi-fallback-lib

Same-session cross-model failover for Pi. Pure decision kernel plus one `attachFallback` helper.

Consumers:

- [`pi-auto-fallback`](../pi-auto-fallback) — interactive extension (`retryAfterTools: true`)
- [`pi-ctx`](../pi-ctx) `worker.ts` — observer worker (`retryAfterTools: true`)

Workspace dependency of this repo. Callers depend on `"pi-fallback-lib": "*"` and install from the repo root.

```bash
cd pi-fallback-lib
npm install
npm test          # Gherkin features in features/ + vitest
npm run typecheck
```

Callers resolve `auto-fallback.json` with `getAgentDir()` and pass a parsed object or an absolute path. This package never hard-codes `~/.pi/agent`. Missing or invalid config is fail-closed (no chain invented).

Failover runs only after Pi has given up (`agent_settled`). Classifier includes 402/quota/balance plus transients; it does not use Pi’s `isRetryableAssistantError`. Re-issue is `setModel` plus one continue message. Quota and transient say the previous model stopped, finished tool results must not be repeated, and the original request should be finished. Safety says the previous model was blocked, that approach must not be repeated, finished tool results must not be repeated, and the request should be finished a different way. The attach helper never writes stdout/stderr and never calls `notify`; it reports outcomes through `onEvent` (`FallbackEvent`). Callers that have a TUI use `ctx.ui.notify`.

A `usageGates` entry is checked in `before_agent_start`, before the request. `source: "grok-cli"` reads SuperGrok weekly `creditUsagePercent` from the billing endpoint (the same figure `/usage` rounds). `metric: "tokens"` needs an HTTPS JSON source and a dot `path`. At or over the threshold, attach `setModel`s to the next chain member that is not itself over a gate. It does not send `continue` and does not spend `maxFailoversPerRequest`. A failed probe stays on the current model. While on a fallback, a later prompt returns to the preferred model only when a percent gate is at least 20 points under its threshold. A failed return probe stays, including through a chapter-break compact. A 402 does not return while that cap still holds. The `continue` retry itself is not switched back. A return is `setModel` only and resets the failover budget. Held models are also skipped as error-failover targets. A chapter-break compact probes a gated preferred model and does not restore it unless that same 20-point rule passes. The check does not refresh OAuth tokens. Offline workers should pass `checkUsage: false`.
