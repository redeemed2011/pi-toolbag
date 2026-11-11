import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { extraWorkerExtensionPaths, modelArg, resolvePiBinary, withoutNullBytes } from "../../pi-ctx/src/spawn/observer.js";

/** A destination packet at xhigh finished in 255s. The five-minute kill cut off the larger project packet before any verdict. */
const JUDGE_MS = 900_000;
const JUDGE_FALLBACK_PATH = fileURLToPath(new URL("./judge-fallback.ts", import.meta.url));

export type JudgeModel = { provider: string; id: string; thinking?: ModelThinkingLevel };

const THINKING: readonly ModelThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export function thinkingLevel(value: string): ModelThinkingLevel | null {
  for (const level of THINKING) {
    if (level === value) return level;
  }
  return null;
}

const JUDGE_ASK = "The completion packet is above. Reply with the outcome lines and gap lines it requests. Do not edit files or run tests.";
export const IMPASSE_ASK = "The impasse packet is above. Answer with the one line it requests.";

export function judgeArgv(model: JudgeModel, ask = JUDGE_ASK, tools = true): string[] {
  const pi = resolvePiBinary();
  const args = [
    ...pi.baseArgs,
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
  ];
  if (tools) args.push("--tools", "read,grep,find", "--exclude-tools", "mcp__*");
  else args.push("--no-tools");
  args.push("--model", modelArg(model));
  if (model.thinking) args.push("--thinking", model.thinking);
  args.push("-e", JUDGE_FALLBACK_PATH);
  for (const extra of extraWorkerExtensionPaths(model, { chain: false })) args.push("-e", extra);
  args.push("-p", ask);
  return [pi.command, ...args];
}

export function runJudge(
  model: JudgeModel,
  prompt: string,
  cwd: string,
  ask = JUDGE_ASK,
  tools = true,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const argv = judgeArgv(model, ask, tools).map(withoutNullBytes);
  const [command, ...rest] = argv;
  if (!command) return Promise.resolve({ ok: false, error: "no pi binary" });
  return new Promise((resolvePromise) => {
    const proc = spawn(command, rest, { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    proc.stdin?.on("error", () => {});
    proc.stdin?.end(withoutNullBytes(prompt));
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
