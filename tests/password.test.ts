import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, DUMMY_HASH } from "@/lib/password";

describe("hashPassword / verifyPassword", () => {
  it("verifies a correct password", async () => {
    const h = await hashPassword("correct horse battery staple");
    expect(h).toMatch(/^\$2[aby]\$/);
    expect(await verifyPassword("correct horse battery staple", h)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const h = await hashPassword("hunter2");
    expect(await verifyPassword("hunter3", h)).toBe(false);
  });

  it("returns false (not throw) for null/empty hash", async () => {
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
  });

  it("DUMMY_HASH is a valid bcrypt hash that always returns false", async () => {
    expect(DUMMY_HASH).toMatch(/^\$2[aby]\$/);
    expect(await verifyPassword("anything", DUMMY_HASH)).toBe(false);
  });
});
