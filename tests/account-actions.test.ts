import { describe, expect, it } from "vitest";
import { validateProfileInput, normalizePhone } from "@/lib/profile";

describe("normalizePhone", () => {
  it("strips everything except + and digits", () => {
    expect(normalizePhone(" +1 (555) 123-4567 ")).toBe("+15551234567");
  });
  it("returns null for blank", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
  });
});

describe("validateProfileInput", () => {
  it("accepts a minimal valid input", () => {
    const r = validateProfileInput({ firstName: "Alice", lastName: "", phone: "", email: "" });
    expect(r.ok).toBe(true);
  });
  it("rejects an invalid email", () => {
    expect(validateProfileInput({ email: "not-an-email" }))
      .toMatchObject({ ok: false, reason: "email_invalid" });
  });
  it("rejects firstName > 80 chars", () => {
    expect(validateProfileInput({ firstName: "a".repeat(81) }))
      .toMatchObject({ ok: false, reason: "first_name_too_long" });
  });
});
