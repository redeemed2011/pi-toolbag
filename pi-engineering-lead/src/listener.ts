import type { Runner } from "./bridge.js";

export interface Incoming {
  id: string;
  kind: string;
  topic: string;
  text: string;
}

export interface Taken {
  listener: boolean;
  holder?: { session: string; cwd: string; heartbeat: number };
  messages: Incoming[];
  rejected: { file: string; reason: string }[];
}

export interface ListenerHooks {
  deliver(message: Incoming): void;
  warn(text: string): void;
}

/** Polls the bridge inbox for one session. Only the session holding the lease gets messages. */
export class Listener {
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;
  private lastError = "";

  constructor(
    private readonly run: Runner,
    private readonly session: string,
    private readonly cwd: string,
    private readonly hooks: ListenerHooks,
  ) {}

  async poll(): Promise<Taken | undefined> {
    if (this.busy) return undefined;
    this.busy = true;
    try {
      const result = await this.run(["take", "--session", this.session, "--cwd", this.cwd]);
      if (result.code !== 0) {
        this.report(`Engineering Lead inbox could not be read: ${result.stderr.trim() || `exit ${result.code}`}`);
        return undefined;
      }
      const taken = JSON.parse(result.stdout) as Taken;
      this.lastError = "";
      for (const message of taken.messages) this.hooks.deliver(message);
      for (const bad of taken.rejected) this.hooks.warn(`Engineering Lead message refused (${bad.file}): ${bad.reason}`);
      return taken;
    } catch (error) {
      this.report(`Engineering Lead inbox could not be read: ${(error as Error).message}`);
      return undefined;
    } finally {
      this.busy = false;
    }
  }

  /** Warn once per distinct failure, not on every poll. */
  private report(text: string): void {
    if (text === this.lastError) return;
    this.lastError = text;
    this.hooks.warn(text);
  }

  start(everyMs: number): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), everyMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.run(["release", "--session", this.session]);
  }
}
