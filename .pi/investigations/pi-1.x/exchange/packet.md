# Findings to vet

Source: pi-extensions ctx, parent question `73dfede8-262d-4d87-b8c1-a3420a24cf53`. Decision `b2635000-d9b4-42e9-bfb5-82c0557c56ae` sets the order. Installed Pi is `@earendil-works/pi-coding-agent` 1.2.0.

## Order

1. Honor `agent_settled.aborted` in ctx pending-replace. Question `6c547a2e-2fc4-4c14-81f6-3c18ef9ec49e`.
2. Remove the print/JSON continuation poll inside `agent_settled`. Question `3048832a-2c59-473e-82a7-2cbb86f10890`.
3. Test post-compaction custom resumes with fallback and usage gates. Question `a6020775-5989-4982-9d12-a3ced04a8589`.
4. Test tool grouping in fullscreen and regular. Use `registerToolRenderer`, `durationMs`, and `outputPad` where they fit. Grouping adjacent components still needs the deeper UI integration. Herdr can show the UI. Question `854ae9d7-7828-4a2b-8ea2-6fb1d1f2d7ec`.
5. Typecheck against Pi 1.x. Dev dependencies still say `^0.84.4`. Question `788fb939-c2e7-49a9-9142-bce0064e7007`.

Later, not in that order: structured ctx tool results (wanted). Question `4f2ecbd3-c9f0-4161-a969-d83cbc9f9aad`.

## Claims

1. `pi-ctx` `isCompletedParentTurn` does not read `event.aborted`. A cancelled start can count as a finished parent turn when no aborted assistant was written. Pi 1.1 added the flag. `branchEndedDead` only checks the last assistant `stopReason`.

2. `pi-fallback-lib` `waitForContinueTurn` runs inside the `agent_settled` handler in print/JSON mode. Current Pi defers `prompt()` and `sendCustomMessage(..., { triggerTurn: true })` while `_isEmittingAgentSettled` is true, and runs `_deferredSettledActions` only after every settled handler returns. The wait can spend 30s idle and emit `continue-did-not-start` for a run the handler is holding. This deferral is in the 1.2.0 `agent-session.js` and the behavior dates from 0.87.

3. After mid-run compaction, `pi-ctx` `registerCompactionTrigger` sends `CTX_RESUME` with `triggerTurn: true`. Pi 1.2 runs that through `before_agent_start` like a user prompt. `pi-fallback-lib` then applies usage gates and return-to-preferred. Whether that is desirable is open.

4. `pi-tool-groups` depends on private transcript structure. Pi 1.0 fullscreen is the default. `registerToolRenderer` (1.0.1) may replace a private result-renderer patch. It does not group adjacent components. `durationMs` and `outputPad` (1.1) can show recorded time and configured padding.

5. Package devDependencies are `^0.84.4`, so typecheck does not see the 1.x event union or `aborted`.

6. `pi-ctx` `observer-trigger.ts` throws when `exit.code !== 0` before `readObserverResult`. Pi 1.2 print mode exits 1 when the final response is cut at the output limit. Observations written before that truncated confirmation would be dropped. This needs an explicit test.

7. Foundations already sends `deliverAs: "followUp"` when `ctx.isIdle()` is false. Low risk.

8. Stream-stall ends silence. Pi's Mistral fix only stops the request timeout from aborting a live stream after headers. The watchdog stays.

9. No `azure` string in toolbag. The 1.0.3 rename is unlikely to matter unless a live config still says `azure-openai-responses`. Pi 1.2 OpenRouter lists are per key. Catalog presence does not prove the current key can call the model.

10. Ctx tools return JSON text. Structured results, namespaces, and annotations could drop codemode parsing and mark read versus mutation. Wanted later.

11. Virtual model routing is not a fallback replacement. Failover reads `ctx.model`, which can be the virtual selection rather than the physical model that failed.

## agent1 vet

See `r1-agent1-vet.md`.
