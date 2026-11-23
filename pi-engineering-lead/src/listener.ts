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
  /** All messages taken in one poll, delivered together so none waits in the session's memory. */
  deliver(messages: Incoming[]): void;
  warn(text: string): void;
  /** True when the session is idle with nothing queued. While false the listener only keeps its lease. */
  ready(): boolean;
}

/**
 * Polls the bridge inbox for one session. Only the session holding the lease gets messages.
 * While the session is busy it holds the lease and takes nothing: a message stays in the inbox
 * until the work is done, so an abort, a quit, or a crash mid-turn cannot lose it.
 */
export class Listener {
  private timer: ReturnType<typeof setInterval> | undefined;
  private chain: Promise<unknown> = Promise.resolve();
  private lastError = "";

  constructor(
    private readonly run: Runner,
    private readonly session: string,
    private readonly cwd: string,
    private readonly hooks: ListenerHooks,
  ) {}

  /** One timer step: take and deliver when ready, otherwise only keep the lease. */
  poll(): Promise<Taken | undefined> {
    return this.serial(async () => {
      const ready = this.hooks.ready();
      const taken = await this.call(!ready);
      if (taken && taken.messages.length > 0) this.hooks.deliver(taken.messages);
      return taken;
    });
  }

  /** Take now for a caller that delivers them itself, such as the end of a finished turn. */
  take(): Promise<Incoming[]> {
    return this.serial(async () => (await this.call(false))?.messages ?? []);
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async call(hold: boolean): Promise<Taken | undefined> {
    try {
      const result = await this.run(["take", "--session", this.session, "--cwd", this.cwd, ...(hold ? ["--hold"] : [])]);
      if (result.code !== 0) {
        this.report(`Engineering Lead inbox could not be read: ${result.stderr.trim() || `exit ${result.code}`}`);
        return undefined;
      }
      const taken = JSON.parse(result.stdout) as Taken;
      this.lastError = "";
      for (const bad of taken.rejected) this.hooks.warn(`Engineering Lead message refused (${bad.file}): ${bad.reason}`);
      return taken;
    } catch (error) {
      this.report(`Engineering Lead inbox could not be read: ${(error as Error).message}`);
      return undefined;
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
    await this.chain;
    await this.run(["release", "--session", this.session]);
  }
}
