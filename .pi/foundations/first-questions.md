# First Questions

**Session date**: 2026-10-14
**Status**: ACTIVE

## The one-sentence goal

> "When a safety block causes failover, the next model is steered off the blocked approach without a message that looks like the user."

## Interrogated items

### Steer the next model off the blocked approach

- **Original request**: "and a weaker one for safety. reimplement for this particular situation."
- **Source / who / when**: User, 2026-10-14, after replay-without-a-user-message shipped as `f8a8a03`.
- **Alignment with the goal**: Strong
- **Outcome**: KEPT
- **Challenges**: Omitting the failed assistant removes the refusal from the next request. Nothing else tells the next model the approach was blocked. The goal is not met by replay alone.
- **Decision rationale**: Safety failover still changes models and continues, and it also carries a steer that the blocked approach must not be repeated.

### Do not send a prompt that looks like the user

- **Original request**: "i'd like it to not have to send a prompt as if the user." Confirmed again in the goal sentence.
- **Source / who / when**: User, 2026-10-12, confirmed 2026-10-14.
- **Alignment with the goal**: Strong
- **Outcome**: KEPT
- **Challenges**: `sendUserMessage` is what made the old steer look like the user. Putting the same text back through that call fails the sentence.
- **Decision rationale**: The steer is not a user entry. Quota and timeout stay a plain replay with no steer.

### durationMs and outputPad on tool grouping

- **Original request**: "if they are of true benefit, they are worth trying." Then: "we'll return to the other work later--durationMs and outputPad."
- **Source / who / when**: User, 2026-10-14.
- **Alignment with the goal**: None
- **Outcome**: DEFERRED
- **Challenges**: Grouping already holds without them. They are a different surface from safety failover.
- **Decision rationale**: Not part of this goal. Pick them up only when this sentence is done.

## Deleted / avoided scope

- `sendUserMessage` as the safety steer — that is the forged user prompt.
- A steer on quota or timeout failover — those retries are the same request, not a blocked approach.
- Another pass over the Pi 1.0–1.2 changelog — the user said that review is not needed.
- Replacing tool grouping's private patch, or trying `durationMs` and `outputPad`, in this effort.

## Open questions

1. None before implementation.
