import { describe, expect, it } from "vitest";
import {
  validateUsername,
  normalizeUsername,
  generateUsernameFromName,
  RESERVED_USERNAMES,
} from "@/lib/username";

describe("normalizeUsername", () => {
  it("lowercases and trims", () => {
    expect(normalizeUsername("  Foo_Bar  ")).toBe("foo_bar");
  });
});

describe("validateUsername", () => {
  it("accepts a valid 3-32 char username", () => {
    expect(validateUsername("alice_99")).toEqual({ ok: true, value: "alice_99" });
  });
  it("rejects too short", () => {
    expect(validateUsername("ab")).toMatchObject({ ok: false, reason: "username_too_short" });
  });
  it("rejects too long", () => {
    expect(validateUsername("a".repeat(33))).toMatchObject({ ok: false, reason: "username_too_long" });
  });
  it("rejects invalid chars", () => {
    expect(validateUsername("alice.bob")).toMatchObject({ ok: false, reason: "username_invalid_chars" });
    expect(validateUsername("alice bob")).toMatchObject({ ok: false, reason: "username_invalid_chars" });
    expect(validateUsername("Алиса")).toMatchObject({ ok: false, reason: "username_invalid_chars" });
  });
  it("rejects reserved names", () => {
    for (const name of RESERVED_USERNAMES) {
      expect(validateUsername(name)).toMatchObject({ ok: false, reason: "username_reserved" });
    }
  });
});

describe("generateUsernameFromName", () => {
  it("strips non-allowed chars and lowercases", () => {
    expect(generateUsernameFromName("Alice Smith")).toBe("alicesmith");
    expect(generateUsernameFromName("Дмитрий")).toBe("user");
  });
  it("truncates to 24 chars to leave room for suffixes", () => {
    expect(generateUsernameFromName("a".repeat(50))).toBe("a".repeat(24));
  });
  it("falls back to 'user' for empty", () => {
    expect(generateUsernameFromName("")).toBe("user");
    expect(generateUsernameFromName(null)).toBe("user");
  });
});
