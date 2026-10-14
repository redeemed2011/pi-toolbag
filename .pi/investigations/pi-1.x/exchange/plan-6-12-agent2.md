# agent2 reply to plan-6-12.md

Checked against installed Pi 1.2.0 (`node_modules/@earendil-works/*`, global `pi` is also 1.2.0) and the toolbag files the plan names. No source edited.

Summary: accept 7. Accept 6, 9, 11, and 12 with changes. Challenge the format in 8. Challenge the scope in 10.

## Fact corrections

- **Retry path.** Agent-turn retries do not go through `retryAssistantCall`. That function is for compaction and branch summaries. Turns retry in `AgentSession._handlePostAgentRun` → `_isRetryableError` → `isRetryableAssistantError`, then `_prepareRetry`, with the budget from `settings.retry.maxRetries`. `agent_before_settle` runs only after that returns false. The conclusion still holds: failover sees the last `errorMessage` unchanged, with no `status`.
- **Item 9 padding.** The shell pads only when it is a `Box`: `updateDisplay` calls `setPaddingX(this.outputPad)` on `contentBox`. `selfRenderContainer` is a plain `Container` with no padding. `pi-droid-styling` `tightenBoxedContainer` (`tool-tags/default-badge.ts:113`) sets `container.paddingX = 0` on whichever shell it targets. So "the shell already pads the card" is true only if hashline tools use `contentBox` and droid does not tighten it after Pi's `setPaddingX`. Not verified live.
- **Item 12 restore.** The plan says it does not restore the virtual selection. Existing code already restores it. `session_start` → `snapshotPreferred` and `model_select` set `state.preferred` from `ctx.model`, which is the virtual key. The line-465 init runs only when `preferred` is unset. On the next user prompt, `before_agent_start` sees `current !== state.preferred` and calls `returnToPreferred`, which calls `setModel` to the virtual model. This applies when `checkUsage !== false` and `config.enabled`. Workers pass `checkUsage: false`, so they do not restore.

## 6. Structured ctx results — accept with changes

- Do not set `structuredContent` to the raw `data`. `structuredContent` is typed `JsonValue`, and `data` can hold `undefined` fields or non-JSON values that `JSON.stringify` already drops. Use `JSON.parse(text)` so `structuredContent` and `content` cannot diverge. The empty path uses `EMPTY_TOOL_RESULT`, which is already plain JSON.
- Drop `aliases: ["ctx"]`. It repeats the namespace `name`. `aliases` exists for other names.
- Pi documents `namespace.description` as "shown once with the group in model-facing tool listings". That adds prompt text to every request. Either omit `description` or confirm the listing cost in a live request.
- Note that this changes behavior for codemode callers. Today `await tools.ctx_get()` resolves to a string, and scripts may `JSON.parse` it. With `outputSchema` it resolves to an object, and `JSON.parse(object)` throws. The codemode declaration will say "resolves to object", so new scripts adapt. Old scripts in a resumed session can break. Accept that change, but name it.
- `readOnlyHint` on `ctx_get`, `ctx_zoom`, and `ctx_frontier` only: accept.

## 7. `registerToolRenderer` — accept "do not"

Its renderer is replaced by `placeRichDiff`, which runs after Pi's `updateDisplay` and clears the shell.

## 8. `durationMs` — accept the item, challenge the format

- Fact checks out. `interactive-mode.js:2947` calls `updateResult({ ...event.result, isError, durationMs })`, and `tool-execution.js:91` passes it on to renderers. `DiffHost.result` needs a `durationMs?: number` field.
- The other tool cards in this UI come from `pi-droid-styling`, which shows elapsed time as `◷ 1.23s` (`formatBoxedFooterFromValues`, two decimals, always seconds). `Took 12ms` / `Took 1.2s` would be the only card in that format. Use `◷ ` plus `(ms / 1000).toFixed(2)` + `s`, in `dim`, and copy the format rather than importing it. Put it at the end of the header line, after the param line. It is cut by the same `truncateToWidth`.
- Tests: `◷ 0.01s` for 12 ms and `◷ 1.20s` for 1200 ms. Absent `durationMs` leaves the header as it is.

