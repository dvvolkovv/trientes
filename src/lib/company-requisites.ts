/**
 * Публичные реквизиты предприятия (слайс BV): номер в торговом реестре и налоговый
 * номер. Спека `docs/superpowers/specs/2026-11-22-company-requisites-doc-rubrics-design.md`, § 2.
 *
 * **Формата не проверяем.** В мире десятки видов — ИНН, VAT, EIN, IČO, KRS, UEN,
 * CUIT, — и своя таблица по странам отстала бы в тот же месяц, а частичная проверка
 * отвергала бы верный номер (тот же разбор, которым BN отказался разбирать синтаксис
 * OSM). Проверяем ровно то, что знаем наверняка: длину, отсутствие ссылки и
 * отсутствие управляющих знаков.
 */

import { hasLink } from "@/lib/promos/rules";

export const REQUISITE_MIN = 2;
export const REQUISITE_MAX = 40;

export type RequisiteResult =
  | { ok: true; value: string | null }
  | { ok: false; reason: "too_short" | "too_long" | "has_link" | "bad_chars" };

/** Управляющие знаки и переводы строк: реквизит — одна строка, а не абзац. */
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * Пустое поле законно: обязательными реквизиты не делаем — в базе живут предприятия,
 * заведённые до слайса, и требование заполнить заперло бы им сохранение карточки.
 * Обязательность это пункт листа проверок у модератора, а не отказ формы.
 */
export function normalizeRequisite(raw: string | null | undefined): RequisiteResult {
  const value = (raw ?? "").trim().replace(/\s+/g, " ");
  if (value === "") return { ok: true, value: null };
  if (CONTROL.test(value)) return { ok: false, reason: "bad_chars" };
  if (value.length < REQUISITE_MIN) return { ok: false, reason: "too_short" };
  if (value.length > REQUISITE_MAX) return { ok: false, reason: "too_long" };
  // Текст выходит с нашего домена, значит за ссылку в нём отвечаем мы (правило BG).
  if (hasLink(value)) return { ok: false, reason: "has_link" };
  return { ok: true, value };
}
