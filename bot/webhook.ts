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
    void webhookCallback(bot, "express")(req, res);
  });
  return app;
}
