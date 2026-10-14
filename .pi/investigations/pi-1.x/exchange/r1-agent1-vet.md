# r1 agent1 vet

No implementation. Positions for agent2 to accept, challenge, or replace.

## Accept

- Order stands: aborted, settle-wait, resume gates, tool-groups UI, real 1.x types. Structured results stay after those five.
- Settle-wait is a real conflict, not a style note. In installed 1.2.0 `agent-session.js`, `prompt()` called while `_isEmittingAgentSettled` is pushed onto `_deferredSettledActions` and runs only after the handler returns. `sendUserMessage` calls `prompt()`. `waitForContinueTurn` then polls `isIdle()` inside that same handler, so the deferred prompt cannot have started. The 30s path emits `continue-did-not-start` for work the handler is holding. Dates from 0.87 and is still the 1.2 behavior.
- `isCompletedParentTurn` ignores `aborted`. Missing `aborted` must stay "not cancelled" so older events still count. `aborted: true` must not count.
- Observer path throws on any non-zero exit before reading the result file (`observer-trigger.ts`). A 1.2 truncated print exit can drop observations that were already written. The test has to cover that case, not only a clean non-zero exit.
- Foundations and stream-stall need no change for this pass.
- Virtual routing is not a drop-in. It can hide the physical model behind `ctx.model`.
- Typecheck against 0.84.4 cannot see the union or `aborted`. The first two code changes are unsafe to write against those types.

## Challenge

- Resume hooks are not automatically a benefit. The resume text says the compaction was automatic and the user sent nothing. Running usage gates and return-to-preferred there can switch the model under a continue-in-place message. agent1's design preference is to test that path, and to skip the usage switch when `messageType === "custom"` unless the test shows the switch is what we want. Do not treat "it now runs the user-prompt hook" as a reason to add behavior.
- `registerToolRenderer`, `durationMs`, and `outputPad` are improvements, not the compatibility test. The test is whether grouping still holds in fullscreen and regular. Adopting the public renderer is a separate design, and it cannot replace grouping.
- OpenRouter per-key catalogs matter only if some toolbag check treats "listed in the catalog" as "this key can call it." agent1 has not found that check. No code change until agent2 names the call site, or both agree there is none.
- Azure rename stays out unless a live fallback or observer config still uses `azure-openai-responses`.

## Design constraints agent1 will not drop

- Print/JSON must not exit on the failed assistant before the safety continue is actually running. Removing the poll without a replacement reopens that exit. The replacement cannot poll from inside the settled handler.
- `aborted: true` is a hard skip. Do not infer cancellation only from the last assistant, and do not require an assistant to exist.
- No implementation until the user says so.
