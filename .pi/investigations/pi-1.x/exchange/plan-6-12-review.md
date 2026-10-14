# agent2 review of the plan-6-12 implementation

I read the working tree diff against `plan-6-12.md`. No package source was edited. I also ran `tsc --noEmit` on every package. The vitest runs do not typecheck.

## Verdict

The behavior matches the plan for items 6, 8, 10, 11, and 12. Items 7 and 9 are correctly absent.

One real bug blocks a commit: **pi-ctx does not typecheck.** The other five packages report 0 errors.

## Bug: decision 6, `pi-ctx/src/tools/result.ts` line 4

```ts
structuredContent: unknown;
```

`tsc --noEmit -p pi-ctx` reports 9 errors, TS2322, one for each `execute` in `register.ts`. They are at lines 67, 97, 123, 161, 203, 299, 388, 420, and 457:

> Types of property 'structuredContent' are incompatible. Type 'unknown' is not assignable to type 'JsonValue | undefined'.

Pi types `AgentToolResult.structuredContent` as `JsonValue` (`pi-ai` `types.d.ts:297`). Fix it in `result.ts` only. Type the field as `JsonValue`, from `@earendil-works/pi-ai` or a local alias with the same shape, and annotate the two `JSON.parse(...)` results as that type. Leave `register.ts` unchanged. The root `typecheck` script must exit 0 before the commit, as it did after the item 5 commit.

## Checked and matching

**6.**
- `jsonResult` sets `structuredContent: JSON.parse(text)`. The empty path parses `JSON.stringify(EMPTY_TOOL_RESULT)`.
- Every one of the nine tools has `outputSchema: Type.Object({}, { additionalProperties: true })` and `namespace: { name: "ctx" }`, with no aliases and no description.
- `readOnlyHint` is on `ctx_get`, `ctx_zoom`, and `ctx_frontier` only.
- Every `execute` path returns through `jsonResult`. Every `execute*` result is an object, so the object schema holds.
- The test covers all nine tools, which is stronger than the plan's one tool.

**8.**
- The header ends with ` ◷ ` and then `paint(theme, "dim", (ms/1000).toFixed(2) + "s")`.
- `DiffHost.result.durationMs?: number` is added.
- The tests cover `◷ 0.01s`, `◷ 1.20s`, the absent case, and dim.
- Not a bug: any `typeof === "number"` value is shown, including `NaN`. Pi only stores a measured finite duration, so `Number.isFinite` is optional.

**10.**
- `isTruncatedPrintExit` checks `code === 1`, `signal === null`, and that stderr contains the exact `print-mode.js:126` sentence.
- Observer: a non-zero exit outside the gate throws, as before. Under the gate it reads the result file, throws when the observation list is empty, and commits otherwise. Exit 0 is unchanged.
- Promoter: `submit_harvest` writes `submitted: true` through `writePromoterResult(..., true)`, and the startup write has no flag. Under the gate, `readPromoterSubmission` throws unless `submitted === true`.
- An abort reaches the gate as a signal or an exit without the sentence, so it still throws.
- The tests cover all five observer cases and all three promoter cases in the plan.

**11.** The seven needles are appended in the plan's order. The table covers each one, including `Provider returned error`, the Mistral-style `server error`, and an unrelated `error` that stays `other`.

**12.**
- `extractLastAssistantError` adds `provider` and `model` only when both are non-empty strings.
- `onFailover` uses `physical ?? virtual` as `current` and sets `state.preferred ??= virtual ?? current`.
- Aborted errors carry the pair too, but `classifyError` returns `aborted` before `current` is read, so that has no effect.
- The scenario checks failover to `xai/grok-4.6`, then `preferred` still `virtual/session`, then a `usage-return` to `virtual/session` on the next user prompt.
- `ModelRegistry.find` resolves virtual models in real Pi: `ModelRuntime` merges them into the provider's model list (`withVirtualModels`). So the fake host matches runtime behavior.

## Note, not a bug

`steps.ts` narrows the old `the last assistant error is "(.*)"` step to `"([^"]*)"`. That is needed to tell it apart from the new `... from "..."` step. Any later scenario whose error text contains a double quote will now fail as an undefined step, rather than match. The current features have none, and 185 pass.
