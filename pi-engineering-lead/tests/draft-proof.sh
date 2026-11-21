#!/bin/bash
# Proof: an Engineering Lead message arriving while Sam types leaves his draft untouched and unsent.
set -u
D=$(mktemp -d /tmp/el-proof-XXXX); mkdir -p $D/inbox $D/sessions $D/cwd
REALPI=/home/bo/.nvm/versions/node/v24.21.0/bin/pi
S=elproof$$
tmux new-session -d -s $S -x 160 -y 45 -c $D/cwd "env DEV_AGENT_BRIDGE_INBOX=$D/inbox DEV_AGENT_BRIDGE_STATE=$D/state DEV_AGENT_BRIDGE_LOG=$D/log.jsonl DEV_AGENT_BRIDGE_SECRETS=$D/none.json PI_ENGINEERING_LEAD_POLL_MS=1000 $REALPI -ne -ns -e /home/bo/src/pi-toolbag/pi-engineering-lead/index.ts --session-dir $D/sessions --model anthropic/claude-haiku-4-5 ; sleep 600"
sleep 8
tmux send-keys -t $S -l "my unsent draft about lunch"
sleep 1
ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
echo "{\"v\":1,\"id\":\"$ID\",\"from\":\"engineering-lead\",\"to\":\"dev-agent\",\"topic\":\"proof\",\"kind\":\"note\",\"reply_to\":null,\"body\":\"Proof note: reply with exactly the word ACKPROOF and nothing else.\",\"refs\":{},\"sent_at\":\"2026-11-21T13:50:00-06:00\"}" > $D/inbox/$ID.json
sleep 25
tmux send-keys -t $S -l " and more"
sleep 1
tmux capture-pane -t $S -p > $D/pane.txt
cat $D/pane.txt
echo "=== state"; ls $D/state $D/state/delivered
echo "=== session user messages"; cat $D/sessions/*.jsonl | python3 -c '
import sys,json
for l in sys.stdin:
  e=json.loads(l); m=e.get("message") or {}
  if e.get("type") in ("message","custom_message") : print(e.get("type"), m.get("role") or e.get("customType"), str(m.get("content") or e.get("content"))[:140])
'
tmux kill-session -t $S
echo DIR=$D
