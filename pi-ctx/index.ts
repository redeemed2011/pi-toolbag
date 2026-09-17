import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCtxCommand } from "./src/commands/ctx.js";
import { registerCompactionHook } from "./src/hooks/compaction-hook.js";
import { registerCompactionTrigger } from "./src/hooks/compaction-trigger.js";
import { registerContextHook } from "./src/hooks/context-hook.js";
import { registerObserverTrigger } from "./src/hooks/observer-trigger.js";
import { registerSessionStart } from "./src/hooks/session-start.js";
import { Runtime } from "./src/runtime.js";
import { registerTools } from "./src/tools/register.js";

export default function ctx(pi: ExtensionAPI): void {
	const runtime = new Runtime();
	registerSessionStart(pi, runtime);
	registerObserverTrigger(pi, runtime);
	registerCompactionTrigger(pi, runtime);
	registerCompactionHook(pi, runtime);
	registerContextHook(pi, runtime);
	registerCtxCommand(pi, runtime);
	registerTools(pi, runtime);
}
