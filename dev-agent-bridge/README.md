# dev-agent-bridge

One Rust program for messages between Sam's dev agents and Engineering Lead (Sam's Grok Bot on bb-file). pi (`pi-engineering-lead`) and Brazos (`engineering_lead_send`) both call it. It replaces `grok-bot-made/dev-agent-bridge/bridge_send.py` on this side.

```sh
cargo install --path . --root ~/.cargo     # installs ~/.cargo/bin/dev-agent-bridge
```

Build with `cargo install`, not from a copy under `~/src`: inside cplt, programs under `~/src` cannot run, and `~/.cargo/bin` can.

## Commands

| Command | What |
|---|---|
| `send --kind ask\|reply\|note --topic T (--body B \| --body-file F\|-) [--reply-to ID] [--ctx ID]... [--commit SHA] [--file F] [--id ID] [--dry-run]` | POST one message to Engineering Lead's webhook. |
| `take --session S [--cwd D]` | JSON: the new inbox messages for this session. Only the session holding the lease gets them. |
| `take --session S [--cwd D] --hold` | Renew the lease and take nothing. A busy session uses it so its messages wait in the inbox until its work is done. |
| `listen --session S [--cwd D]` | Make this session the one that receives messages. |
| `release --session S` | Give up the lease if this session holds it. |
| `status` | JSON: the listener, the owner, the inbox, and how many messages wait. |

Message shape and rules are the same as the Python bridge: `{"v":1,"id","from","to","topic","kind","reply_to","body","refs":{ctx,commit,file},"sent_at"}`. An ask gets exactly one reply. Only a reply carries `reply_to`. A body over 8000 bytes, or one that looks like a secret, is refused. At most 20 sends per rolling hour. The same id is never sent twice.

Send exit codes: 0 sent or dry-run ok; 2 invalid; 3 secrets missing or invalid; 4 rate cap; 5 duplicate id or second reply; 6 webhook POST failed; 7 no writable state folder.

## Secrets

`~/ResilioSync/BnBShare/secrets/dev-agent-bridge-webhook.json` with `{"url":"https://...","key":"..."}`, or `DEV_AGENT_BRIDGE_SECRETS`. The key goes only in `Authorization: Bearer` and `X-Automation-Key`. It is never printed, logged, or put in a message; an error that would carry it is redacted.

## Inbox

Engineering Lead writes one file per message: `~/ResilioSync/BnBShare/grokbot/engineering-lead/dev-agent-bridge/inbox/<id>.json` (`DEV_AGENT_BRIDGE_INBOX`). This side only reads the inbox. Inside cplt the share is read-only. Each message is delivered once: `take` records its id under `delivered/` or `rejected/` in the state folder before handing it over. A file whose name is not its id, or that breaks the rules, is rejected once with the reason. A file that is not yet valid JSON gets 60 seconds to finish syncing.

Only one session listens at a time. A session that calls `take` holds a 30-second lease and renews it each poll. Another session gets nothing until the lease lapses, or until it runs `listen`, which makes it the owner.

## State and log

State (sent ids, rate cap, lease, delivered and rejected ids): `DEV_AGENT_BRIDGE_STATE`, else `~/.cache/dev-agent-bridge`. Log: one JSON line per message to `BnBShare/grokbot/engineering-lead/dev-agent-bridge/log.jsonl` (`DEV_AGENT_BRIDGE_LOG`), or `log.jsonl` in the state folder when the share is not writable.

## Test

```sh
cargo test
```
