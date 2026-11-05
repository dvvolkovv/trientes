import { describe, expect, it } from "vitest";
import {
  INVITE_TTL_DAYS,
  buildInviteUrl,
  generateInviteToken,
  inviteExpiry,
  inviteState,
  isInviteUsable,
} from "@/lib/company-invites";

const now = new Date("2026-11-05T12:00:00Z");
const future = new Date("2026-11-19T12:00:00Z");
const past = new Date("2026-11-01T12:00:00Z");

describe("generateInviteToken", () => {
  it("produces URL-safe tokens of stable length", () => {
    const t = generateInviteToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
  it("does not repeat", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateInviteToken()));
    expect(tokens.size).toBe(50);
  });
});

describe("inviteExpiry", () => {
  it("is INVITE_TTL_DAYS after the given moment", () => {
    expect(inviteExpiry(now).toISOString()).toBe(
      new Date(now.getTime() + INVITE_TTL_DAYS * 86400_000).toISOString(),
    );
  });
});

describe("inviteState", () => {
  it("is valid while unused and unexpired", () => {
    expect(inviteState({ expiresAt: future }, now)).toBe("valid");
    expect(isInviteUsable({ expiresAt: future }, now)).toBe(true);
  });
  it("is expired once the deadline passes", () => {
    expect(inviteState({ expiresAt: past }, now)).toBe("expired");
    expect(isInviteUsable({ expiresAt: past }, now)).toBe(false);
  });
  it("treats the exact expiry moment as expired", () => {
    expect(inviteState({ expiresAt: now }, now)).toBe("expired");
  });
  it("is accepted once used, even if still inside the window", () => {
    expect(inviteState({ expiresAt: future, acceptedAt: now }, now)).toBe("accepted");
  });
  it("reports revoked ahead of accepted and expired", () => {
    expect(inviteState({ expiresAt: past, acceptedAt: now, revokedAt: now }, now)).toBe("revoked");
  });
  it("ignores null lifecycle fields", () => {
    expect(inviteState({ expiresAt: future, acceptedAt: null, revokedAt: null }, now)).toBe("valid");
  });
});

describe("buildInviteUrl", () => {
  it("joins origin, locale and token", () => {
    expect(buildInviteUrl("https://trientes.org", "ru", "abc")).toBe("https://trientes.org/ru/invite/abc");
  });
  it("tolerates a trailing slash on the origin", () => {
    expect(buildInviteUrl("https://trientes.org/", "en", "abc")).toBe("https://trientes.org/en/invite/abc");
  });
});
