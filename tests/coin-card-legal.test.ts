import { describe, expect, it } from "vitest";
import {
  JURISDICTION_STATUSES,
  MAX_JURISDICTIONS,
  MAX_LEGAL_NOTE,
  validateLegal,
} from "@/lib/coin-card-legal";

const row = {
  countryCode: "PL",
  status: "ALLOWED",
  note: "Приём оплаты разрешён, VASC-регистрация для обмена",
  sourceUrl: "https://knf.gov.pl/some-ruling",
  asOf: "2026-11-06",
};

describe("validateLegal", () => {
  it("accepts a complete record and normalises the country code", () => {
    const r = validateLegal({ jurisdictions: [{ ...row, countryCode: "pl" }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.jurisdictions[0].countryCode).toBe("PL");
      expect(r.data.jurisdictions[0].asOf).toBe("2026-11-06");
      // Дисклеймер — не настройка проекта: блок всегда рендерится с ним.
      expect(r.data.disclaimer).toBe(true);
    }
  });

  it("accepts an empty block — a project may have nothing to declare yet", () => {
    const r = validateLegal({});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.jurisdictions).toEqual([]);
  });

  it("refuses a claim about the law without a source", () => {
    const { sourceUrl: _drop, ...noSource } = row;
    expect(validateLegal({ jurisdictions: [noSource] })).toEqual({
      ok: false,
      reason: "legal_source_required",
    });
    expect(validateLegal({ jurisdictions: [{ ...row, sourceUrl: "javascript:alert(1)" }] })).toEqual({
      ok: false,
      reason: "legal_source_required",
    });
  });

  it("refuses a claim without a date — the law changes", () => {
    const { asOf: _drop, ...noDate } = row;
    expect(validateLegal({ jurisdictions: [noDate] })).toEqual({
      ok: false,
      reason: "legal_date_required",
    });
    expect(validateLegal({ jurisdictions: [{ ...row, asOf: "yesterday" }] })).toEqual({
      ok: false,
      reason: "legal_date_required",
    });
  });

  it("refuses an unknown country and an unknown status", () => {
    expect(validateLegal({ jurisdictions: [{ ...row, countryCode: "XX" }] })).toEqual({
      ok: false,
      reason: "country_unknown",
    });
    expect(validateLegal({ jurisdictions: [{ ...row, status: "PROBABLY_FINE" }] })).toEqual({
      ok: false,
      reason: "legal_status_invalid",
    });
  });

  it("treats UNCLEAR as a full status, not as a missing record", () => {
    const r = validateLegal({ jurisdictions: [{ ...row, status: "UNCLEAR" }] });
    expect(r.ok && r.data.jurisdictions[0].status).toBe("UNCLEAR");
    expect(JURISDICTION_STATUSES).toContain("UNCLEAR");
  });

  it("caps the list and the note", () => {
    const many = Array.from({ length: MAX_JURISDICTIONS + 1 }, () => row);
    expect(validateLegal({ jurisdictions: many })).toEqual({ ok: false, reason: "too_many_jurisdictions" });
    expect(validateLegal({ jurisdictions: [{ ...row, note: "x".repeat(MAX_LEGAL_NOTE + 1) }] })).toEqual({
      ok: false,
      reason: "legal_note_too_long",
    });
  });

  it("keeps one record per country — the last one wins", () => {
    const r = validateLegal({
      jurisdictions: [row, { ...row, status: "BANNED", note: "позже" }],
    });
    expect(r.ok && r.data.jurisdictions).toHaveLength(1);
    expect(r.ok && r.data.jurisdictions[0].status).toBe("BANNED");
  });
});
