import type Redis from "ioredis";
import type { SessionRecord } from "./types";

export const SESSION_TTL_SECONDS = 30 * 60;
const SESSION_KEY = (userId: number) => `claude:session:${userId}`;
const VERBOSE_KEY = (userId: number) => `bot:verbose:${userId}`;

export class SessionStore {
  constructor(private readonly redis: Redis) {}

  async get(userId: number): Promise<SessionRecord | null> {
    const raw = await this.redis.get(SESSION_KEY(userId));
    if (!raw) return null;
    return JSON.parse(raw) as SessionRecord;
  }

  async set(userId: number, claudeSessionId: string): Promise<void> {
    const now = Date.now();
    const record: SessionRecord = {
      claudeSessionId,
      startedAt: now,
      lastActivity: now,
    };
    await this.redis.set(
      SESSION_KEY(userId),
      JSON.stringify(record),
      "EX",
      SESSION_TTL_SECONDS,
    );
  }

  async reset(userId: number): Promise<void> {
    await this.redis.del(SESSION_KEY(userId));
  }

  async touch(userId: number): Promise<void> {
    const existing = await this.get(userId);
    if (!existing) return;
    existing.lastActivity = Date.now();
    await this.redis.set(
      SESSION_KEY(userId),
      JSON.stringify(existing),
      "EX",
      SESSION_TTL_SECONDS,
    );
  }

  async getVerbose(userId: number): Promise<boolean> {
    const v = await this.redis.get(VERBOSE_KEY(userId));
    return v === "1";
  }

  async setVerbose(userId: number, on: boolean): Promise<void> {
    if (on) {
      await this.redis.set(VERBOSE_KEY(userId), "1");
    } else {
      await this.redis.del(VERBOSE_KEY(userId));
    }
  }
}
