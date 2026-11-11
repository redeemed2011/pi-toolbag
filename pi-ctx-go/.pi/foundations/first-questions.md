# First Questions

**Session date**: 2026-11-04
**Revisited**: 2026-11-11
**Status**: REVISITED

## The one-sentence goal

> "A new Pi extension that runs only while CTX is bound keeps that session working through the open CTX work until a separate model judge, asked only at the claim of done, recommends it is done, and the operator who said go accepts that result."

The directory `pi-ctx-go` holds this contract so it does not replace the 2026-10-14 failover contract in `pi-toolbag/.pi/foundations/`. The extension's home is pi-toolbag. The package name is not part of the goal.

## Interrogated items

### A new extension that requires CTX

- **Original request**: "the sentence would be regarding a new extension that directly requires CTX to function."
- **Source / who / when**: User, 2026-11-04, after rejecting pi-goal-x as the home for this behavior.
- **Alignment with the goal**: Strong
- **Outcome**: KEPT
- **Challenges**: Putting the loop inside pi-ctx would mix the record store with a clock. The user asked for a separate extension that cannot function without CTX. A mode flag inside pi-ctx is the smaller code change and still fails that request.
- **Decision rationale**: pi-ctx remains the store. This extension does nothing useful when CTX is missing or unbound.

### CTX is the source of truth and the work list

- **Original request**: "we can do that while supporting CTX as the source of truth and list of work to do."
- **Source / who / when**: User, 2026-11-04.
- **Alignment with the goal**: Strong
- **Outcome**: KEPT
- **Challenges**: pi-goal-x kept its own objective, focus, and completion state. That second list is why a session could report the task complete while the CTX destination was still open. No current law forces a second list.
- **Decision rationale**: The open CTX work is the only list. The extension does not keep a parallel goal, focus, or checklist.

### Continue until the work is done

- **Original request**: "the only thing i like is the goal (continue the work unto completion)."
- **Source / who / when**: User, 2026-11-04, naming the one pi-goal-x behavior to keep.
- **Alignment with the goal**: Strong
- **Outcome**: KEPT
- **Challenges**: "Unto completion" without a definition of done is how a session runs all night. The confirmed sentence stops at the judge's agreement, not at the worker's own stop. The operator says go once. Typing continue after every compaction is the behavior this exists to remove.
- **Decision rationale**: After the operator says go, the extension keeps the bound session working until the judge agrees the project is done. Agreement that the two-line destination is met is not that stop. The worker then records still-owed outcomes from the project's first-questions.md as CTX questions, and a later claim names that file.

### A separate model judge, only when done is claimed

- **Original request**: "the LLM judge that determines if it really completed the work." Then: "does it need to judge along the way?" The confirmed sentence says the judge is asked only at the claim of done.
- **Source / who / when**: User, 2026-11-04.
- **Alignment with the goal**: Strong
- **Outcome**: MODIFIED to one judgment, by a model other than the worker, and only when completion is claimed.
- **Challenges**: The worker grading itself is the false "task complete" from the apple-pi session. Judging every slice was the other way that session scored a small contract finished while CTX work remained. One end check is the smallest version that still answers "did it really finish."
- **Decision rationale**: The worker does not grade itself. No model is asked to judge progress along the way.

### Judge along the way

- **Original request**: "does it need to judge along the way?"
- **Source / who / when**: User, 2026-11-04. Answered no, then the user confirmed the sentence that excludes it.
- **Alignment with the goal**: None
- **Outcome**: DELETED
- **Challenges**: A mid-run judge feels like quality control. It is a second clock, it costs a full opinion every slice, and it can call a slice done. Nothing in the goal requires it.
- **Decision rationale**: Cut. Completion is judged once, at the claim of done.

### Stop without a model when the loop is not finishing

