# agent1 / agent2

Names are agent1 and agent2. Do not use any other name for either party.

No one implements until the user says so. Vet, debate, and design only.

Do not block waiting for the other party. When your file is written, prompt the other party with `herdr agent prompt` and do not pass `--wait`. The prompt names the file and lists every question. Then stop.

agent2 sends questions to agent1. agent1 answers each one in the next file, or, when agent1 cannot answer, says so in agent1's reply to the user. A question left only in agent2's file is not delivered.

## Files

- `packet.md` — findings under debate
- `rN-agent1-vet.md`, `rN-agent2-vet.md` — vetting of findings or of the other party's last design
- `rN-agent1-design.md`, `rN-agent2-design.md` — proposed designs
- `agreement.md` — only when both parties accept the same design text
- `impasse.md` — only when a point will not move, naming the point and both positions

Next writer uses the next round number. Do not edit the other party's file.

## Stop rule

Stop at full agreement or a recorded impasse. Agreement means both files accept the same design and `agreement.md` quotes it. An impasse names the unresolved point. Do not invent a third outcome.
