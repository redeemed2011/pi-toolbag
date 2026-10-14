# Evidence — extra tool keys reach execute, run by agent2 2026-10-09

Read-only test. It does not run Pi. It calls Pi's own validator with a TypeBox object shaped like a subset of `ctx_record`.

Source of the validator: `@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/utils/validation.js`, `validateToolArguments` (line ~280). It runs `Value.Convert` and `validator.Check`, then returns `args`. `Type.Object` without `additionalProperties: false` accepts extra keys. The agent loop calls it after `prepareArguments` (`node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js` lines 469-492).

`ctx_record` declares no `additionalProperties` (`pi-ctx/src/tools/register.ts` lines 206-248). Its `prepareArguments` calls `dropKeys(args, [])`, which drops nothing (`pi-ctx/src/tools/result.ts` lines 24-29).

Script, run from `/home/bo/src/pi-toolbag/pi-ctx` so its `node_modules` resolve. That imports pi-ai from `pi-ctx/node_modules`, not the copy nested under the installed Pi. Re-run against the installed copy if the versions differ:

```js
import { Type } from "typebox";
import { validateToolArguments } from "@earendil-works/pi-ai";
const tool = { name: "t", parameters: Type.Object({ type: Type.String(), headline: Type.String(), parent: Type.Optional(Type.String()) }) };
const out = validateToolArguments(tool, { name: "t", arguments: { type: "finding", headline: "h", supersedes: "x", body: "b" } });
console.log(JSON.stringify(out));
```

Output:

```
{"type":"finding","headline":"h","supersedes":"x","body":"b"}
```

So an undeclared key such as `supersedes` or `body` passes validation and reaches `execute`. An allowlist must be checked inside `execute` (or `prepareArguments`) against the raw keys. The schema alone does not reject them.
