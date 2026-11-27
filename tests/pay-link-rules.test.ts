import { describe, expect, it } from "vitest";
import {
  CHANGE_DELAY_MS,
  codeRequired,
  contactFreezeUntil,
  loginFresh,
  planPayLinkChange,
  type PlanInput,
} from "@/lib/pay-link/rules";

const NOW = new Date("2026-11-27T12:00:00Z");
const A = { linkId: "pl_A1b2C3d4E5f", merchantId: "m_aaa" };
const B = { linkId: "pl_B1b2C3d4E5f", merchantId: "m_bbb" };
const A2 = { linkId: "pl_C1b2C3d4E5f", merchantId: "m_aaa" };

const base: PlanInput = {
  current: null,
  next: A,
  now: NOW,
  freshLoginAt: new Date(NOW.getTime() - 60_000),
  contactChangedAt: null,
  hasTelegram: true,
  hasEmail: true,
  codeOk: true,
};

describe("установка и смены ссылки оплаты", () => {
  it("первая установка с кодом и свежим входом — сразу", () => {
    expect(planPayLinkChange(base)).toEqual({ kind: "install" });
  });

  it("первая установка без кода — отказ", () => {
    expect(planPayLinkChange({ ...base, codeOk: false })).toEqual({ kind: "deny", reason: "code_required" });
  });

  it("вход старше 15 минут — просьба войти снова", () => {
    expect(planPayLinkChange({ ...base, freshLoginAt: new Date(NOW.getTime() - 16 * 60_000) }))
      .toEqual({ kind: "deny", reason: "stale_login" });
    expect(planPayLinkChange({ ...base, freshLoginAt: null }))
      .toEqual({ kind: "deny", reason: "stale_login" });
  });

  it("ссылка того же магазина — сразу, кода не требует", () => {
    expect(planPayLinkChange({ ...base, current: A, next: A2, codeOk: false })).toEqual({ kind: "same" });
  });

  it("ссылка другого магазина — через сутки", () => {
    expect(planPayLinkChange({ ...base, current: A, next: B })).toEqual({
      kind: "delayed",
      effectiveAt: new Date(NOW.getTime() + CHANGE_DELAY_MS),
    });
  });

  it("другой магазин без кода — отказ, задержка его не заменяет", () => {
    expect(planPayLinkChange({ ...base, current: A, next: B, codeOk: false }))
      .toEqual({ kind: "deny", reason: "code_required" });
  });

  it("смена канала связи замораживает на сутки — и установку, и смену", () => {
    const frozen = { ...base, contactChangedAt: new Date(NOW.getTime() - 60 * 60_000) };
    expect(planPayLinkChange(frozen)).toEqual({ kind: "deny", reason: "contact_frozen" });
    expect(planPayLinkChange({ ...frozen, current: A, next: B })).toEqual({ kind: "deny", reason: "contact_frozen" });
  });

  it("через сутки после смены канала заморозки нет", () => {
    expect(planPayLinkChange({ ...base, contactChangedAt: new Date(NOW.getTime() - 24 * 60 * 60_000 - 1) }))
      .toEqual({ kind: "install" });
  });

  it("нет ни Telegram, ни почты — смена существующей ссылки запрещена", () => {
    expect(planPayLinkChange({ ...base, current: A, next: B, hasTelegram: false, hasEmail: false }))
      .toEqual({ kind: "deny", reason: "no_channel" });
  });

  it("нет Telegram, но есть почта — смена с задержкой и письмом", () => {
    expect(planPayLinkChange({ ...base, current: A, next: B, hasTelegram: false }))
      .toEqual({ kind: "delayed", effectiveAt: new Date(NOW.getTime() + CHANGE_DELAY_MS) });
  });

  it("первая установка каналов не требует: владелец стоит у экрана", () => {
    expect(planPayLinkChange({ ...base, hasTelegram: false, hasEmail: false })).toEqual({ kind: "install" });
  });

  it("тот же номер — не смена", () => {
    expect(planPayLinkChange({ ...base, current: A, next: A })).toEqual({ kind: "deny", reason: "same_link" });
  });

  it("порядок отказов: сперва вход, потом заморозка, потом код", () => {
    const all = {
      ...base,
      freshLoginAt: null,
      contactChangedAt: NOW,
      codeOk: false,
    };
    expect(planPayLinkChange(all)).toEqual({ kind: "deny", reason: "stale_login" });
    expect(planPayLinkChange({ ...all, freshLoginAt: NOW })).toEqual({ kind: "deny", reason: "contact_frozen" });
    expect(planPayLinkChange({ ...all, freshLoginAt: NOW, contactChangedAt: null }))
      .toEqual({ kind: "deny", reason: "code_required" });
  });
});

describe("когда нужен код", () => {
  it("при первой установке и при смене магазина", () => {
    expect(codeRequired(null, A)).toBe(true);
    expect(codeRequired(A, B)).toBe(true);
  });
  it("у ссылки того же магазина — не нужен", () => {
    expect(codeRequired(A, A2)).toBe(false);
  });
});

describe("подсказки страницы", () => {
  it("свежесть входа", () => {
    expect(loginFresh(new Date(NOW.getTime() - 14 * 60_000), NOW)).toBe(true);
    expect(loginFresh(new Date(NOW.getTime() - 15 * 60_000), NOW)).toBe(false);
  });

  it("до какого часа заморожено", () => {
    const changed = new Date(NOW.getTime() - 60 * 60_000);
    expect(contactFreezeUntil(changed, NOW)).toEqual(new Date(changed.getTime() + 24 * 60 * 60_000));
    expect(contactFreezeUntil(null, NOW)).toBeNull();
  });
});
