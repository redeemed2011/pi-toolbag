import { spawnSync } from "node:child_process";
import { existsSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const kernelDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fallback-kernel");
const kernelPath = path.join(kernelDir, "kernel");
let ensured = false;

export function ensureKernelBin(): string {
  if (ensured && existsSync(kernelPath)) return kernelPath;
  if (!existsSync(kernelPath)) {
    const tmp = `${kernelPath}.${process.pid}.tmp`;
    const go = spawnSync("go", ["build", "-trimpath", "-o", tmp, "."], {
      cwd: kernelDir,
      encoding: "utf8",
      env: { ...process.env, GOTOOLCHAIN: "local", CGO_ENABLED: "0" },
    });
    if (go.error || go.status !== 0 || !existsSync(tmp)) {
      rmSync(tmp, { force: true });
      const detail = go.error ? go.error.message : (go.stderr || `go build exited ${go.status ?? go.signal}`);
      throw new Error(`pi-fallback-lib could not build fallback-kernel: ${detail}`);
    }
    renameSync(tmp, kernelPath);
  }
  ensured = true;
  return kernelPath;
}

export function runKernel(command: string, payload: unknown): string {
  const bin = ensureKernelBin();
  const child = spawnSync(bin, [command], {
    input: JSON.stringify(payload === undefined ? null : payload),
    encoding: "utf8",
  });
  if (child.status !== 0) throw new Error(child.stderr || "fallback-kernel failed");
  return child.stdout.trim();
}
