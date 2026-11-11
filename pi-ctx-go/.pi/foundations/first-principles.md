# First Principles

**Session date**: 2026-11-04
**Revisited**: 2026-11-05
**Scope**: A new Pi extension that runs only while CTX is bound keeps that session working through the open CTX work until a separate model judge, asked only at the claim of done, agrees the project is done, for the operator who said go. Acceptance of the two-line destination is not that agreement.

## Bedrock facts

### Fact 1 — The extension is a sibling that loads with pi-toolbag

**Statement**: The extension lives in pi-toolbag and is listed in `pi.extensions`, as the other extensions are. Loaded does not mean running. It does nothing useful unless CTX is bound, and it does not start until the operator says go.
**Why it is load-bearing**: A default-off flag or a second install would not ship the way the others ship. A loop inside pi-ctx would mix the store with the clock.
**Source / evidence**: Operator, 2026-11-04, in `.pi/foundations/first-questions.md`. `pi-toolbag/package.json` lists the current extensions under `pi.extensions` and does not list this one yet.
**Status**: Verified

### Fact 2 — CTX is the only work list

**Statement**: The open CTX work is the list. The extension does not keep a goal, a focus, or a checklist of its own. When the judge accepts the two-line destination, the worker reads that project's first-questions.md and records each still-owed outcome as a CTX question. The extension does not parse that file.
**Why it is load-bearing**: A second list is how a session reported done while the CTX destination stayed open. The opposite failure is a destination acceptance that stops the loop while owed outcomes in that file are still open. Those outcomes become CTX questions. They do not become a list the extension keeps.
**Source / evidence**: Operator, 2026-11-04, in `.pi/foundations/first-questions.md`.
**Status**: Verified

### Fact 3 — The workable questions are the frontier

**Statement**: The frontier is the live questions that are not blocked and not currently claimed, in mint order (`ts`, then `id`). A question leaves that list only when it is no longer live, becomes blocked, or is the current claim. There is no separate "closed" status. A question stays live until some record supersedes it.
**Why it is load-bearing**: "Questions first" has to name a real list. Inventing a done-bit would be a second list.
**Source / evidence**: `pi-ctx/src/fold.ts`, `frontierItems` and `ofType`, 2026-11-04. Live means not superseded.
**Status**: Verified

### Fact 13 — Closing a claim does not settle a question

**Statement**: `ctx_claim` close only clears the session's claimed id. The question is then back on the frontier. A finding records a child of a granted question and does not supersede it. A question stops being frontier work only when a later record supersedes it, which removes it from live.
**Why it is load-bearing**: "Questions are settled" has to mean something the store already does. Treating a closed claim as done would either loop the same question or invent a second done-bit.
**Source / evidence**: `pi-ctx/src/tools/claim.ts`, action `close`, and `pi-ctx/src/tools/finding.ts`, 2026-11-04. Fact 3 for what leaves the frontier.
**Status**: Verified

### Fact 4 — Blocked is the only mechanical pause class on a question

**Statement**: A question is blocked when some live record lists its id in `blocks`. `ctx_claim` refuses a blocked question. That means another record has not released it. It does not mean "ask the operator." No field on `JudgmentRecord` means ask the operator.
**Why it is load-bearing**: The pause for the operator needs its own marker. Reusing `blocks` would stop a question that is only waiting on other work.
**Source / evidence**: `pi-ctx/src/fold.ts` (the `blocked` set), `pi-ctx/src/tools/claim.ts` (returns `blocked`), and `JudgmentRecord` in `pi-ctx/src/types.ts`, 2026-11-04. Operator, 2026-11-04: ask only when they specifically said to ask, and a marker may be added to pi-ctx.
**Status**: Verified

### Fact 5 — The injected destination is one old sentence, two lines

