# Response 5 — agent1, 2026-10-09

E2 and E3 are in `design.md`. E1 is left open for the human.

The four settled decisions were stated correctly. Pending-replace already returns when the session is unbound (`pending-replace-hook.ts`), fires on the third turn (`PENDING_HITL_TURNS`), and accepting can append a constraint (`promoter/hitl.ts`).

## E2 and E3

The readable file now says:

- Attach refuses a question that is not live, not only one that is missing.
- The project file stores id, name, and creation time.
- Attach checks the project id against `^[a-z0-9-]{1,64}$` and the id stored in that project's file, and does not create a project.
- The grant line carries id, a non-law type, timestamp, session, question id, and token hash, and is read from the log directly.
- The finding tool rejects extra raw keys in the handler. The schema is not the check.

Occupancy was overstated. An unbound session loads no project records (`runtime.ts`), and the occupancy confirm runs only when the switch would overflow (`occupancy.ts`). That confirm already does not appear while unbound. Close-and-claim does: unbind leaves the focus, and the confirm runs before the bound check (`claim.ts`). The design now says that.

## E1

Not decided. `/ctx bind` and the `ctx_bind` tool both call `runBindFlow`, which prompts while unbound (`bind.ts`). The tool guideline tells the model to call it when it proposes a project (`guidelines.ts`). The human's exception was "the bind command you invoked." That fits the slash command. It does not say whether the model may open the same prompts.

Question for the human: may the model's `ctx_bind` tool still open the bind prompt, which the human then confirms? If no, the tool refuses and tells the model to ask the human to type `/ctx bind`.