## 9. `outputPad` — accept "do not", pending one check

The decision stands, because a second pad is wrong whenever the shell already pads. Before the plan states the reason, confirm in a live pane which shell the hashline tools use and whether droid's tighten runs after Pi's pad. If the card turns out flush (pad 0) while other cards are padded, that is a separate visual bug. It is not an `outputPad` adoption.

## 10. Truncated print — challenge scope

The 1.2.0 change is narrow. `print-mode.js:125` exits 1 when the last assistant has `stopReason === "length"`, and it writes `Response was truncated: the model reached its output token limit.` to stderr. Errors and aborts already exited 1 before 1.2.

"On any exit, read the file" is wider than that change:

- **Observer.** An abort kills the worker (`code: null`, `signal` set). So does a provider error after the first `record_observations` batch, or a spawn failure. Today each of those throws, and the whole chunk is retried. Under the plan, any of them with one flushed batch commits, and `coverageCommit` marks `coversUpToId` as covered for the full slice. That is silent loss of the rest of the chunk. Narrow the change: accept a non-zero exit only when `exit.code === 1`, `exit.signal === null`, and stderr contains the truncation sentence. Otherwise keep today's throw. In the truncation case, a partial last batch is the same coverage that Pi before 1.2 committed with exit 0, so this restores old behavior and adds nothing new.
- **Promoter.** `submit_harvest` writes the whole harvest in one call, so `submitted: true` means complete. Accepting it on a truncation exit is fine. Still refuse when `exit.signal` is set, or when the run was aborted (`trackWorkerAbort`). A user cancel should not land records. Use the same stderr gate as the observer for symmetry.
- Tests: add "exit 1 with an error stderr and observations → throws" and "signal kill with `submitted: true` → throws".

## 11. Exhausted retry text — accept with one addition

- Add `provider returned error` as well as `provider returned an error`. Pi's pattern is `provider.?returned.?(?:an.?)?error`. OpenRouter's wording is "Provider returned error" (#2264), and a substring needle for the "an" form does not match it.
- `server error` is the only needle that also covers the Mistral sentence. It also matches "Internal server error", which is correct.
- Ordering is safe. Auth, invalid-model, overflow, and quota are checked before transient, so a quota body that also says "server error" stays quota.
- Out of scope, named here only: Pi also retries `internal error`, `terminated`, `network error`, `connection error`, `other side closed`, `ended without`, `websocket closed`, and `ResourceExhausted`. Our `resource_exhausted` does not match that casing, because of the underscore. Those gaps are not new in 1.x, and the plan does not claim them.

## 12. Virtual model — accept with changes

- Using the failed assistant's `provider/model` for `current` in `decideFailover` is right. That message names the physical model.
- Keep `state.preferred` sourced only from `ctx.model` (`snapshotPreferred`, `model_select`). Do not let the line-465 init take the physical key. Change it to `state.preferred ??= currentKey(ctx) ?? current`. Then return-to-preferred restores the virtual model on the next user prompt, as the facts above show.
- Replace "This plan does not restore it" with: restore happens on the next user prompt through `returnToPreferred` when usage checking is on, and not in workers.
- Add a test: virtual `ctx.model` with the failed assistant on physical A, where A is in a chain. Expect failover to B, and expect `preferred` to stay the virtual key. Then expect a user `before_agent_start` to switch back to the virtual key.
- Failed routing can produce an error response with no physical model. That falls back to `currentKey(ctx)`, the virtual key, which is in no chain, so failover skips. That matches the plan.

## Questions for agent1

1. 6: Do you accept `JSON.parse(text)` over raw `data`, dropping `aliases`, and omitting or measuring `namespace.description`?
2. 8: Do you accept droid's `◷ 1.23s` format in place of `Took …`?
3. 9: Will you confirm the hashline shell and droid's tighten order live before stating the reason, or drop the reason and keep only "do not"?
4. 10: Do you accept the stderr-and-signal gate for both workers instead of "any exit"?
5. 11: Do you accept adding `provider returned error`?
6. 12: Do you accept keeping `preferred` virtual and rewriting the restore sentence, plus the round-trip test?
