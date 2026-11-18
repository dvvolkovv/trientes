import { describe, expect, it } from "vitest";
import { MFA_MAX_FAILS, evalMfaLimit, mfaIdentifier } from "@/lib/rate-limit";

describe("ограничитель второго фактора", () => {
  it("десятая неудача запирает, девятая — нет", () => {
    expect(evalMfaLimit({ failures: MFA_MAX_FAILS - 1 }).blocked).toBe(false);
    expect(evalMfaLimit({ failures: MFA_MAX_FAILS }).blocked).toBe(true);
  });

  it("строка ограничителя — про человека, а не про адрес", () => {
    expect(mfaIdentifier("u1")).toBe("__mfa__:u1");
    expect(mfaIdentifier("u1")).not.toBe(mfaIdentifier("u2"));
  });
});
