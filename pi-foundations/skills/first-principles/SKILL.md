---
name: first-principles
description: >
  After .pi/foundations/first-questions.md exists, derive the smallest solution
  from sourced load-bearing facts and write .pi/foundations/first-principles.md.
  Analogy and best practice are not facts. Do not design or code until that
  file exists and the user has seen it. Start with /first-principles.
---

# /first-principles — smallest solution from sourced facts

This ritual runs on whatever first-questions still contains. It is finished when the sourced facts, the hypotheses, the minimal solution, the trace from each piece to a fact, and the rejected approaches are in the file. The file is a second contract beside `.pi/foundations/first-questions.md`.

Read `.pi/foundations/first-questions.md` first. If that file is missing, or it has no confirmed one-sentence goal, stop and say to run `/first-questions`. Do not invent the goal.

Do not sketch code, schemas, or architecture until this file exists and the user has had a chance to challenge the facts. Writing this contract file is the one edit allowed before that.

## 1. Surface the load-bearing facts

List only facts the remaining scope actually rests on. Each fact is explicit, current, and sourced. A source is a measurement, a spec, a law, a primary document, or a constraint the user just confirmed. "Common knowledge", "industry standard", and "everyone does it this way" are not sources. Mark those **Hypothesis (needs research)**.

Consider physics and hard reality, compute and data limits, invariants, the one-sentence goal, and external forces that cannot be wished away.

Analogy is for explaining a result after it exists. It is not how the result is derived.

## 2. Reconstruct the smallest solution

Only after the facts are written down, derive the smallest solution that satisfies those facts and no others.

- Every significant piece names the fact that requires it.
- A component with no requiring fact is rejected.
- A popular pattern or framework is rejected unless a named fact requires that implementation.
- Complexity is justified by a specific fact.

## Write the file

Create or update `.pi/foundations/first-principles.md`:

```markdown
# First Principles

**Session date**: YYYY-MM-DD
**Scope**: the one-sentence goal from first-questions

## Bedrock facts

### Fact 1 — [Short name]

**Statement**:
**Why it is load-bearing**:
**Source / evidence** (with date if possible):
**Status**: Verified | Hypothesis (needs research)

## Hypotheses requiring fresh verification

- ...

## Reconstructed minimal solution

### Core approach

The smallest solution that satisfies the verified facts.

### Justified components

For each piece: what it is, which fact requires it, why nothing simpler satisfies that fact.

### Explicitly rejected approaches

- Approach — the fact it violates, or the fact it fails to serve

## Open questions on foundations

1. ...
```

A later design that contradicts this file or the first-questions file is wrong until the files are deliberately updated.

## Ctx, after the user confirms the file

The file is the contract. Finish it whether or not a project is bound. Do not stop the ritual to run `/ctx bind`.

If `ctx_get` or `ctx_record` is not available, stop. The file is done.

Mint only when `ctx_get` returns `gate` 0. `bound` false, a missing result, or `gate` 1 means the file stands alone. Do not mint another copy of the one-sentence goal. First-questions owns that constraint.

Mint a `constraint` only for a verified fact that later work must obey, and only when that headline is not already listed. `headline` is the fact's short name. `directive` contains the fact and its source, because `rationale` is not injected. `applies_to` is `"all"`. Hypotheses, the minimal solution, rejected approaches, and open questions stay in the file. Do not mint one record per fact. Each minted fact shares the gate with every other live constraint.

On `gate`, do not supersede some other constraint to make room. If a picker titled `Mint would GATE` appears, the choice is `refuse write`. If a picker asks which live constraint to supersede, cancel it unless the user asked to replace that record. Do not pass `supersedes` unless the user says that record is replaced, and then set `reason_class` to `decision_change`. Stop when the tool returns `no project bound`, `ctx is off`, or `gate`.

The ctx observer does not mint these. You do, after the user confirms the file.

## Then

Research any hypothesis that blocks the solution, or implement against the two files.
