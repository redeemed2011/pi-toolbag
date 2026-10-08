# First Principles

**Session date**: 2026-10-08
**Scope**: A ctx checkout states the extension's goals so a later session on another computer can improve ctx toward those goals.

## Bedrock facts

### Fact 1 — The vault states the goal; the checkout does not

**Statement**: The vault's one-sentence goal is: design a Pi memory system that by default keeps a session coherent across many compact cycles, and that can be explicitly bound to a named, machine-global, repo-independent project so multiple sessions share append-only law. The ctx README points at "agent memory — Pi spec (both injects)" and says that spec is not shipped in this repo.
**Why it is load-bearing**: Another computer clones pi-toolbag. It does not have the Obsidian vault. Without a statement in the checkout, that session cannot tell the goal from the code alone.
**Source / evidence**: `/home/bo/ResilioSync/Obsidian/My Notes/AI Ideas/agent memory — first questions.md` (updated 2026-09-18). `pi-ctx/README.md` Status section, read 2026-10-08.
**Status**: Verified

### Fact 2 — The spec's goals and non-goals are a closed list

**Statement**: The spec's goals are: session inject default on; project law only after explicit bind to a machine-global named project; an 8k typed inject at compact, plus F-once A; tools `ctx_get`, `ctx_zoom`, `ctx_frontier`, `ctx_claim`, `ctx_bind`, `ctx_record`; both occupancy renderers, default Gated Edge, per-session switch; compact is O(live), no LLM in that hook; one Pi extension. The non-goals include deleting either renderer, a third occupancy, F-packer, growing the inject with the window, observers minting judgment types, defaulting a missing `applies_to` to `all`, auto-next after close, body-GC, embeddings, a shared sqlite store, and forking Pi.
**Why it is load-bearing**: A later session that "improves" ctx by reopening a non-goal has failed the goal. The list is the thing the checkout has to carry.
**Source / evidence**: Same vault, `agent memory — Pi spec (both injects).md`, section "Goals & Non-Goals", read 2026-10-08.
**Status**: Verified as the vault's list. Not yet checked line-by-line against today's code (see Hypothesis 1).

### Fact 3 — The vault's paths are stale

**Statement**: The vault's handoff still says the code is `/home/bo/src/projects/pi-ctx/`. The live tree is `/home/bo/src/pi-toolbag/pi-ctx`. The user said ctx has been enhanced since those notes.
**Why it is load-bearing**: A verbatim copy of the vault would ship stale paths and stale status. The checkout has to say what is still true.
**Source / evidence**: Vault `agent memory — HANDOFF.md` (paths read 2026-10-08). Live tree listed the same day. User, 2026-10-08.
**Status**: Verified

### Fact 4 — This effort's contract limits the artifact

**Statement**: The checked-in statement is the smallest text a later session can read. Record a decision only where that session would otherwise undo it. Do not archive the vault. Do not keep two forms that say the same thing. The valid-output checker is the next effort, not this one.
**Why it is load-bearing**: A full ADR series or a second spec fails the one-sentence goal by size and drift.
**Source / evidence**: `pi-toolbag/.pi/foundations/first-questions.md`, written 2026-10-08 from the user's "start with #2, then #1".
**Status**: Verified

## Hypotheses requiring fresh verification

- Hypothesis 1: Which spec goals and non-goals the current pi-ctx code still implements. The user said ctx was enhanced after the vault. A goals file written before that check can ship a rule the code no longer has.
- Hypothesis 2: Which of those rules a later session would actually undo if they were left unstated. Fact 4 says record only those.

## Reconstructed minimal solution

### Core approach

One markdown file in `pi-ctx/` that states the vault's one-sentence goal, the goals that current code still has, and the non-goals a later session must not reopen. It names the vault note as history, not as a second copy. It is written only after Hypothesis 1 is checked against the code.

### Justified components

- The one-sentence goal in the file. Fact 1 requires it. A code comment does not travel as the thing another session reads first.
- The surviving goals and the non-goals. Fact 2 requires the closed list. Fact 3 requires dropping anything the code no longer does.
- A pointer that the long spec stays in the vault. Fact 4 rejects shipping the spec itself.
- Nothing else. A checker, a status-line change, and a bind-promotion change do not help another computer read the goals.

### Explicitly rejected approaches

- Copying the vault spec, handoff, or ADR history into the repo. Fact 3 and Fact 4.
- An ADR series plus a separate goals spec. Fact 4. They would drift.
- Writing the goals file before checking the code. Hypothesis 1. The user said the vault is stale.
- Treating the per-turn status line or "Promoted none" as part of this solution. Those are separate questions. They do not state the goals.

## Open questions on foundations

1. Hypothesis 1: which vault goals does current ctx still implement?
2. Hypothesis 2: which of those, if omitted, would a later session undo?
