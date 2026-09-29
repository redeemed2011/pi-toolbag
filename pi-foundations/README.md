# pi-foundations

Two rituals for the start of serious work. `/first-questions` shrinks the request. `/first-principles` builds the smallest solution from the facts that survived.

Each command puts the procedure in the turn. Pi also advertises the skill description, and `/skill:first-questions` or `/skill:first-principles` loads the same text. The command is the path that does not depend on the model opening the skill file.

## Contracts

| Ritual | File |
|---|---|
| `/first-questions` | `.pi/foundations/first-questions.md` |
| `/first-principles` | `.pi/foundations/first-principles.md` |

The file is the finished state, bound or not. First questions records the one-sentence goal and every item as kept, changed, deferred, or cut. First principles records sourced facts, hypotheses, the minimal solution, the trace from each piece to a fact, and the rejected approaches. First principles stops when the first-questions file is missing.

## Ctx

ctx is already in this package. After the user confirms a file, the parent agent may mirror a short law with the existing `ctx_record` tool. It does not mint one record per requirement.

- Call `ctx_get` first. Mint only when it returns `gate` 0. The file still stands otherwise.
- The goal is one `constraint`, `applies_to` `"all"`, directive pointing at the first-questions file. Skip it when that headline is already listed.
- Cuts that must not return are at most six `out_of_scope` headlines. Reasons stay in the file. `ctx_get` does not list them. Compact inject shows the oldest six, and only when a destination already exists.
- A verified fact becomes a `constraint` only when later work must obey it. The source is in the directive. `rationale` is not injected.
- `no project bound`, `ctx is off`, and `gate` stop minting. On `gate`, do not supersede another constraint. A `Mint would GATE` picker is `refuse write`. If a picker asks which live constraint to supersede, cancel it unless the user asked to replace that record. Replace a record only when the user says so, with `reason_class` `decision_change`.
- A new session starts unbound. The prompt picks up the mirror after `/ctx bind` and the next compaction.

The ritual does not wait on `/ctx bind`. The observer does not mint.

## Develop

```bash
cd pi-foundations
npm test
npm run typecheck
```

From the repo root, `npm test` and `npm run typecheck` include this package. Tests must not invoke the `pi` wrapper.