- **Original request**: Not requested. Stated as the smallest brake once mid-run judging was cut.
- **Source / who / when**: Assistant, 2026-11-04. User confirmed this brake the same day: stop when the operator is waiting, the operator paused, or a continued turn made no progress.
- **Alignment with the goal**: Strong
- **Outcome**: KEPT
- **Challenges**: This can be padded into a policy engine. The goal only needs the loop to be finite. A turn that made no progress never reaches a done-claim, so the judge never runs, and the session spends until the operator notices.
- **Decision rationale**: Without a model, stop when the operator is waiting, the operator paused, or a continued turn made no progress. Do not build any richer mid-run review. A repeated done-claim the judge rejects is a separate stop, recorded below. It is not this brake.

### Lives in pi-toolbag and ships on

- **Original request**: "the extension shall exist in pi-toolbag and be enabled by default just like the other extensions."
- **Source / who / when**: User, 2026-11-04.
- **Alignment with the goal**: Strong
- **Outcome**: KEPT
- **Challenges**: The other extensions are not toggled on in settings. `pi-toolbag` `package.json` lists them in `pi.extensions`, and the installed package is `/home/bo/src/pi-toolbag`. A default-off flag or a second install would not be "like the other extensions." Loaded is not the same as working: the goal still requires CTX to be bound and the operator to have said go.
- **Decision rationale**: The extension is a sibling in pi-toolbag and is listed in `pi.extensions`, so it loads with the package. It stays idle until CTX is bound and the operator says go.

### Name it ctx-go

- **Original request**: "we can call it ctx-go or something."
- **Source / who / when**: User, 2026-11-04.
- **Alignment with the goal**: None
- **Outcome**: DEFERRED
- **Challenges**: The name does not change the outcome. The home is already decided. Locking the name now only makes the folder match a shrug.
- **Decision rationale**: The extension lives in pi-toolbag. What it is called can change before any package is published.

### pi-goal-x

- **Original request**: "uninstall pi-goal-x. i don't like it."
- **Source / who / when**: User, 2026-11-04. Removed from `~/.pi/agent/settings.json` the same day.
- **Alignment with the goal**: None
- **Outcome**: DELETED
- **Challenges**: It already implemented continue-until-done and a completion audit. Those ran on a goal contract, not on CTX, and the apple-pi session completed seven goals while the CTX destination stayed open. Reinstalling it and wiring CTX beside it keeps the second list.
- **Decision rationale**: Do not reinstall pi-goal-x. Do not rebuild `/goal`, goal focus, checkpoint continuation, or a completion audit of a non-CTX contract.

### Continue by aborting the live run

- **Original request**: None. This is the pre-`e8cbfbe` pi-ctx stitch: compact mid-run, abort, then resume.
- **Source / who / when**: Commit `e8cbfbe`, 2026-10-31, written so a mid-run compact would not be recorded as a user pause. The abort also dropped in-flight tool work.
- **Alignment with the goal**: None
- **Outcome**: DELETED
- **Challenges**: Abort-and-resume did keep the apple-pi session moving across 17 compactions. It did that by cutting the run. The goal only requires that work continue after the operator says go. The run that is already going can finish first.
- **Decision rationale**: Continuation starts another turn after the current run settles. It does not abort the live run.

### The worker claims done; the judge can send it back until the claim stops moving

