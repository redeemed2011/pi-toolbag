import { runStall } from "./stallBin.js";

export const DEFAULT_IDLE_MS = 180_000;

/** Flag wins over env. `0`, `off`, and `false` disable. Invalid values use the default. */
export function parseIdleTimeoutMs(flag: boolean | string | undefined, env: string | undefined): number {
  return Number(runStall([], { flag: flag === undefined ? null : flag, env: env === undefined ? null : env }));
}
