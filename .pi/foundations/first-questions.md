# First Questions

**Session date**: 2026-10-08
**Status**: ACTIVE

## The one-sentence goal

> "A ctx checkout states the extension's goals so a later session on another computer can improve ctx toward those goals."

## Interrogated items

### Goals a later session can follow

- **Original request**: "i want other computers that use ctx to be able to determine the most important goals of the ctx extension and work towards improving ctx according to those goals."
- **Source / who / when**: User, 2026-10-08. Chosen as the first outcome with "start with #2, then #1".
- **Alignment with the goal**: Strong
- **Outcome**: KEPT
- **Challenges**: This is the goal. The smallest version is a checked-in statement of the current goals, readable from a ctx checkout without the Obsidian vault.
- **Decision rationale**: Without that statement in the checkout, another computer cannot tell which improvements matter.

### ADRs or specs in the ctx folder

- **Original request**: "add proper ADRs or specs to ctx extension's folder so future sessions understand the design intent."
- **Source / who / when**: User, 2026-10-08. "ADRs or specs" was the offered form, not a demand for both.
- **Alignment with the goal**: Strong that the statement lives in the ctx extension folder. Weak that the form must be a full ADR series.
- **Outcome**: MODIFIED to the smallest checked-in statement of the current goals, in the ctx extension folder. Record a decision only where a later session would otherwise undo it. Do not archive the vault's history.
- **Challenges**: A historical ADR dump does not tell another computer what to improve next. Two parallel forms would drift.
- **Decision rationale**: The goal is the goals, not the document type. The form is whatever a later session can read and follow.

### Update from the Obsidian vault

- **Original request**: "these ADRs or specs probably have to be updated from the source material in my obsidian vault since i've enhanced ctx since then."
- **Source / who / when**: User, 2026-10-08. The vault is named as the source, and current ctx as the reason a raw copy would be stale.
- **Alignment with the goal**: Strong as input. None as a second copy of the vault.
- **Outcome**: MODIFIED to read the vault for the original goals, then write the goals as they stand in current ctx. Do not copy vault notes verbatim.
- **Challenges**: The vault is not on the other computer. A verbatim copy would ship stale intent.
- **Decision rationale**: The checkout has to carry the current goals. The vault is evidence for what those goals were, not the deliverable.

### Commit and push

- **Original request**: "commit and push"
- **Source / who / when**: User, 2026-10-08, in the same request, before the goals work.
- **Alignment with the goal**: Strong as the way another computer receives the statement. None as a commit of unrelated work.
- **Outcome**: KEPT as the last step of this goal, and only for the goals statement. The valid-output work is not part of that commit.
- **Challenges**: Pushing before the statement exists does not help another computer. Pushing the deferred checker in the same commit mixes two outcomes.
- **Decision rationale**: Other computers see the goals only after the statement is pushed.

### Valid ctx output, and a check that fails

- **Original request**: "ensure that the ctx extension's funcs always return valid output. we need some sort of tooling to detect such issues."
- **Source / who / when**: User, 2026-10-08. Sequenced second with "start with #2, then #1".
- **Alignment with the goal**: Weak. A checker does not tell another computer what ctx is for.
- **Outcome**: DEFERRED until the goals statement is in the checkout and pushed.
- **Challenges**: Existing law already says ctx must be reliable and must not return undefined unless the consumer allows it. The user still wants a detector, but not before the goals exist. Building it now delays the thing another computer needs.
- **Decision rationale**: The goal can be met with no checker. Do this next, after the goals statement is pushed.

## Deleted / avoided scope

- A full historical ADR archive copied from the vault — another computer needs current goals, not the note history.
- Keeping both an ADR series and a separate spec that say the same thing — they would drift.
- Committing the valid-output checker in the same change as the goals statement — that work is the next outcome, not this one.
- Claiming the open question "record tool cannot mint applies_to all via LLM tool-calling" as this goal — that is the deferred checker, not the goals statement.

## Open questions

1. Which vault notes are the source of the goals, and which of those goals current ctx still has?
2. Which decisions, if left unstated, would a later session undo?