- **Original request**: The worker reports that it thinks it is done, and the LLM judge judges that. If the worker says done and the judge says not, more than once, pause for the operator even when a little work happened between those claims. The pause includes what the worker thinks it did and what the judge said.
- **Source / who / when**: User, 2026-11-04. "Barker" and "OLM" in the dictation are read as "worker" and "LLM." Changed by the operator on 2026-11-06: keep giving the judge's feedback while the claim moves, stop when two rejections in a row show no meaningful progress, and cap judge calls at ten.
- **Alignment with the goal**: Strong
- **Outcome**: CHANGED on 2026-11-06. The 2026-11-04 rule paused on the second rejection even when the products had changed.
- **Challenges**: One rejection cannot pause, or the judge can never send the worker back. Pausing on the second rejection also throws away feedback the worker is still acting on. Progress cannot be another model, and the CTX fingerprint stays still while the named files change. Editing only the contract, or rewording the claim, would otherwise count as movement. Ten calls is the bound for a workflow that never stalls. The worker does not win the disagreement and cannot declare the pause.
- **Decision rationale**: The worker's done-claim is what calls the judge. A judge call is one completed verdict, done or not-done. A packet error is not a call. A not-done verdict continues, and the worker is given that summary. Two rejected claims in a row pause when no named product other than `first-questions.md` changed bytes and no new product file was named. That pause shows both summaries. The tenth not-done pauses even if the products changed, and shows the last summary and the count. A done verdict finishes, including on the tenth call. Rewording the claim, or editing only `first-questions.md`, is not progress. A new `/ctx-go` after a pause resets the count. The count does not reset because the products moved. The agent is not given a way to declare that pause.

### Judge model follows the session, with an override

- **Original request**: Inherit whatever provider, model, and thinking level the agent is using, and allow an override of each.
- **Source / who / when**: User, 2026-11-04.
- **Alignment with the goal**: Strong
- **Outcome**: KEPT
- **Challenges**: A fixed frontier judge would ignore the session the operator is actually running. An override that the worker can change would let the worker pick its own grader.
- **Decision rationale**: The judge uses the session's provider, model, and thinking level unless the operator overrides them. The worker does not choose the judge.

### The judge looks at the work that happened, which may not be code

- **Original request**: Look at the CTX records, the files that changed, the tests, and anything else relevant. The work might be a report, an investigation, or a draft, not code. Keep it simple. The operator gave Grok at medium thinking as an example of a less-than-frontier model that would have to understand the check. That example is not the judge's thinking level. If a fixed prompt cannot do that, the judge may have to decide what to look at from the session and the CTX records. That part is not settled.
- **Source / who / when**: User, 2026-11-04.
- **Alignment with the goal**: Strong
- **Outcome**: MODIFIED to a fixed packet. The judge sees only the approved destination, the CTX constraints, how the questions were closed, and the products named in the worker's done-claim. It must not assume the work is code.
- **Challenges**: A code-and-tests checklist fails a writing task. Letting the judge search the session for what is relevant is the unsettled part, and the operator rejected it by approving the fixed packet. A second pass that builds a reading list is a second judge.
- **Decision rationale**: The operator approved this packet on 2026-11-04. If the done-claim names no product, the judge says not done. The judge does not go looking for other work.

### `/ctx-go` starts it; the agent cannot stop it

- **Original request**: Use a command like `/ctx-go` to trigger the process. The user must be able to force a stop without giving the agent the ability to stop it.
- **Source / who / when**: User, 2026-11-04.
- **Alignment with the goal**: Strong
- **Outcome**: KEPT
- **Challenges**: A stop tool the model can call is the agent stopping itself. A slash command is handled by the extension, and the model has no tool for it. The user rejected `/ctx-go stop`.
- **Decision rationale**: `/ctx-go` starts the loop. `/ctx-stop` stops it. Both are commands the agent cannot call.

### Questions first, then the destination

- **Original request**: The operator chose "Questions first, then the destination" after the four options were spelled out.
- **Source / who / when**: User, 2026-11-04.
- **Alignment with the goal**: Strong
- **Outcome**: KEPT
- **Challenges**: A destination has no done bit, so the destination alone never ends. Open questions alone ignore the destination. One claimed question stops while the project is still open. A question only the operator can answer must pause, not be worked as if the agent could answer it.
- **Decision rationale**: `/ctx-go` works the unfinished CTX questions. A question pauses for the operator only when a CTX marker says to ask them. When the unmarked questions are settled, the worker claims the destination is met, and the judge checks that claim.

