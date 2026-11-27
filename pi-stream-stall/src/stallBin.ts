import { spawnSync } from "node:child_process";
import { existsSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const stallDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../stall-timeout");
const stallPath = path.join(stallDir, "stall-timeout");
let ensured = false;

export function ensureStallBin(): string {
  if (ensured && existsSync(stallPath)) return stallPath;
  if (!existsSync(stallPath)) {
    const tmp = `${stallPath}.${process.pid}.tmp`;
    const go = spawnSync("go", ["build", "-trimpath", "-o", tmp, "."], {
      cwd: stallDir,
      encoding: "utf8",
      env: { ...process.env, GOTOOLCHAIN: "local", CGO_ENABLED: "0" },
    });
    if (go.error || go.status !== 0 || !existsSync(tmp)) {
      rmSync(tmp, { force: true });
      const detail = go.error ? go.error.message : (go.stderr || `go build exited ${go.status ?? go.signal}`);
      throw new Error(`pi-stream-stall could not build stall-timeout: ${detail}`);
    }
    renameSync(tmp, stallPath);
  }
  ensured = true;
  return stallPath;
}

export function runStall(args: string[], payload: unknown): string {
  const bin = ensureStallBin();
  const child = spawnSync(bin, args, {
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
  if (child.status !== 0) throw new Error(child.stderr || "stall-timeout failed");
  return child.stdout.trim();
}
