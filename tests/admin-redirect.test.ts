import { describe, expect, it } from "vitest";
import { adminRedirectFor } from "@/lib/authz/map";
import type { DenyReason } from "@/lib/authz/guard";

const REASONS: DenyReason[] = ["unauth", "no_access", "mfa_setup", "mfa_verify"];

describe("adminRedirectFor", () => {
  it("у каждого повода отказа свой адрес, и ни один не ведёт в саму админку", () => {
    const seen = new Set<string>();
    for (const reason of REASONS) {
      const to = adminRedirectFor(reason, "ru");
      expect(to.startsWith("/ru/"), reason).toBe(true);
      // Иначе калитка отправляла бы человека туда, откуда она его только что выгнала.
      expect(to === "/ru/admin", reason).toBe(false);
      seen.add(to);
    }
    expect(seen.size).toBe(REASONS.length);
  });

  it("не вошедшего возвращают обратно в админку после входа", () => {
    expect(adminRedirectFor("unauth", "en")).toBe("/en/login?next=/en/admin");
  });

  it("без фактора — заводить, с заведённым — вводить код", () => {
    expect(adminRedirectFor("mfa_setup", "sk")).toBe("/sk/mfa/setup");
    expect(adminRedirectFor("mfa_verify", "sk")).toBe("/sk/mfa");
  });

  it("сотрудник без прав идёт в кабинет, а не на вход: оттуда его вернуло бы обратно", () => {
    expect(adminRedirectFor("no_access", "de")).toBe("/de/cabinet");
  });
});
