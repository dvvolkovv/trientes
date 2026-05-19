import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type TelegramAuthPayload = Record<string, string | undefined>;

export type TelegramAuthResult =
  | {
      ok: true;
      telegramId: string;
      firstName?: string;
      lastName?: string;
      username?: string;
      photoUrl?: string;
    }
  | { ok: false; reason: "missing_hash" | "bad_hash" | "stale" };

const MAX_AGE_SEC = 86400;

export function verifyTelegramAuth(
  payload: TelegramAuthPayload,
  botToken: string,
): TelegramAuthResult {
  const { hash, ...rest } = payload;
  if (!hash) return { ok: false, reason: "missing_hash" };

  const dataCheckString = Object.keys(rest)
    .filter((k) => rest[k] !== undefined && rest[k] !== "")
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("\n");

  const secret = createHash("sha256").update(botToken).digest();
  const expected = createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_hash" };
  }

  const authDate = Number(rest.auth_date ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SEC) {
    return { ok: false, reason: "stale" };
  }

  return {
    ok: true,
    telegramId: String(rest.id),
    firstName: rest.first_name,
    lastName: rest.last_name,
    username: rest.username,
    photoUrl: rest.photo_url,
  };
}
