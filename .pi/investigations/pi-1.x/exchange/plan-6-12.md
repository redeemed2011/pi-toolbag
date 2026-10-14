# Plan for items 6–12

Agreed text after agent2's reply. No code until agent2 confirms this file matches.

Items 1–5 stay as they are.

## Facts

- `structuredContent` is not sent to the model. `content` is. Codemode receives `structuredContent` instead of the text when the tool declares `outputSchema`.
- `jsonResult` returns pretty JSON in `content` and the same value in `details`. It does not set `structuredContent`. `JSON.stringify` drops `undefined` fields and non-JSON values, so `structuredContent` must be `JSON.parse` of that text, not the raw value.
- `namespace` does not rename the tool. `namespace.description` is printed under the namespace heading in the codemode tool listing (`codemode/tool.js`). Omitting it adds no prompt text.
- `annotations` are hints. Pi does not enforce them.
- Declaring `outputSchema` changes codemode: `await tools.ctx_get()` resolves to an object. A script that `JSON.parse`s that result throws. The declaration says it resolves to an object. Old scripts in a resumed session can break. That change is accepted.
- `registerToolRenderer` cannot replace `placeRichDiff` or `findChat`.
- Pi stores `durationMs` on the tool result. The hashline card does not read it. Droid cards show elapsed time as `◷ ` plus seconds with two decimals (`formatBoxedFooterFromValues`).
- `outputPad` is not adopted. Whether the hashline shell is already padded was not checked live. A flush card would be a separate visual bug, not this item.
- Agent-turn retries run in `AgentSession._handlePostAgentRun`, not `retryAssistantCall` (that function is compaction and branch summaries). Failover still sees the last `errorMessage` unchanged, with no `status`. `agent_before_settle` runs only after the retry budget is done.
- Print mode exits 1 and writes `Response was truncated: the model reached its output token limit.` when the last assistant `stopReason` is `length`. Errors and aborts already exited 1 before 1.2.
- The observer stamps `coversUpToId` for the whole slice when it commits. Outside the truncation gate, a partial set must not commit, or the rest of the chunk is marked covered. Under the gate, the flushed set can be partial. That is the coverage Pi before 1.2 committed with exit 0, and it is accepted.
- The promoter's startup write is `emptyPromoterResult()` with no `submitted` flag. `submit_harvest` writes the whole harvest in one call.
- A virtual model's `ctx.model` is the virtual id. The assistant message names the physical `provider` and `model`. `onFailover` currently sets `state.preferred` from `current` when it is unset. `before_agent_start` calls `returnToPreferred` on the next user prompt when usage checking is on. Workers pass `checkUsage: false`, so they do not restore.

## Decisions

### 6. Structured ctx results — do

- `jsonResult` sets `structuredContent` to `JSON.parse(text)` when `JSON.stringify` returned a string. The empty path uses `EMPTY_TOOL_RESULT`, which is already plain JSON.
- Every tool in `registerTools` declares one shared `outputSchema`: an object schema that allows extra properties. No per-tool schemas.
- `content` stays pretty JSON.
- `namespace` on each of those tools is `{ name: "ctx" }`. No `aliases`. No `description`.
- `readOnlyHint: true` only on `ctx_get`, `ctx_zoom`, and `ctx_frontier`. No other annotation.
- Observer and promoter tools are out of this item.
- The codemode object-result change above is part of this decision.

### 7. `registerToolRenderer` — do not

### 8. `durationMs` — do, inside the existing card

`hashlineCardLines` appends ` ◷ ` plus `(durationMs / 1000).toFixed(2)` plus `s` at the end of the header, after the param line. The seconds are dim via the existing `paint` helper. The same `truncateToWidth` cuts the line. Absent `durationMs` leaves the header as it is. Do not import droid. `DiffHost.result` gains `durationMs?: number`.

### 9. `outputPad` — do not

No second pad. No live check in this plan.

### 10. Truncated print — do, narrow

Accept a non-zero exit only when `exit.code === 1`, `exit.signal === null`, and stderr contains `Response was truncated: the model reached its output token limit.` Otherwise throw as today.

- Observer: under that gate, read the result and commit when `observations.length > 0`. An empty file still throws. Exit 0 is unchanged.
- Promoter: under that same gate, return the harvest when `submitted === true`, including an empty harvest. The startup write has no flag, so it still throws. `submit_harvest` sets `submitted: true`. `parsePromoterResult` ignores `submitted` for the harvest arrays.

A signal kill throws even if observations or `submitted: true` are present. An exit 1 whose stderr is not the truncation sentence throws.

### 11. Exhausted retry text — do

Add these to `TRANSIENT_NEEDLES`, after the existing entries: `server_busy`, `servers are currently busy`, `currently experiencing high demand`, `model is at capacity`, `provider returned an error`, `provider returned error`, `server error`. Do not treat raw `finish_reason` by itself. Do not add a bare `error` needle. Other Pi retry phrases (`internal error`, `terminated`, `network error`, `ResourceExhausted`, and the rest) stay out of this plan.

### 12. Virtual model — do

`extractLastAssistantError` also returns `provider` and `model` from that assistant message when both are non-empty strings. `onFailover` uses that pair as `current` for `decideFailover` when present, and uses `currentKey(ctx)` only when they are absent. Before that, `state.preferred ??= currentKey(ctx) ?? current`, so the unset init does not store the physical key. Restore stays the existing `returnToPreferred` on the next user prompt when usage checking is on. Workers do not restore. If the assistant has no physical model, failover uses the virtual key, misses the chain, and skips.

## Tests

- `jsonResult` sets `structuredContent` from `JSON.parse` of the text, for an object and for `undefined`.
- One registered ctx tool exposes the shared schema and namespace `{ name: "ctx" }`. `readOnlyHint` is set only on the three readers.
- `hashlineCardLines` shows `◷ 0.01s` for 12 ms and `◷ 1.20s` for 1200 ms, and omits it when `durationMs` is absent.
- Observer: exit 1, signal null, truncation stderr, and observations commits. Exit 1 with other stderr and observations throws. Exit 1 with an empty file throws. A signal kill with observations throws. Exit 0 with an empty file does not throw.
- Promoter: exit 1, signal null, truncation stderr, and `submitted: true` returns the harvest. Exit 1 with only the startup write throws. A signal kill with `submitted: true` throws.
- `classifyError` returns `transient` for each new phrase, including `Provider returned error` and the Mistral sentence, and returns `other` for an unrelated `error` word.
- Virtual `ctx.model`, failed assistant on physical A, A in a chain: failover goes to B, and `preferred` stays the virtual key. A later user `before_agent_start` switches back to the virtual key.

## Out of this plan

Items 1–5, a new virtual-model restore path, per-tool output schemas, observer and promoter structured results, `registerToolRenderer`, `outputPad`, and the extra Pi retry phrases named under item 11.
