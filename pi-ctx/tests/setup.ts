import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Never read the operator's ~/.pi/agent/settings.json from unit tests. */
if (!process.env.PI_CODING_AGENT_DIR) {
	process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "ctx-test-agent-"));
}