### Ask the operator only when the record is marked

- **Original request**: A question requires the operator only when the operator specifically said to ask them. Otherwise the worker figures out the details. If a bubble-up is necessary, it is a marker on the CTX record, and pi-ctx may be changed to support that marker.
- **Source / who / when**: User, 2026-11-04.
- **Alignment with the goal**: Strong
- **Outcome**: KEPT
- **Challenges**: CTX has no such marker. `blocks` means a live record listed the question id, and `ctx_claim` then refuses it. That is "not yet," not "ask the operator." Reading the question text to decide is a second judge. A three-judge swarm that decides whether to ask is the mid-run judge already cut.
- **Decision rationale**: Unmarked questions are the worker's. A marked question is surfaced and is not settled by the worker. The marker is set because the operator said to ask, not because a model panel disagreed. pi-ctx records it as a decision titled "Ask the operator" with `asks` set to that question id. The operator sets and clears it with `/ctx-ask`. `ctx_record` cannot. This extension does not gain a judge swarm.

### The worker drafts the destination; the operator approves it

- **Original request**: The operator does not want to write the destination sentence. The agent doing the work may populate it, and the operator approves it.
- **Source / who / when**: User, 2026-11-04.
- **Alignment with the goal**: Strong
- **Outcome**: KEPT
- **Challenges**: The injected destination is the first live destination record, and only its first two lines. Bind-time harvest will mint a destination only from the operator's verbatim words, and only when the project has none. A worker calling `ctx_record` can store a sentence the operator never approved. An approval that is only the word "yes" is not the sentence, so harvest will not store the draft.
- **Decision rationale**: The destination the judge checks is a sentence the worker drafted and the operator approved. The operator does not have to compose it. An unapproved draft is not the destination. Approval happens at the start of `/ctx-go`, before the unfinished questions are worked. The operator confirmed that timing.

### Guide until `/ctx-go` can work

- **Original request**: "the extension should present a way to guide the user or AI or both to the point of making /ctx-go functional (achieve the requirements for /ctx-go). it may mean a discussion on what remains."
- **Source / who / when**: User, 2026-11-05, after a live `/ctx-go` stopped at the destination draft.
- **Alignment with the goal**: Strong
- **Outcome**: MODIFIED to one next action for whoever can take it. Confirmed by the operator, 2026-11-05.
- **Challenges**: The goal already says the loop runs only while CTX is bound, and only after the operator says go and approves a drafted destination. Those two gaps are the whole of "not yet functional." A discussion of what remains can become a second loop, which the contract already cut. The model cannot bind a project. The extension cannot speak if it is not loaded. Teaching the question loop, the judge, or how to write records is the loop itself, not a preface.
- **Decision rationale**: When `/ctx-go` cannot yet work the questions, it names the one missing requirement and the one next action. If CTX is not bound, it tells the operator to bind. The model is not asked to bind. If there is no approved destination, it tells the operator that the model will draft and they will approve, and it tells the model to draft. No checklist, no tutorial, and no discussion mode.

### The work is not the session directory

- **Original request**: The working-directory check breaks work across repos, work that is not a repo, and work that is not files: investigations, email, blogs, clusters, cloud providers, and research. CTX is not limited to a working directory, and ctx-go must not be either. The point is that the agent keeps going until the work is done, whatever that work is. The judge should be able to use the session, the CTX records, and what the agent pointed at, and notice if a rogue agent is misleading it.
- **Source / who / when**: User, 2026-11-05, after the judge paused on `/home/bo/src/apple-pi/.pi/foundations/first-principles.md` because the Pi session cwd was `/home/bo/src/projects`.
- **Alignment with the goal**: Strong
- **Outcome**: MODIFIED. Confirmed by the operator, 2026-11-05.
- **Challenges**: The approved packet already says the work may be a report, an investigation, or a draft, not code. Nothing in that approval says the product has to sit inside the Pi process directory. The directory check was added later as a guard so a claim could not hand the judge an arbitrary file. That guard is what stopped this claim. On 2026-11-04 the operator also cut a judge that searches the session for what is relevant. "Let the judge look around" is that cut, reopened. A judge that can read any path, mailbox, or cluster on its own is a second investigation, and a claim that can point at any path can also put a secret in the judge's prompt.
- **Decision rationale**: A product is whatever the done-claim points at. If it is a file, the judge is given that file even when it is outside the session directory. If it is not a file, the claim's account of it is the product. The packet stays the destination, the constraints, how the questions were closed, and those products. The judge does not browse the session, the disk, or remote systems for other work. Noticing a misleading claim is the judge's verdict on that packet, not a search.

