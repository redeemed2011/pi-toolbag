# pi-engineering-lead

Engineering Lead (Sam's Grok Bot on bb-file) and the pi agent talk through [`dev-agent-bridge`](../dev-agent-bridge/README.md). This extension is a thin shim over that program.

- **Arriving messages.** An interactive session polls `dev-agent-bridge` every 3 seconds (`PI_ENGINEERING_LEAD_POLL_MS`). While the agent is idle with nothing queued, it takes every new message and hands them to `pi.sendMessage` as one message that starts a turn. While the agent is working, it only renews its lease (`take --hold`), so a message waits in the inbox, not in pi's memory, and does not interrupt the work. When a turn ends with its work done (the assistant stopped with no tool call), `turn_end` takes the waiting messages, writes them into the session at that boundary, and the agent continues on them. A turn that was aborted, errored, or is still calling tools takes nothing. The editor is never touched, so Sam's draft stays where it is and is not sent. Only the session holding the lease receives. `/engineering-lead listen` moves the messages to this session.
- **Sending.** `engineering_lead_send` (kind, topic, body, reply_to, ctx, commit, file) runs `dev-agent-bridge send` with the body on stdin.
- `/engineering-lead status` shows the listener and how many messages wait. `/engineering-lead release` gives the lease up.

Needs `~/.cargo/bin/dev-agent-bridge` or `DEV_AGENT_BRIDGE_BIN`. Without it nothing is received, and the tool says it is not installed.

## Test

`npm test` here runs the real program against a temporary inbox. `tests/busy-proof.sh` runs real pi in tmux, drops a message while a bash tool is running, and shows it arrive only after that turn finished. `tests/draft-proof.sh` runs real pi in tmux with one model call: it types a draft, drops a message, and shows the draft still in the editor and absent from the session.
