import type { Bot } from "grammy";

const MIN_INTERVAL_MS = 1000;

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}

export class StatusUpdater {
  private lastSent = "";
  private lastSentAt = 0;
  private pending: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly bot: Bot,
    private readonly chatId: number,
    private readonly messageId: number,
  ) {}

  update(text: string): void {
    if (text === this.lastSent || text === this.pending) {
      this.pending = null;
      return;
    }
    const now = Date.now();
    const elapsed = now - this.lastSentAt;
    if (elapsed >= MIN_INTERVAL_MS) {
      this.send(text);
    } else {
      this.pending = text;
      if (!this.timer) {
        this.timer = setTimeout(
          () => this.fireTrailing(),
          MIN_INTERVAL_MS - elapsed,
        );
      }
    }
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending !== null && this.pending !== this.lastSent) {
      await this.sendAsync(this.pending);
      this.pending = null;
    }
  }

  private fireTrailing(): void {
    this.timer = null;
    if (this.pending !== null && this.pending !== this.lastSent) {
      this.send(this.pending);
      this.pending = null;
    }
  }

  private send(text: string): void {
    void this.sendAsync(text);
  }

  private async sendAsync(text: string): Promise<void> {
    this.lastSent = text;
    this.lastSentAt = Date.now();
    try {
      await this.bot.api.editMessageText(this.chatId, this.messageId, text);
    } catch {
      // swallow — Telegram throws on identical content or transient errors; not fatal
    }
  }
}
