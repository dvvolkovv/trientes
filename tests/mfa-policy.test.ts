import { describe, expect, it } from "vitest";
import { enrollmentAllowedFor, mfaGate, mfaRequiredForRole } from "@/lib/mfa/policy";

const now = new Date("2026-11-18T19:00:00Z");

describe("mfaRequiredForRole", () => {
  it("сотрудника и владельца фактор касается", () => {
    expect(mfaRequiredForRole("STAFF")).toBe(true);
    expect(mfaRequiredForRole("OWNER")).toBe(true);
    // ADMIN — наследие, политика читает его как владельца
    expect(mfaRequiredForRole("ADMIN")).toBe(true);
  });

  it("посетителя — нет: его привилегий это не касается", () => {
    expect(mfaRequiredForRole("USER")).toBe(false);
  });
});

describe("mfaGate", () => {
  it("посетитель проходит без фактора", () => {
    expect(mfaGate({ role: "USER", mfa: null, sessionMfaAt: null })).toBe("ok");
  });

  it("сотрудник без фактора — на страницу заведения", () => {
    expect(mfaGate({ role: "STAFF", mfa: null, sessionMfaAt: null })).toBe("setup");
  });

  it("начатое, но не подтверждённое заведение фактором не считается", () => {
    expect(
      mfaGate({ role: "STAFF", mfa: { confirmedAt: null, disabledAt: null }, sessionMfaAt: null }),
    ).toBe("setup");
  });

  it("снятый владельцем фактор — снова заведение", () => {
    expect(
      mfaGate({ role: "STAFF", mfa: { confirmedAt: now, disabledAt: now }, sessionMfaAt: now }),
    ).toBe("setup");
  });

  it("фактор заведён, но в этом сеансе не показан — спросить код", () => {
    expect(
      mfaGate({ role: "STAFF", mfa: { confirmedAt: now, disabledAt: null }, sessionMfaAt: null }),
    ).toBe("verify");
  });

  it("показан в этом сеансе — пропустить", () => {
    expect(
      mfaGate({ role: "STAFF", mfa: { confirmedAt: now, disabledAt: null }, sessionMfaAt: now }),
    ).toBe("ok");
  });
});

describe("enrollmentAllowedFor", () => {
  it("фактора нет — заводить можно", () => {
    expect(enrollmentAllowedFor("setup")).toBe(true);
  });

  it("фактор есть и код в этом сеансе показан — можно перевести на другой телефон", () => {
    expect(enrollmentAllowedFor("ok")).toBe(true);
  });

  it("фактор есть, а код не показан — нельзя: иначе украденный пароль перезаводил бы фактор на свой телефон", () => {
    expect(enrollmentAllowedFor("verify")).toBe(false);
  });
});