**Statement**: The destination the session sees is `live.destinations[0]`, and only the first two lines of its directive or body. That slot is the oldest live destination, because live ids are walked in log order. A newer destination record does not take the slot while an older one is still live. Superseding the older one removes it from live.
**Why it is load-bearing**: An approved sentence that is stored beside an older destination is not the sentence the session or the judge will see.
**Source / evidence**: `pi-ctx/src/render/gated-edge.ts`, `destinationMd`, and `pi-ctx/src/fold.ts`, `ofType`, 2026-11-04. `pi-ctx/src/mint.ts` accepts `supersedes` on a destination; the fold drops the superseded id from live.
**Status**: Verified

### Fact 6 — Harvest will not store the approved draft

**Statement**: Bind-time harvest mints a destination only from a verbatim substring of the operator's words, only when the project has none, and it does not supersede. The word "yes" is not the draft. `ctx_record` can store a destination the operator never approved.
**Why it is load-bearing**: The operator does not write the sentence. The worker drafts it. Approval has to store that held draft, or the injected destination stays empty or stays the old one.
**Source / evidence**: `pi-ctx/src/promoter/io.ts` (destination shelf rules), 2026-11-04. Operator, 2026-11-04: the worker drafts, the operator approves, and an unapproved record does not count.
**Status**: Verified

### Fact 7 — Approval happens before the questions

**Statement**: `/ctx-go` has the worker draft the destination and waits for the operator to approve it before any unfinished question is worked.
**Why it is load-bearing**: Without an approved sentence, the questions have no aim and the final check has nothing the operator agreed to.
**Source / evidence**: Operator, 2026-11-04, in `.pi/foundations/first-questions.md`.
**Status**: Verified

### Fact 8 — The operator starts and stops it; the agent cannot

**Statement**: `/ctx-go` starts the loop. `/ctx-stop` stops it. Both are slash commands. Pi slash commands are registered with `registerCommand` and run from the operator's prompt. They are not tools. A `custom_message` authored by an extension does not run slash commands.
**Why it is load-bearing**: A stop tool the model can call is the agent ending the loop. The operator rejected that.
**Source / evidence**: Operator, 2026-11-04. Pi extensions doc, `pi.registerCommand` and the `turn_end` note that an extension-authored `custom_message` does not run slash commands, read 2026-11-04.
**Status**: Verified

### Fact 9 — A settled run does not continue itself

**Statement**: Pi keeps going inside a run while the model returns tool results. When the model stops, the run ends. pi-ctx's compaction resume runs only from `agent_settled`, and only when `ctx.isIdle()` is false. That handler's own comment says the run is already idle when the event fires, so `compactWillAbortRun` is false and no resume message is sent. Compaction removes earlier turns from the model context.
**Why it is load-bearing**: After the operator says go once, the next turn has to be started by this extension. ctx will not start it. The worker will not remember the rejection count, or that go is still active, after compaction.
**Source / evidence**: Pi extensions doc, `turn_end`: tool results already cause the next provider request; `continue: false` does not suppress that; an unguarded `continue: true` loops. `pi-ctx/src/hooks/compaction-trigger.ts`, `compactWillAbortRun` and the `agent_settled` comment, 2026-11-04.
**Status**: Verified

### Fact 14 — A pending message is a queued send, not an unanswered question

**Statement**: `ctx.hasPendingMessages()` is true when the steering queue or the follow-up queue has anything in it. Pi already delivers that queue as the next turn. It does not mean the worker asked the operator something.
**Why it is load-bearing**: The "operator is waiting" brake cannot be this flag. Using it that way would stop the loop when the operator had already sent the next instruction.
**Source / evidence**: `@earendil-works/pi-coding-agent` `dist/core/extensions/types.d.ts` (`hasPendingMessages`: queued messages) and `dist/core/agent-session.js` (`pendingMessageCount` is steering length plus follow-up length), read 2026-11-04.
**Status**: Verified

### Fact 10 — The judge is one separate call, on a fixed packet

