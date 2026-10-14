# Evidence — bind, copied 2026-10-09

Source: `/home/bo/src/pi-toolbag/pi-ctx/src/commands/bind.ts`

`runBindFlow` refuses when already bound, refuses without a UI, confirms, writes `ctx.bind` as `{ project_id, project_name }` only, then calls `harvestAfterBind`.

```
if (runtime.bound && runtime.projectId) {
  return { ok: false, error: "already bound; unbind first" };
}
if (!hitl.hasUI) return { ok: false, error: "bind requires HITL" };
```

The confirm text states that harvest may record house rules and also "fog, decisions, and findings". Those last three "are stored and not injected."

`runUnbind` appends `{ project_id: null }` on this session and notifies "unbound (project law kept)". It does not delete the project.

There is no `role` field on the bind entry today. There is no attach tool. `ctx_bind` in `src/tools/register.ts` calls this same flow. Its description says "Never silent. Print mode refuses."
