import { describe, expect, it } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { verifyTelegramAuth } from "@/lib/telegram-auth";

function makeSignedPayload(botToken: string, fields: Record<string, string>) {
  const secret = createHash("sha256").update(botToken).digest();
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  return { ...fields, hash };
}

describe("verifyTelegramAuth", () => {
  const botToken = "1234567:test-bot-token";

  it("accepts a valid signed payload", () => {
    const payload = makeSignedPayload(botToken, {
      id: "42",
      first_name: "Alice",
      username: "alice",
      auth_date: String(Math.floor(Date.now() / 1000)),
    });
    expect(verifyTelegramAuth(payload, botToken)).toEqual({
      ok: true,
      telegramId: "42",
      firstName: "Alice",
      lastName: undefined,
      username: "alice",
      photoUrl: undefined,
    });
  });

  it("rejects a tampered payload", () => {
    const payload = makeSignedPayload(botToken, {
      id: "42",
      auth_date: String(Math.floor(Date.now() / 1000)),
    });
    payload.id = "999";
    expect(verifyTelegramAuth(payload, botToken)).toEqual({
      ok: false,
      reason: "bad_hash",
    });
  });

  it("rejects a stale auth_date (older than 1 day)", () => {
    const payload = makeSignedPayload(botToken, {
      id: "42",
      auth_date: String(Math.floor(Date.now() / 1000) - 86401),
    });
    expect(verifyTelegramAuth(payload, botToken)).toEqual({
      ok: false,
      reason: "stale",
    });
  });

  it("rejects missing hash", () => {
    expect(verifyTelegramAuth({ id: "42" }, botToken)).toEqual({
      ok: false,
      reason: "missing_hash",
    });
  });
});
