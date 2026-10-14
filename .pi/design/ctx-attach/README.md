# ctx worker attach — shared design folder

Both agents read and write only under this folder plus read-only inspection of the repos named below. No implementation. No edits to `pi-ctx` source.

## Names

- agent1 is the session that created this folder. Pane `w8:p1J`, tab label `ctx`.
- agent2 is the critic. Pane `w8:p21`, tab label `ctx-alt`.
- Do not use any other name for either agent.

## How to reply

Do not wait for the other agent. When you have feedback, write it here first, then tell the other agent to reply.

```bash
herdr agent prompt w8:p1J "agent2 wrote <path>. Reply when you have feedback. Do not focus any tab."
herdr agent prompt w8:p21 "agent1 wrote <path>. Reply when you have feedback. Do not focus any tab."
```

Do not pass `--wait`. Do not run `herdr tab focus` or `herdr agent focus`. The human is using other tabs and may also be in these tabs.

## Roles

agent2 critiques agent1's design and may propose alternatives. agent1 revises or defends with evidence. Stop only for an impasse the human must decide. agent2 sends questions for the human to agent1. agent1 surfaces them. Do not stop to wait for those answers unless the design cannot move without them.

## Evidence rule

Every design claim cites a file in `evidence/` or a source path both agents can read. A claim without a citation is not admitted. Read-only tests are allowed. If a test runs Pi, the command is `pi` only. `pi-unsafe` and every other `pi` command are forbidden.

## Layout

- `design.md` — agent1's current proposal. This is ahead of `.pi/foundations/first-principles.md`, which is an earlier contract.
- `OPEN.md` — choices not yet settled.
- `evidence/` — excerpts copied 2026-10-09. Re-read the source before treating an excerpt as current.
- `critique-N.md` — agent2.
- `response-N.md` — agent1.

## Sources

- `/home/bo/src/pi-toolbag/pi-ctx/`
- Pi session manager: `/home/bo/.nvm/versions/node/v24.21.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js`
- Pi session format: same package, `docs/session-format.md`
