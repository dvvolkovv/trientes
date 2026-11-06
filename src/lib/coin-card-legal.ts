// Правовой статус монеты по юрисдикциям (слайс F4).
//
// Жёсткие правила спеки, и они здесь не рекомендации:
//  - запись без источника и даты не сохраняется — утверждение о законе без
//    источника и даты хуже, чем его отсутствие;
//  - раздел всегда высокорисковый и всегда проходит модератора, независимо от
//    уровня доверия карточки (это обеспечивает isHighRiskSection("LEGAL"));
//  - дисклеймер не настройка: это заявление проекта со ссылкой на источник, а
//    не юридическая консультация Trientes;
//  - UNCLEAR — полноправный статус, а не отсутствие записи.

import { countryName } from "@/lib/countries";
import { normalizeHttpUrl } from "@/lib/coin-card-validate";

export const MAX_JURISDICTIONS = 60;
export const MAX_LEGAL_NOTE = 500;

export const JURISDICTION_STATUSES = [
  "ALLOWED",
  "LICENSED",
  "RESTRICTED",
  "BANNED",
  "UNCLEAR",
] as const;
export type JurisdictionStatus = (typeof JURISDICTION_STATUSES)[number];

export type Jurisdiction = {
  countryCode: string;
  status: JurisdictionStatus;
  note: string | null;
  /** Обязателен: без него это не факт, а слух. */
  sourceUrl: string;
  /** Обязательна, формат YYYY-MM-DD: закон меняется. */
  asOf: string;
};

export type Legal = {
  /** Всегда true — блок рендерится с дисклеймером, это не выбор проекта. */
  disclaimer: true;
  jurisdictions: Jurisdiction[];
};

export type LegalResult =
  | { ok: true; data: Legal }
  | {
      ok: false;
      reason:
        | "legal_source_required"
        | "legal_date_required"
        | "legal_status_invalid"
        | "legal_note_too_long"
        | "country_unknown"
        | "too_many_jurisdictions";
    };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

export function validateLegal(raw: unknown): LegalResult {
  const l = asObject(raw);
  const rows = Array.isArray(l.jurisdictions) ? l.jurisdictions : [];
  if (rows.length > MAX_JURISDICTIONS) return { ok: false, reason: "too_many_jurisdictions" };

  // Одна запись на страну: две разные оценки одного закона — это не данные, а
  // спор. Побеждает последняя, как при обычном редактировании списка.
  const byCountry = new Map<string, Jurisdiction>();

  for (const item of rows) {
    const r = asObject(item);

    const code = String(r.countryCode ?? "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || !countryName(code)) {
      return { ok: false, reason: "country_unknown" };
    }

    const statusRaw = String(r.status ?? "").trim().toUpperCase();
    if (!(JURISDICTION_STATUSES as readonly string[]).includes(statusRaw)) {
      return { ok: false, reason: "legal_status_invalid" };
    }

    const sourceUrl = normalizeHttpUrl(r.sourceUrl as string | null | undefined);
    if (!sourceUrl || sourceUrl === "invalid") return { ok: false, reason: "legal_source_required" };

    const asOf = String(r.asOf ?? "").trim();
    if (!ISO_DATE.test(asOf) || Number.isNaN(new Date(asOf).getTime())) {
      return { ok: false, reason: "legal_date_required" };
    }

    const note = typeof r.note === "string" && r.note.trim() ? r.note.trim() : null;
    if (note && note.length > MAX_LEGAL_NOTE) return { ok: false, reason: "legal_note_too_long" };

    byCountry.set(code, {
      countryCode: code,
      status: statusRaw as JurisdictionStatus,
      note,
      sourceUrl,
      asOf,
    });
  }

  return {
    ok: true,
    data: {
      disclaimer: true,
      jurisdictions: [...byCountry.values()].sort((a, b) =>
        a.countryCode.localeCompare(b.countryCode),
      ),
    },
  };
}
