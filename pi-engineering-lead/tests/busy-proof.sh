#!/bin/bash
# Proof: an Engineering Lead message that arrives while the agent is mid-turn waits in the inbox,
# does not interrupt the running tool or the turn, and joins the session only after that work is done.
set -u
D=$(mktemp -d /tmp/el-busy-XXXX); mkdir -p $D/inbox $D/sessions $D/cwd
REALPI=/home/bo/.nvm/versions/node/v24.21.0/bin/pi
S=elbusy$$
tmux new-session -d -s $S -x 160 -y 45 -c $D/cwd "env DEV_AGENT_BRIDGE_INBOX=$D/inbox DEV_AGENT_BRIDGE_STATE=$D/state DEV_AGENT_BRIDGE_LOG=$D/log.jsonl DEV_AGENT_BRIDGE_SECRETS=$D/none.json PI_ENGINEERING_LEAD_POLL_MS=1000 $REALPI -ne -ns -e /home/bo/src/pi-toolbag/pi-engineering-lead/index.ts --session-dir $D/sessions --model anthropic/claude-haiku-4-5 ; sleep 600"
sleep 8
tmux send-keys -t $S -l "Run this one bash command exactly: sleep 20; echo SLEPT. Then reply with exactly the word FINISHED and nothing else."
tmux send-keys -t $S Enter
sleep 8
ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
echo "{\"v\":1,\"id\":\"$ID\",\"from\":\"engineering-lead\",\"to\":\"dev-agent\",\"topic\":\"proof\",\"kind\":\"note\",\"reply_to\":null,\"body\":\"Proof note: reply with exactly the word ACKPROOF and nothing else.\",\"refs\":{},\"sent_at\":\"2026-11-21T13:50:00-06:00\"}" > $D/inbox/$ID.json
date +%s.%N > $D/dropped_at
sleep 5
echo "=== while the tool runs: delivered ids"; ls $D/state/delivered 2>/dev/null; echo "(end)"
echo "=== while the tool runs: status"; DEV_AGENT_BRIDGE_INBOX=$D/inbox DEV_AGENT_BRIDGE_STATE=$D/state ~/.cargo/bin/dev-agent-bridge status
sleep 40
tmux capture-pane -t $S -p > $D/pane.txt
cat $D/pane.txt
echo "=== state"; ls $D/state/delivered
echo "=== session order"; cat $D/sessions/*.jsonl | python3 -c '
import sys,json
for l in sys.stdin:
  e=json.loads(l); m=e.get("message") or {}
  t=e.get("type")
  if t not in ("message","custom_message"): continue
  c=m.get("content") if t=="message" else e.get("content")
  if isinstance(c,list): c=" | ".join(x.get("text","") if x.get("type")=="text" else x.get("type")+":"+json.dumps(x.get("arguments",""))[:80] for x in c)
  print(e.get("timestamp"), t, m.get("role") or e.get("customType"), m.get("stopReason",""), str(c)[:120].replace("\n"," "))
'
tmux kill-session -t $S
echo DIR=$D
