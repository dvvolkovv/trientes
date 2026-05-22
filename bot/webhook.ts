import express, { type Express } from "express";
import type { Bot } from "grammy";
import type Redis from "ioredis";
import { webhookCallback } from "grammy";

type Check = { ok: boolean; latencyMs?: number; error?: string };

export function createWebhookApp(bot: Bot, secret: string, redis?: Redis): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", async (_req, res) => {
    const checks: Record<string, Check> = {};

    if (redis) {
      const t = Date.now();
      try {
        const pong = await redis.ping();
        checks.redis = { ok: pong === "PONG", latencyMs: Date.now() - t };
      } catch (e) {
        checks.redis = { ok: false, error: String(e).slice(0, 200) };
      }
    }

    const t = Date.now();
    try {
      const me = await bot.api.getMe();
      checks.telegram = { ok: !!me?.id, latencyMs: Date.now() - t };
    } catch (e) {
      checks.telegram = { ok: false, error: String(e).slice(0, 200) };
    }

    const allOk = Object.values(checks).every((c) => c.ok);
    res.status(allOk ? 200 : 503).json({
      ok: allOk,
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  app.post(`/bot/${secret}`, (req, res) => {
    const headerSecret = req.header("x-telegram-bot-api-secret-token");
    if (headerSecret !== secret) {
      res.status(401).json({ error: "bad secret token" });
      return;
    }
    // Ack Telegram within 1s no matter how long the actual handler takes —
    // Claude runs can take minutes; without this Telegram retries the update.
    void webhookCallback(bot, "express", {
      onTimeout: "return",
      timeoutMilliseconds: 1000,
    })(req, res);
  });
  return app;
}
