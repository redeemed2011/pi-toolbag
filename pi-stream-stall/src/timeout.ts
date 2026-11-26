import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_IDLE_MS = 180_000;

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../stall-timeout/stall-timeout");

/** Flag wins over env. `0`, `off`, and `false` disable. Invalid values use the default. */
export function parseIdleTimeoutMs(flag: boolean | string | undefined, env: string | undefined): number {
  const child = spawnSync(bin, [], {
    input: JSON.stringify({ flag: flag === undefined ? null : flag, env: env === undefined ? null : env }),
    encoding: "utf8",
  });
  if (child.status !== 0) throw new Error(child.stderr || "stall-timeout failed");
  return Number(child.stdout.trim());
}
