export const DEFAULT_IDLE_MS = 180_000;

/** Flag wins over env. `0`, `off`, and `false` disable. Invalid values use the default. */
export function parseIdleTimeoutMs(flag: boolean | string | undefined, env: string | undefined): number {
  const raw = flag !== undefined && String(flag).trim() !== "" ? String(flag) : env;
  if (raw === undefined) return DEFAULT_IDLE_MS;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "") return DEFAULT_IDLE_MS;
  if (trimmed === "0" || trimmed === "off" || trimmed === "false") return 0;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_IDLE_MS;
  return Math.floor(parsed);
}
