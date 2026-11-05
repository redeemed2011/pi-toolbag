import { spawn } from "node:child_process";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { extraWorkerExtensionPaths, modelArg, resolvePiBinary, withoutNullBytes } from "../../pi-ctx/src/spawn/observer.js";

const JUDGE_MS = 120_000;

export type JudgeModel = { provider: string; id: string; thinking?: ModelThinkingLevel };

const THINKING: readonly ModelThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export function thinkingLevel(value: string): ModelThinkingLevel | null {
  for (const level of THINKING) {
    if (level === value) return level;
  }
  return null;
}

export function judgeArgv(model: JudgeModel, prompt: string): string[] {
  const pi = resolvePiBinary();
  const args = [
    ...pi.baseArgs,
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--no-tools",
    "--model",
    modelArg(model),
  ];
  if (model.thinking) args.push("--thinking", model.thinking);
  for (const extra of extraWorkerExtensionPaths(model)) args.push("-e", extra);
  args.push("-p", withoutNullBytes(prompt));
  return [pi.command, ...args];
}

export function runJudge(model: JudgeModel, prompt: string, cwd: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const argv = judgeArgv(model, prompt).map(withoutNullBytes);
  const [command, ...rest] = argv;
  if (!command) return Promise.resolve({ ok: false, error: "no pi binary" });
  return new Promise((resolvePromise) => {
    const proc = spawn(command, rest, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const finish = (result: { ok: true; text: string } | { ok: false; error: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(kill);
      resolvePromise(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, JUDGE_MS);
    const kill = setTimeout(() => {
      proc.kill("SIGKILL");
    }, JUDGE_MS + 5_000);
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", () => {
      finish({ ok: false, error: "spawn failed" });
    });
    proc.on("close", (code, signal) => {
      if (timedOut || signal || code !== 0) {
        const detail = stderr.trim().slice(0, 200);
        finish({ ok: false, error: detail || (timedOut ? "timed out" : `exit ${code ?? signal ?? "none"}`) });
        return;
      }
      if (!stdout.trim()) {
        finish({ ok: false, error: "no output" });
        return;
      }
      finish({ ok: true, text: stdout });
    });
  });
}
