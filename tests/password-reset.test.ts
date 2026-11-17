import { describe, expect, it } from "vitest";
import {
  RESET_TTL_MS,
  RESET_MAX_BY_IP,
  RESET_MAX_BY_IP_IDENT,
  buildResetUrl,
  evalResetLimit,
  generateResetToken,
  hashResetToken,
  normalizeEmail,
  resetExpiry,
  resetIdentifier,
  resetTokenState,
} from "@/lib/password-reset";

describe("reset tokens", () => {
  it("mints a long url-safe token", () => {
    const token = generateResetToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(encodeURIComponent(token)).toBe(token);
  });

  it("never repeats a token", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateResetToken()));
    expect(seen.size).toBe(50);
  });

  // The DB keeps only the hash: a dump of PasswordResetToken must not be
  // enough to take over an account.
  it("hashes deterministically and irreversibly", () => {
    const token = generateResetToken();
    expect(hashResetToken(token)).toBe(hashResetToken(token));
    expect(hashResetToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashResetToken(token)).not.toContain(token);
    expect(hashResetToken(token)).not.toBe(hashResetToken(generateResetToken()));
  });

  it("expires one hour out", () => {
    const now = new Date("2026-11-17T10:00:00.000Z");
    expect(resetExpiry(now).toISOString()).toBe("2026-11-17T11:00:00.000Z");
    expect(RESET_TTL_MS).toBe(60 * 60 * 1000);
  });
});

describe("resetTokenState", () => {
  const now = new Date("2026-11-17T10:00:00.000Z");
  const future = new Date("2026-11-17T10:30:00.000Z");
  const past = new Date("2026-11-17T09:30:00.000Z");

  it("is valid while unused and unexpired", () => {
    expect(resetTokenState({ expiresAt: future, usedAt: null }, now)).toBe("valid");
  });

  // Used beats expired: a link that already changed the password is the
  // stronger reason to refuse, and saying "expired" would invite a retry.
  it("reports used even past expiry", () => {
    expect(resetTokenState({ expiresAt: past, usedAt: past }, now)).toBe("used");
  });

  it("reports expired at the exact boundary", () => {
    expect(resetTokenState({ expiresAt: now, usedAt: null }, now)).toBe("expired");
  });
});

describe("evalResetLimit", () => {
  it("passes a first request", () => {
    expect(evalResetLimit({ requestsByIp: 0, requestsByIpAndIdentifier: 0 }).blocked).toBe(false);
  });
  it("blocks a flood from one address", () => {
    expect(evalResetLimit({ requestsByIp: RESET_MAX_BY_IP, requestsByIpAndIdentifier: 0 }).blocked).toBe(true);
  });
  it("blocks mail-bombing one inbox", () => {
    expect(
      evalResetLimit({ requestsByIp: 0, requestsByIpAndIdentifier: RESET_MAX_BY_IP_IDENT }).blocked,
    ).toBe(true);
  });
  it("keeps the per-inbox cap below the per-address cap", () => {
    expect(RESET_MAX_BY_IP_IDENT).toBeLessThan(RESET_MAX_BY_IP);
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Electro.City@ICloud.com ")).toBe("electro.city@icloud.com");
  });
  it("rejects what is not an address", () => {
    for (const bad of ["", "nope", "a@b", "a b@c.de", "a@b.c\nbcc: x@y.z"]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });
  it("accepts a plain address", () => {
    expect(normalizeEmail("user@example.org")).toBe("user@example.org");
  });
});

describe("resetIdentifier", () => {
  // The IP-scoped count matches on the prefix, so every reset row must carry
  // it — otherwise one request escapes the per-address cap.
  it("namespaces the email so login rows are never counted", () => {
    expect(resetIdentifier("user@example.org")).toBe("__reset__:user@example.org");
    expect(resetIdentifier("user@example.org").startsWith("__reset__")).toBe(true);
  });
});

describe("buildResetUrl", () => {
  it("builds a locale path and drops a trailing slash", () => {
    expect(buildResetUrl("https://trientes.org/", "ru", "abc")).toBe(
      "https://trientes.org/ru/reset-password/abc",
    );
  });
});
