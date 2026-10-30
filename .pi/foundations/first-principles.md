# First Principles

**Session date**: 2026-10-14
**Scope**: When a safety block causes failover, the next model is steered off the blocked approach without a message that looks like the user.

## Bedrock facts

### Fact 1 — Continue is legal only when the projected context does not end on an assistant

**Statement**: `agent_before_settle` may return `continue: true` plus session drafts. Pi commits those drafts, rebuilds the projection, and refuses the continue when `canContinue` is false. `canContinue` is false when the last LLM message is an assistant. `agent.continue()` also throws if its last message role is `assistant`.
**Why it is load-bearing**: A steer that only rewrites the failed assistant leaves that assistant last, so the retry never runs.
**Source / evidence**: `agent-session.js` `_buildBoundaryContext` and `_runBeforeSettleBoundary`; `agent.js` `continue()`, read 2026-10-14. Installed `@earendil-works/pi-coding-agent` in `/home/bo/src/projects/node_modules`.
**Status**: Verified

### Fact 2 — Null context edit drops the failed assistant from model context and keeps finished tool results

**Statement**: A `context_edit` whose replacement is null omits that entry from model context. It does not change other entries. Tool results are their own entries, so they stay, including the assistant that called them. The session still stores the original failed message.
**Why it is load-bearing**: This is how the retry can start from the original request, or from finished tool results, without the refusal text being the last message.
**Source / evidence**: `session-manager.d.ts` `ContextEditEntry` ("Null omits the target from model context"); `session-manager.js` `projectContextEntry`, read 2026-10-14. Current safety and quota path in `pi-fallback-lib/src/attach.ts`.
**Status**: Verified

### Fact 3 — A custom message is not a user entry, and the TUI does not render it as one

**Statement**: A boundary draft may append a `custom_message`. Pi's own type says this participates in LLM context and is converted to a user message for the provider. `display: true` renders it with custom-message styling and a `[customType]` label, not as a user message. `display: false` renders nothing. A plain `custom` entry does not enter model context.
**Why it is load-bearing**: This is the boundary channel that can carry the steer, keep `continue` legal, and not be a user transcript entry.
**Source / evidence**: `extensions/types.d.ts` `CustomMessageEntryDraft` and `SessionBoundaryDraft`; `session-manager.d.ts` `CustomMessageEntry`; `agent-core` `harness/messages.js` `convertToLlm` (`custom` becomes `role: "user"`); `custom-message.js` label rendering, read 2026-10-14.
**Status**: Verified

### Fact 4 — The continue does not start a user prompt

**Statement**: After a successful `agent_before_settle` continue, Pi calls `agent.continue()`. That does not emit `before_agent_start` and does not add a user prompt. The usage-return check runs on `before_agent_start`, so it does not switch back to the preferred model before this retry.
**Why it is load-bearing**: The steer has to ride this continue. A later `sendUserMessage` would be a new user prompt and would look like the user.
**Source / evidence**: `agent-session.js` `_runAgentPrompt` calls `agent.continue()` after the boundary. `before_agent_start` is emitted from `prompt()`, not from `continue()`. `pi-fallback-lib/src/attach.ts` return-to-preferred runs in `before_agent_start`, read 2026-10-14.
**Status**: Verified

### Fact 5 — The confirmed goal

**Statement**: When a safety block causes failover, the next model is steered off the blocked approach without a message that looks like the user. Quota and timeout do not get that steer. `durationMs` and `outputPad` are not this effort.
**Why it is load-bearing**: It decides which failover class gains a steer and which mechanisms are out.
**Source / evidence**: User, 2026-10-14, confirming the sentence and deferring the display fields. Recorded in `.pi/foundations/first-questions.md`.
**Status**: Verified

## Hypotheses requiring fresh verification

- None that block the solution. The provider receives the custom message with role `user` even though the transcript entry is not a user message. That is Fact 3, not an open mechanism.

## Reconstructed minimal solution

### Core approach

On a safety classification only, the `agent_before_settle` result still switches models and still omits the failed assistant. It also appends one `custom_message` with `display: true` whose text tells the next model not to repeat the blocked approach and not to repeat finished tool results. Quota and timeout keep the current omit-and-continue result with no extra entry.

### Justified components

- Safety-only branch on the existing before-settle replay. Fact 5. Quota and timeout are not a blocked approach.
- `context_edit` null on the failed assistant. Fact 1 and Fact 2. Without the omission the continue is illegal, and the refusal would remain the tail.
- One displayed `custom_message` after that edit. Fact 3 and Fact 5. It is the smallest draft that carries the steer and is not a user entry. `display: true` is what makes the TUI show a custom label instead of hiding the steer or painting a user turn.
- The previous steer sentence as the content. Fact 5. The goal requires a steer off the blocked approach and off repeating finished tools. No new instruction is required.
- No `deferReturn` and no `sendUserMessage`. Fact 4.

### Explicitly rejected approaches

- `sendUserMessage` — creates a user prompt. Violates Fact 5.
- Omit the assistant and add no steer — the next model does not learn that the approach was blocked. Fails Fact 5.
- Rewrite the assistant text and do not append anything — the projected tail stays an assistant, so Pi rejects the continue. Violates Fact 1.
- A plain `custom` entry — not sent to the model. Fails Fact 5.
- `display: false` — the model would still see the steer, but the session would hide it. The goal forbids looking like the user, not showing a labeled custom message. Hiding is an extra behavior no fact requires.
- Change the system prompt inside `before_agent_start` — that event does not run for `agent.continue()`. Fact 4. No extension setter for the system prompt was found on the before-settle path.
- Steer quota and timeout the same way — rejected by Fact 5.

## Open questions on foundations

1. None.
