# Implementation plan — worker attach

Ctx does not start workers or read their replies. The behavior is `design.md`. This file is only the order of work. Fork, clone, and the bind prompt stay as they are.

## 1. `ctx_grant` and the token hash

One helper hashes the token. `ctx_grant` and `ctx_attach` both call it. Attach tests do not build the grant line by hand.

A session you bound names a live question. The tool refuses otherwise. It does not look at the current focus, and it does not run the claim-size check.

It appends one line to this session's project log: its own id, a type the law loader ignores, a timestamp, this session, the question id, and the hash of a new token. `parseJsonl` keeps a line only when it has `id`, `type`, `ts`, and `session` (`pi-ctx/src/store/jsonl.ts`). It returns the project id and the token. The token is not a secret. The same token may be used by more than one fresh session.

## 2. Fold, worker refusals, and `ctx_attach` land together

`foldSession` reads the last `ctx.bind`. Today it keeps only `project_id` (`pi-ctx/src/fold.ts`). Expose `grant_id` and `question_id` from that same entry.

- A bind with a project id and no `grant_id` is a session you bound. A legacy bind stays one. It may grant.
- A bind with a `grant_id` is a worker. It may not grant. The granted question id comes from that bind.
- A later `{ project_id: null }` is neither. The session is unbound.
- A fork copies the entry, so a fork of your session stays able to grant. Do not add a session stamp or a `parentSession` check.

In the same change, `ctx_grant` reads the new fold and refuses a worker. A worker is refused by `ctx_record`, `ctx_bind`, and `ctx_grant`. The `ctx_claim` tool may report status, drop focus, or take the granted question back only while it is live. That limit is in the tool's `execute`, not in `applyClaim`. `applyClaim` is also used by `/ctx claim`, and that slash command is the human (`design.md`).

`ctx_attach` is in this same change. A session attaches only when no `ctx.bind` exists anywhere on its branch, including an unbind. The fold's last bind is not enough, because an unbind collapses to "not bound".

Refuse unless the project id matches `^[a-z0-9-]{1,64}$` and the project file's id is that same string. Do not create a project. Look up the grant directly in that project's logs, using the shared hash helper. The law loader will not see it.

Then run the normal claim check for that question, including blocked and too-large, using this session's occupancy. Pass the check a bound project even though the session is not bound until the write. If it is not `ok`, write nothing. If it is `ok`:

- Append this session's bind, with the project id, grant id, and question id, and its focus. Do not harvest.
- Set `runtime.bound`, `runtime.projectId`, and `runtime.claimedId`, call `runtime.reloadProject()`, and publish the bound status with the project name. Writing the branch entries is not enough. The next tool call re-syncs, but the context hook and pending-replace do not (`bind.ts` does this for a normal bind; `context-hook.ts` reads law from `runtime.projectRecords`; pending-replace returns while `runtime.bound` is false).

The success test is a round trip. An orchestrator calls `ctx_grant`. A fresh session calls `ctx_attach` with the returned project id and token, and the attach succeeds. One test then runs the context hook and the pending-replace gate before any other ctx tool call, and expects the worker to see law and to be eligible for pending-replace. A tool call would reload the runtime and hide a missed update. The same change also calls `ctx_grant` and `ctx_record` on that worker and expects both to be refused.

## 3. `ctx_finding`

The tool refuses unless this session is a worker. Two raw fields only: headline and body. Reject any other raw field inside the tool handler. The schema will not do it. The server sets the type, the parent question from the grant on the fold, the id, the timestamp, and the session. The question does not have to still be live. `putJudgment` does not require a live parent. Return the new id. The write then follows `ctx_record`: append the project record and reload.

Dropping focus does not revoke the grant. A later finding is still allowed.

## 4. Looking up a question

A question lookup also returns the findings whose parent is that question: id, session, headline, and whether the finding is still current. The body stays on a separate lookup. Findings are not injected.

## 5. One fix that is not a new tool

After unbind, the focus stays on the branch, and the close-and-claim question is asked before the bound check. That question must not appear while the session is unbound. Pending-replace already returns when unbound, and it must keep running in a worker session. Bind already refuses when there is no UI, so the bind prompt needs no change.

## 6. Guidelines

`promptGuidelines` is static text on the tool. Every session sees it. Add guidelines for `ctx_grant`, `ctx_attach`, and `ctx_finding`, using those names. The `ctx_finding` guideline tells a worker to file with `ctx_finding`, not `ctx_record` or `ctx_bind`, and to claim only its granted question. The existing bind and record guideline text stays as it is.

## Out of scope

No pull tool, no role field, no second grant on the same branch, no lock between workers, and no attempt to stop a process that can write the ctx directory.

## Tests

Write each layer's tests with that layer, in the existing `pi-ctx` suite. Not a final pass. Cover the grant line and the shared hash in section 1, the fold cases and the round trip in section 2, the `ctx_record`, `ctx_bind`, and `ctx_grant` refusals and the hook checks in section 2, the finding allowlist, question lookup, and the unbound close-and-claim guard.