### Surface a project that contradicts itself before the work starts

- **Original request**: "in the other session, it was discovered the ctx project was conflicting itself. i think part of ctx-go's kickoff should be to detect and surface those issues before we continue."
- **Source / who / when**: User, 2026-11-11, pointing at session `01a14602-6015-725c-ba9d-b9898afb9413`. That session evaluated the apple-pi project and found 284 live records and no formal conflict.
- **Alignment with the goal**: Strong
- **Outcome**: MODIFIED to one kickoff pause that names the contradicting live records and does not retire them.
- **Challenges**: The fold already surfaces `live_conflict` when two successors share one parent, or when two live constraints share a headline. That check missed the apple-pi case. Records there were replaced in words and never superseded, so both copies stayed law: several still said the judge finishes, while a later record said only the operator finishes. Copies that say the same thing are not a conflict. A model that retires the losers would be the worker rewriting the contract. A model that grades the work at kickoff is the mid-run judge already cut. Checking again on every turn is a second loop.
- **Decision rationale**: Before `/ctx-go` drafts, works a question, or takes a claim, one read of the live records lists pairs that contradict and that neither one superseded. It includes a formal `live_conflict`. It skips copies that agree. It shows the pairs to the operator and pauses. It does not supersede anything, and it is not the completion judge. The next `/ctx-go` continues when that live set is unchanged. A changed set is read again. If the read fails, `/ctx-go` names that and does not start the work.

## Deleted / avoided scope

- Judge along the way — a second clock that can finish a slice while CTX work remains.
- pi-goal-x — its own goal contract, `/goal`, focus, and checkpoints. Already uninstalled.
- A work list that is not CTX — the list that reported done while the project was open.
- Continuing by aborting a live run — drops in-flight tool work to simulate continuity.
- A mid-run review richer than "waiting, paused, or no progress" — padding on the smallest brake.
- Treating the package name as part of the goal — deferred, not designed.
- An agent-callable stop — the model must not be able to end the loop.
- The operator must write the destination — the worker drafts it, and the operator approves it.
- An unapproved destination — a worker-recorded sentence the operator has not approved is not the one the judge checks.
- A judge that searches for relevant work — the packet is fixed. A second pass that builds a reading list is a second judge.
- A discussion until `/ctx-go` feels ready — the missing requirements are already two, and a second conversation does not make the loop finite.
- A checklist or tutorial product — the extension already has an operator message and a model prompt.
- The extension binding CTX, or guiding while it is not loaded — bind stays the operator's, and an unloaded extension cannot present anything.
- Guiding the question loop, the judge, or record writing — that is the loop, not a requirement for starting it.
- Products must live in the Pi session directory — the operator did not require that. The directory check is what stopped a real file in another tree.
- Auto-retiring a contradicting record at kickoff — the operator retires it. The kickoff only names the pair.
- Treating agreeing copies as a conflict — the apple-pi session found duplicate decisions that said the same thing. Those are not the issue.
- A contradiction check on every turn — one read at kickoff, then again only if the live set changed.

## Open questions

None, pending the operator's yes on the kickoff pause. The 2026-11-05 product rule stays as confirmed.
