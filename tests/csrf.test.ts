import { describe, expect, it } from "vitest";
import { csrfOk, csrfTokenFor } from "@/lib/csrf";
import { evalLinkCheckLimit, linkCheckIdentifier, LINK_CHECKS_PER_HOUR } from "@/lib/pay-link/limits";
import { freshLoginAt } from "@/lib/session-fresh";

describe("токен против подделки запроса", () => {
  it("выводится из сеанса и не зависит от вызова к вызову", () => {
    const a = csrfTokenFor("session-one");
    expect(a).toBeTruthy();
    expect(csrfTokenFor("session-one")).toBe(a);
  });

  it("у другого сеанса другой токен", () => {
    expect(csrfTokenFor("session-one")).not.toBe(csrfTokenFor("session-two"));
  });

  it("сверка принимает свой и отвергает чужой", () => {
    const token = csrfTokenFor("session-one")!;
    expect(csrfOk("session-one", token)).toBe(true);
    expect(csrfOk("session-two", token)).toBe(false);
    expect(csrfOk("session-one", "")).toBe(false);
    expect(csrfOk("session-one", null)).toBe(false);
    expect(csrfOk("session-one", `${token}x`)).toBe(false);
  });

  it("без сеанса токена нет и проверка не проходит", () => {
    expect(csrfTokenFor(null)).toBeNull();
    expect(csrfOk(null, "whatever")).toBe(false);
  });

  it("нет секрета — отказываем, а не пропускаем", () => {
    const keep = { csrf: process.env.CSRF_SECRET, auth: process.env.NEXTAUTH_SECRET, next: process.env.AUTH_SECRET };
    delete process.env.CSRF_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.AUTH_SECRET;
    try {
      expect(csrfTokenFor("session-one")).toBeNull();
      expect(csrfOk("session-one", "anything")).toBe(false);
    } finally {
      if (keep.csrf) process.env.CSRF_SECRET = keep.csrf;
      if (keep.auth) process.env.NEXTAUTH_SECRET = keep.auth;
      if (keep.next) process.env.AUTH_SECRET = keep.next;
    }
  });
});

describe("потолок проверок ссылки", () => {
  it("десять в час на адрес и на пользователя", () => {
    expect(evalLinkCheckLimit({ byIp: LINK_CHECKS_PER_HOUR - 1, byUser: 0 }).blocked).toBe(false);
    expect(evalLinkCheckLimit({ byIp: LINK_CHECKS_PER_HOUR, byUser: 0 }).blocked).toBe(true);
    expect(evalLinkCheckLimit({ byIp: 0, byUser: LINK_CHECKS_PER_HOUR }).blocked).toBe(true);
  });

  it("строка счётчика несёт приставку — по ней считается расход адреса", () => {
    expect(linkCheckIdentifier("u1").startsWith("__paylink__")).toBe(true);
  });
});

describe("свежесть входа", () => {
  const t = (iso: string) => new Date(iso);

  it("берётся самое позднее доказательство личности", () => {
    expect(
      freshLoginAt({
        createdAt: t("2026-11-27T10:00:00Z"),
        reauthAt: t("2026-11-27T11:30:00Z"),
        mfaAt: t("2026-11-27T10:30:00Z"),
      }),
    ).toEqual(t("2026-11-27T11:30:00Z"));
  });

  it("показ второго фактора тоже считается", () => {
    expect(
      freshLoginAt({ createdAt: t("2026-11-01T10:00:00Z"), reauthAt: null, mfaAt: t("2026-11-27T11:00:00Z") }),
    ).toEqual(t("2026-11-27T11:00:00Z"));
  });

  it("нет сеанса — нет подтверждения", () => {
    expect(freshLoginAt(null)).toBeNull();
  });
});
