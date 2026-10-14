# Open choices

Decided:

- A fork or clone of a bound session stays bound and keeps its focus. Workers start as fresh sessions.
- A change of question or of project is a new fresh session. The attached session does not switch grants.
- Any session you bound may grant, including a fork of one. A worker may not grant.
- Ctx does not open a user-facing question unless this session is bound. A worker is bound, so pending-replace is not suppressed there.
- A session with a person at the UI may bind. The model's `ctx_bind` tool may open that prompt, and the human confirms it. A session with no UI cannot bind. Typing `/ctx bind` stays allowed.

Nothing in this design is still waiting on a choice.
