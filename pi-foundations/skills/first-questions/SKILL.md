---
name: first-questions
description: >
  Shrink a request that has extra requirements or an unconfirmed goal to one
  sentence, and record every other requirement as kept, changed, deferred, or
  cut in .pi/foundations/first-questions.md. Use when the request has more than
  one outcome, bundles extra requirements, or adds an item to an existing
  contract. Do not use for one bounded task, a fix, a lookup, or work already
  inside a confirmed contract. Start with /first-questions only in those cases.
---

# /first-questions — shrink the request

The ritual is finished when one sentence is the goal and every other requirement is kept, changed, deferred, or cut. The win is the cut list. The file is the contract. A later turn that sees only the goal and the cuts has not finished.

Do not plan, research, design, spawn, or edit project code until that file exists and the user has confirmed the one-sentence goal. Writing the contract file is the one edit this ritual allows before that yes.

## Question 0

Ask: "What are we actually trying to accomplish?"

The answer is one clear sentence. A multi-sentence answer, "it depends", a vague vision, or several goals is not done. "Build a dashboard" is not an answer. A sentence that names the outcome and who it is for can be.

If the sentence does not exist, keep asking. If it cannot be reached, the work does not start.

Write the confirmed sentence in bold at the top of the file. Every later item is judged against it.

## Interrogate every item

For every feature, constraint, "we need", compliance item, or nice-to-have, record all of the following.

1. Origin. Why does this exist right now? Who added it, and when? If that person is gone, scrutiny goes up.
2. Necessity. Is it required for the one-sentence goal? Can the whole thing be deleted and the goal still be met? What is the smallest version that still delivers the goal?
3. Physics or inertia. Is it grounded in physics, mathematics, hard user reality, or legal reality? "We have always done it this way", legacy, or "industry standard" is inertia. Inertia is cut unless a current justification is found.
4. External force. If it came from compliance or "the customer requires it", the record says whether anyone asked the actual authority what the intent is and whether a smaller way satisfies it.
5. Future regret. Can the goal be hit without building this? What does it cost in time, complexity, maintenance, and later rework? One year from now, how likely is "why did we build this"?

"The user really wants this" is not a reason to keep it.

Each item ends as **KEPT**, **MODIFIED to X**, **DELETED**, or **DEFERRED**. Kept and modified items stay in the file with the rationale. The cut list is the win column, not a substitute for the other three.

## Write the file

Create or update `.pi/foundations/first-questions.md`:

```markdown
# First Questions

**Session date**: YYYY-MM-DD
**Status**: ACTIVE | REVISITED

## The one-sentence goal

> "One sentence. If this is achieved, the effort was worth it."

## Interrogated items

### [Short name]

- **Original request**: "..."
- **Source / who / when**:
- **Alignment with the goal**: Strong / Weak / None
- **Outcome**: KEPT / MODIFIED to X / DELETED / DEFERRED
- **Challenges**: origin, inertia, can it be removed, future regret
- **Decision rationale** (1-3 sentences):

## Deleted / avoided scope

- Item — reason

## Open questions

1. Questions that must be answered before implementation.
```

When new scope appears later, run this ritual on that item and update the file before building it.

## Ctx, after the user confirms the file

The file is the contract. Finish it whether or not a project is bound. Do not stop the ritual to run `/ctx bind`.

If `ctx_get` or `ctx_record` is not available, stop. The file is done.

Mint only when `ctx_get` returns `gate` 0. `bound` false, a missing result, or `gate` 1 means the file stands alone. A new session starts unbound and shows that law in the prompt only after `/ctx bind` and the next compaction. `ctx_get` in this session sees a mint immediately.

When a mint is allowed:

1. One `constraint`, and only if the headline `One-sentence goal` is not already listed. `directive` is the goal sentence, then the path `.pi/foundations/first-questions.md`. `applies_to` is `"all"`.
2. Cuts that must not be rebuilt: `out_of_scope`, headline only, at most six. The reason stays in the file. `ctx_get` does not list these. If you cannot tell that a headline is new, add none. Compact inject shows the oldest six of those headlines, and only when a live destination already exists. Do not mint a destination to force that.

Do not mint one record per requirement. Kept items, modified items, and rationales stay in the file. `rationale` on a ctx record is not injected.

On `gate`, do not supersede some other constraint to make room. If a picker titled `Mint would GATE` appears, the choice is `refuse write`. If a picker asks which live constraint to supersede, cancel it unless the user asked to replace that record. Do not pass `supersedes` unless the user says that record is replaced, and then set `reason_class` to `decision_change`. Stop when the tool returns `no project bound`, `ctx is off`, or `gate`.

The ctx observer does not mint these. You do, after the user confirms the file.

## Then

The next ritual is `/first-principles`, on what this file still contains.
