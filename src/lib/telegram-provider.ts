import Credentials from "next-auth/providers/credentials";
import { verifyTelegramAuth } from "@/lib/telegram-auth";

export function TelegramProvider() {
  return Credentials({
    id: "telegram",
    name: "Telegram",
    credentials: {
      id: { type: "text" },
      first_name: { type: "text" },
      last_name: { type: "text" },
      username: { type: "text" },
      photo_url: { type: "text" },
      auth_date: { type: "text" },
      hash: { type: "text" },
    },
    async authorize(raw) {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token) return null;
      const payload = Object.fromEntries(
        Object.entries(raw ?? {}).filter(([, v]) => v !== undefined),
      ) as Record<string, string>;
      const result = verifyTelegramAuth(payload, token);
      if (!result.ok) return null;
      return {
        id: `telegram:${result.telegramId}`,
        name:
          [result.firstName, result.lastName].filter(Boolean).join(" ") ||
          result.username ||
          `Telegram ${result.telegramId}`,
        image: result.photoUrl ?? null,
        telegramId: result.telegramId,
      } as unknown as import("next-auth").User;
    },
  });
}
