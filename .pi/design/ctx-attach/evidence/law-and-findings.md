# Evidence — what a bound session can write, copied 2026-10-09

## Supersede is not type-specific

Source: `pi-ctx/src/fold.ts`, `foldLive`.

Any record with `supersedes` adds those ids to the superseded set. The first record for an id wins (`byId.has`). Two live successors of one parent stay live and are reported as `live_conflict`.

## Constraint is the only mint that hits gate or live_conflict

Source: `pi-ctx/src/mint.ts`, `putJudgment`.

`live_conflict` and `gate` return only when `record.type === "constraint"`. Other types, including `finding`, are written when the headline is non-empty. `parent` is copied onto the record and is not checked against a live id.

## What is injected

Source: `pi-ctx/src/render/gated-edge.ts`.

`constraintBodiesMd` injects constraint directives. `destinationMd` injects the destination and out-of-scope headlines. The counts line includes `fog:N`. Findings are not rendered there. `src/promoter/run.ts` also says "Fog text, decisions, and findings are not injected."

## Unknown JSONL types are ignored by the fold

Source: `pi-ctx/src/store/jsonl.ts`, `lineToJudgment`.

If `type` is not a judgment type, the function returns undefined. The line remains in the writer file. `RecordKind` in `src/types.ts` includes `finding` and does not include an attach grant.

## The record tool has no writer role

Source: `pi-ctx/src/tools/register.ts`, tool `ctx_record`.

The enum includes constraint, decision, question, fog, destination, out_of_scope, finding, tombstone, citation, and evidence. Execute calls `runRecordFlow` when the session is bound. It does not branch on a role.
