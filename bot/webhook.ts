import express, { type Express } from "express";
import type { Bot } from "grammy";
import { webhookCallback } from "grammy";

export function createWebhookApp(bot: Bot, secret: string): Express {
  const app = express();
  app.use(express.json());
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
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
