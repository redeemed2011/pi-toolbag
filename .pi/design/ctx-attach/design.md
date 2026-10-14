# Worker attach

Ctx keeps a project's memory after a session ends or is compacted. The law you confirmed, the open questions, and which question this session is focused on survive in the project log and on the session branch. The model is not trusted to remember them, and a prompt is not trusted to enforce them. The tools read and write them.

The long horizon is many sessions on one project. Each session can compact or be replaced. The rules do not reset, and a new session does not silently become a second author of those rules.

## What this adds

You already bind a session to a project. That session can hand one live question to a new session. The new session has its own chat, its own focus, and its own compaction. It can file findings on that question. The tools stop it from changing the project's law, taking your focus, or binding itself somewhere else.

Some other extension starts that session, hands it the project id and a token, and reads its result. Ctx does not start agents, does not carry their chat, and does not look at their replies.

A change of question, or a move to a different project, is a new session and a new grant. The current session does not switch.

## What changes

- A session you bound can grant a live question. Ctx returns the project id and a token. The token only checks that this worker was given this grant. It is not a secret. It is stored in the orchestrator session like any other tool result. The same token can be used by more than one new session.
- A session that has never been bound can attach with that project id and token. On success it is bound to the project and focused on that question. Ctx does not harvest the worker's chat, so that chat does not become law. If the question is not live (missing or retired), blocked, or too large for this session's focus slot, nothing is written.
- The worker files a finding with a headline and a body. Ctx ties it to the granted question and returns the id. Any other field is refused. The worker cannot use the general record tool or bind itself.
- Looking up a question also lists the findings on it: id, which session wrote it, the headline, and whether it is still current. The body is a separate lookup. Findings are not injected as instructions.
- The worker can report its focus, drop it, or take the same question back while the question is still live. It cannot take a different one.
- Ctx does not ask you a question unless this session is bound, except to bind. In a session with a person at the UI, the model's bind tool may open that prompt and you confirm it. A session with no UI cannot bind. Typing `/ctx bind` yourself stays allowed. Pending-replace does not run while unbound, and it still appears in a worker session after three turns because a worker is bound. Accepting it can write a new constraint. Close-and-claim can ask today after you unbind, because unbind leaves the focus in place and the question is asked before the bound check. That question must not appear while unbound. The occupancy confirm already does not: an unbound session has no project records, and that confirm appears only when the switch would overflow.
- Dropping focus does not revoke the grant or delete the question. The worker can still file a finding afterward. That includes a question you have since retired, so a result already in progress is not thrown away. It cannot focus that question again after you retire it.
- A grant is not a lock. Another session can still see and claim the same question. Each session's frontier hides only its own focus.
- Fork and clone stay as they are. A fork of a bound session stays bound and keeps its focus. It cannot attach, because attach only works on a session that has never been bound. If the other extension forks you by mistake, that fork is a second copy of your session, not a worker.

## What stays the same

- Binding still asks you to confirm, still refuses a second bind, and still harvests only there.
- Slash commands in the worker pane are you. `/ctx bind`, `/ctx unbind`, `/ctx claim`, and `/ctx occupancy` are not limited by the worker tools.
- Every session you have already bound can grant. There is no extra step that names one orchestrator.
- A process that can write the ctx directory can still append the project log without calling a tool. These checks do not stop that.

## Why this shape

The worker has to be a real session. One session cannot write another's bind or focus, and the project file stores only the project's id, name, and creation time. The grant goes in the shared log as a line the law fold ignores. The worker then writes the bind and the focus onto its own branch. Compaction does not delete those entries, so the attachment is still there after resume.

Findings are the record that already exists and is not injected. The general record tool is refused because any bound session can use it today, and a record of any type can retire a live rule. A separate finding tool has two fields, so the worker cannot pass a supersede, a new constraint, or a different parent.

Pros:

- The worker's chat cannot become house rules, because harvest runs only when you bind.
- Your focus stays yours. The worker writes its own, and only for the question you granted.
- Attach uses the same focus checks as a normal claim. The worker is not given a focus it could not take itself.
- A finding can still be filed after you retire the question or the worker drops focus.
- Fork keeps the behavior you have now.

Cons:

- The other extension must start a fresh session. Fork copies the whole conversation, and ctx cannot erase that. A forked copy also remains able to grant and to record law, which is what a fork of your session can do today.
- Any session you bound can grant, not only one of them.
- The token only prevents an accidental attach. Anyone who can read the orchestrator session can reuse it.
- Dropping focus does not stop later findings. Focus and permission to write are different.
- Two workers can be on the same question. Nothing in the project serializes them.

## Fork

Decided: fork and clone of a bound session stay bound and keep their focus, as they do today.

A fork copies the whole conversation, so dropping the bind would not give a worker its own chat. Binding again would ask you to confirm and would harvest that chat. Workers are fresh sessions. If one is started by fork, attach fails and the copy remains an orchestrator.

## Decided

- A change of question or of project is a new fresh session. The attached session does not switch grants.
- Any session you bound may grant. That includes a fork of one. A worker may not grant.
- Ctx does not open a user-facing question unless this session is bound. A worker is bound, so it is not exempt from pending-replace. A session with a person at the UI may still bind: the model's bind tool may open that prompt, and you confirm it. A session with no UI cannot bind. Typing `/ctx bind` yourself stays allowed.

## Checks an implementer still has to keep

- Attach accepts a project id only when it matches `^[a-z0-9-]{1,64}$` and the project file's id is that same string. Attach does not create a project. The id is used as a directory name.
- The grant line carries its own id, a type that is not a law record, a timestamp, the writing session, the question id, and a hash of the token. It is read from the project log directly. The law loader skips it.
- The finding tool rejects any raw field other than headline and body inside the tool handler. The schema will not do that. The server sets the type and the parent question.