**Statement**: The worker does not grade itself. No model is asked along the way. The judge is asked only when done is claimed. It sees only the approved destination, the live CTX constraints, how the questions were closed, and the products named in that claim. If the claim names no product, the answer is not done. The judge does not go looking for other work. Acceptance of the two-line destination is not done. Done is a later claim that names the project's first-questions.md, after still-owed outcomes have been CTX questions. On that claim, a KEPT decision is not unfinished by itself, and an owed outcome with no product and no explicit deferral is not done. The judge uses the session's provider, model, and thinking level unless the operator overrides them. The worker does not choose the judge. "Grok at medium thinking" was an example of a weaker model, not the chosen thinking level.
**Why it is load-bearing**: This is the whole definition of done. A search, a checklist of tests, or a second model that builds a reading list was rejected. A destination acceptance is not a project acceptance.
**Source / evidence**: Operator, 2026-11-04, in `.pi/foundations/first-questions.md`. pi-ctx already reads the session model and thinking level for a separate call in `pi-ctx/src/promoter/run.ts`.
**Status**: Verified

### Fact 11 — Two rejected claims pause; the brakes do not use a model

**Statement**: The worker's done-claim is what calls the judge. A judge call is one completed verdict, done or not-done. A packet error is not a call. A not-done verdict continues, and the worker is given that summary, until two rejected claims in a row show no product progress or the tenth call is not-done. Progress means the bytes of a named product other than `first-questions.md` changed, or the claim names a new product file. Rewording the claim, or editing only `first-questions.md`, is not progress. The no-progress pause shows the last two summaries. The tenth not-done pauses even if the products changed, and shows the last summary and the count. A done verdict finishes, including on the tenth call. A new `/ctx-go` after a pause starts the count at zero. The count does not reset because the products moved. The worker cannot declare the pause. Apart from that, the extension stops, with no model, when the operator is waiting, the operator stopped it, or a continued turn made no progress.
**Why it is load-bearing**: One rejection cannot end the loop, or the judge can never send the work back. A second rejection also cannot end it when the named products changed, or the feedback the worker is acting on is discarded. Ten calls bounds a workflow that never stalls. The count has to live outside the model context, or compaction resets it.
**Source / evidence**: Operator, 2026-11-06, replacing the 2026-11-04 two-rejection pause, in `.pi/foundations/first-questions.md`. Fact 9 for compaction.
**Status**: Verified

### Fact 12 — The operator can be asked to confirm without a tool

**Statement**: pi-ctx already asks the operator to pick among choices from extension code (`hitl.select`) before it writes a superseding record. The model does not make that pick.
**Why it is load-bearing**: Approval of the destination has to be the operator's act, and Fact 6 says a chat reply of "yes" will not store the draft.
**Source / evidence**: `pi-ctx/src/promoter/hitl.ts`, `runPendingReplaceHitl`, 2026-11-04.
**Status**: Verified

### Fact 15 — One missing requirement, one next action

**Statement**: `/ctx-go` is not yet working the questions in exactly two cases. CTX is not bound, or no destination has been approved. It names that one gap and one next action. If CTX is not bound, the next action is the operator binding it. The model is not asked to bind. If no destination is approved, the next action is the model drafting and the operator approving. There is no discussion, checklist, or tutorial.
**Why it is load-bearing**: Without this, the operator reaches `/ctx-go` and gets either a warning that does not say what to do, or a model turn whose purpose they have not been told. A discussion of what remains would be a second loop. Fact 2 forbids a checklist the extension keeps.
**Source / evidence**: Operator, 2026-11-05, confirmed in `.pi/foundations/first-questions.md` under "Guide until `/ctx-go` can work." Current code, read 2026-11-05: `onGo` in `pi-ctx-go/src/state.ts` notifies "ctx-go needs a bound CTX project" and does not arm or prompt. When bound and the destination is not approved, it sends `DRAFT_PROMPT` to the model and does not tell the operator that approval is the remaining step. `pi-ctx-go/index.ts` `ctx-go` handler.
**Status**: Verified

### Fact 16 — A live contradiction is not a formal conflict

