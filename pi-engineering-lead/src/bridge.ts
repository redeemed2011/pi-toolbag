import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface BridgeResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Runner = (args: string[], stdin?: string) => Promise<BridgeResult>;

export function bridgeBinary(env: NodeJS.ProcessEnv = process.env, home = homedir()): string | undefined {
  const named = env.DEV_AGENT_BRIDGE_BIN;
  if (named) return existsSync(named) ? named : undefined;
  const installed = join(home, ".cargo", "bin", "dev-agent-bridge");
  return existsSync(installed) ? installed : undefined;
}

export function runner(binary: string, env: NodeJS.ProcessEnv = process.env): Runner {
  return (args, stdin) =>
    new Promise((resolve) => {
      const child = spawn(binary, args, { env, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", (error) => resolve({ code: 127, stdout, stderr: String(error.message) }));
      child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
      child.stdin.on("error", () => {});
      child.stdin.end(stdin ?? "");
    });
}

export const EXIT_MEANING: Record<number, string> = {
  2: "The message was refused as invalid. Fix it and send again.",
  3: "The bridge secrets file is missing or invalid on this machine. Nothing was sent. Tell Sam.",
  4: "The hourly cap of 20 messages was reached. Nothing was sent. Wait; do not retry now.",
  5: "That message or reply was already sent. Do not send it again.",
  6: "The webhook did not accept the message. Nothing is known to have arrived. Retry once with the same --id only if it matters.",
  7: "The bridge has no writable state folder on this machine. Nothing was sent.",
};

export interface SendParams {
  kind: "ask" | "reply" | "note";
  topic: string;
  body: string;
  reply_to?: string;
  ctx?: string[];
  commit?: string;
  file?: string;
}

export function sendArgs(params: SendParams): string[] {
  const args = ["send", "--kind", params.kind, "--topic", params.topic, "--body-file", "-"];
  if (params.reply_to?.trim()) args.push("--reply-to", params.reply_to.trim());
  for (const id of params.ctx ?? []) if (id.trim()) args.push("--ctx", id.trim());
  if (params.commit?.trim()) args.push("--commit", params.commit.trim());
  if (params.file?.trim()) args.push("--file", params.file.trim());
  return args;
}

export async function send(run: Runner, params: SendParams): Promise<string> {
  const result = await run(sendArgs(params), params.body);
  if (result.code === 0) return result.stdout.trim();
  const meaning = EXIT_MEANING[result.code] ?? "The bridge failed. Nothing is known to have been sent.";
  throw new Error(`${result.stderr.trim()}\n${meaning}`.trim());
}