**Statement**: `foldLive` records a parent in `liveConflict` only when that parent has two or more live successors. A live record stays live until a later record lists its id in `supersedes`. Two live records can say opposite things and still produce an empty `liveConflict`.
**Why it is load-bearing**: The apple-pi project had 284 live records and no formal conflict. Several still said the judge finishes, beside a live record that said only the operator finishes. A kickoff check that only prints `liveConflict` would have continued.
**Source / evidence**: `pi-ctx/src/fold.ts`, `foldLive`, read 2026-11-11. Operator session `01a14602-6015-725c-ba9d-b9898afb9413`, 2026-11-11T16:32:06Z. Operator confirmed the kickoff pause the same day in `.pi/foundations/first-questions.md`.
**Status**: Verified

## Hypotheses requiring fresh verification

None. The queued-message flag is Fact 14. The remaining operator-prose case is a decision, not a missing measurement.

## Reconstructed minimal solution

### Core approach

One extension, listed in `pi.extensions`, idle until CTX is bound. `/ctx-go` arms it. `/ctx-stop` disarms it. While armed, it does three phases and then stops. A pause that is not `/ctx-stop` stays armed: the operator's next message is an ordinary turn, and the loop continues after that turn if the phase rules still say so. The armed flag and the rejection count live in the extension's memory. Compaction does not restart the process, so that memory survives it. The model transcript does not.

0. Contradictions. Before the draft, a question, or a claim, `/ctx-go` reads the live records once when their id set has not been read. The read lists pairs that cannot both be true and that neither record superseded. It also lists a formal `liveConflict`. Copies that agree are not listed. Any pair pauses, names the records, and does not arm the loop. It does not supersede anything. The next `/ctx-go` continues when that id set is unchanged. A changed set is read again. A failed read pauses and does not store the set, so the work does not start. This read is not the completion judge.

1. Destination. If CTX is not bound, `/ctx-go` tells the operator to bind and stops. It does not arm, and it does not ask the model to bind. If the injected destination is not already a sentence this extension stored after an operator approval, it tells the operator that the model will draft the destination and they will approve it, then asks the worker for that draft and holds the first two lines of that reply. Those are the only lines the session will see. It shows those lines to the operator and asks for a yes or a no through the extension, the same kind of operator pick pi-ctx already uses. Yes writes one destination with that text, superseding every other live destination, so the new record is the one `destinationMd` injects. An older destination is replaced. No asks for another draft. The worker's `ctx_record`, and a chat reply of "yes", do not approve. Phase 2 does not start until the write succeeds.

2. Questions. The list is every unblocked, unmarked, unclaimed, live question in the bound project, oldest first. Not a subset, and not a copy. The worker settles those by superseding them. No notice is required. A question with the ask-operator marker is not claimed and not superseded by the worker. The loop surfaces that question and pauses. The marker is not `blocks`, and the worker does not set it because a model disagreed. It is set because the operator said to ask. When the only remaining questions are blocked, it pauses and names those questions and the live records that block them. A question is settled when a later record supersedes it. Closing the claim, filing a finding, or the worker saying it is done does not settle it. When a turn ends and the workable list still has a question, the extension starts one more turn, unless that turn made no progress: no tool results, and the frontier, the claim, and the destination are unchanged. It does not start that extra turn when a message is already queued; Pi will deliver the queue. It does not abort the turn that is already running. A no-progress end stays armed and does not spend another model call until the operator sends a message.

3. Done. The worker saying "done" does not call the judge while any unblocked question is still live. When none are, the extension asks for the done-claim. That claim is the only judge call. The packet is the approved destination (those two lines), the live constraints, the records that superseded the questions, and the products named in the claim, including their contents. The judge is told that a claim which names no product is not done. If the extension cannot put a named product's contents into the call, it does not call the judge and pauses. A not-done verdict returns the worker to the missing work with that summary. Two rejected claims in a row pause when no named product other than `first-questions.md` changed bytes and no new product file was named, and that pause shows both summaries. The tenth not-done pauses even if the products changed, and shows the last summary and the count. A done verdict finishes, including on the tenth call. A new `/ctx-go` after a pause starts the count at zero. The count does not reset because the products moved. A judge call that errors is not a rejection and is not done; it pauses and shows the error. A `done` verdict on the destination does not disarm the loop. It records the verdict and asks the worker to read the project's first-questions.md and record each still-owed outcome as a CTX question. The worker does not claim the project complete on that turn. When those questions are settled, the next claim must name that file or the loop pauses without calling the judge. Only a later `done` on that claim disarms the loop. The worker cannot set the judge's model, and it has no tool that ends the loop.

### Justified components

- One contradiction read of the live records before the draft, a question, or a claim. Fact 16. The id set is remembered so an unchanged project is not read again. A formal `liveConflict` is listed without asking the model to notice it. Nothing is superseded.
- A `pi.extensions` entry and a bound-CTX check. Facts 1 and 8. When not bound, the operator is told to bind. Fact 15. Nothing is asked of the model.
- One operator notice before the draft, saying the model will draft and the operator will approve, then the existing draft prompt. Fact 15. The notice is not a list and not a second turn.
- `/ctx-go` and `/ctx-stop` as commands, not tools. Fact 8.
- A held two-line draft plus an operator pick that writes one superseding destination. Facts 5, 6, 7, and 12. Nothing smaller works: harvest cannot store the draft, and a second live destination is not the one injected.
- A continuation from the end of a turn, skipped when the turn made no progress or a message is already queued. Facts 9, 11, and 14. Pi already continues tool use inside the run.
- The frontier as the list. A question counts as settled only once it is superseded. An ask-operator marker pauses that question. `blocks` does not. Pause when only blocked questions remain. Facts 2, 3, 4, and 13.
- One judge call, inheriting the session model and thinking level unless the operator overrode it, with the fixed packet. Fact 10. The override is held by the extension. The worker has no tool that sets it.
- A judge-call count in extension memory, reset only by a new `/ctx-go` after a pause, not by product progress. Pause when two rejected claims show no product-byte progress, or the tenth call is not-done. Facts 9 and 11.

### Explicitly rejected approaches

- A judge of the work along the way, or a second model that chooses what to read. Fact 10. The kickoff read in Fact 16 is not that judge: it cannot say the project is done, and it does not run on later turns.
- Retiring a contradicting record from the kickoff read. Fact 16. The operator supersedes it.
- The worker grading itself, or the worker picking the judge. Fact 10.
- A code-and-tests checklist. Fact 10. The work may not be code.
- pi-goal-x, `/goal`, or any checklist that is not the frontier. Fact 2.
- Continuing by aborting the live run, or by pi-ctx's compaction resume. Fact 9. That resume does not fire once the run is idle.
- Harvest, or an unapproved `ctx_record`, as the destination. Fact 6.
- Storing the approved sentence without superseding the older destination. Fact 5.
- An agent-callable stop, including a worker message that means "I am done" or "I am asking the operator" before the extension's own phase rules say so. Facts 8 and 11.
- Remembering "go" or the rejection count only in the model transcript. Fact 9.
- Treating "Grok at medium thinking" as the judge's thinking level. Fact 10.
- A discussion, checklist, or tutorial until `/ctx-go` can work. Facts 2 and 15. The missing cases are two, and each has one next action.
- The extension binding CTX, or prompting the model to bind. Fact 15.
- Guiding the question loop, the judge, or record writing before the questions start. Fact 15. That guidance is the loop.
- Stopping when the judge accepts the two-line destination. Fact 10. That acceptance is not the project.

## Open questions on foundations

None. The operator is asked only when a live decision titled "Ask the operator" lists the question id in `asks`. `/ctx-ask` writes it and `/ctx-ask clear` supersedes it. `blocks` is not that marker, and `ctx_record` does not accept `asks`.
