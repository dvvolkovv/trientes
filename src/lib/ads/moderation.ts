/**
 * Модерация рекламного материала — чистые правила (слайс CC). Спека
 * `docs/superpowers/specs/2026-11-23-ad-moderation-queue-design.md`.
 *
 * Решение владельца отменяет решение BY («модерации у рекламы нет»): материал виден
 * снаружи только после одобрения. Правила тут без Prisma — их проверяет тест, а не
 * живое нажатие в кабинете.
 */

import { MAX_PUBLISHED_ADS, parseAdInput, type AdInput, type AdValues } from "./rules";

export const AD_STATUSES = ["DRAFT", "PENDING", "PUBLISHED", "REJECTED", "ARCHIVED"] as const;
export type AdStatus = (typeof AD_STATUSES)[number];

export function isAdStatus(raw: unknown): raw is AdStatus {
  return typeof raw === "string" && (AD_STATUSES as readonly string[]).includes(raw);
}

/**
 * Как правится материал в этом состоянии.
 *
 * - `direct` — правка идёт в колонки: снаружи этого материала нет, защищать нечего
 *   (тот же разбор, которым BM пустил правки непрошедшего модерацию предприятия).
 * - `frozen` — материал на проверке. Разреши правку — и модератор одобрит ролик,
 *   который секундой раньше подменили другим. Выход один: «отозвать с проверки».
 * - `proposal` — опубликованный: в карусели остаётся прежний, одобренный, а правка
 *   ждёт слепком (дословно правило BM).
 */
export function adEditMode(status: AdStatus): "direct" | "frozen" | "proposal" {
  if (status === "PENDING") return "frozen";
  if (status === "PUBLISHED") return "proposal";
  return "direct";
}

/**
 * Можно ли отправить материал на проверку. Опубликованный не отправляется: его
 * правка и есть предложение, а повторная отправка того же содержания означала бы
 * вторую проверку одной и той же работы.
 *
 * Архив идёт через проверку заново: содержание могло пролежать месяцы, а «когда-то
 * одобрено» не значит «одобрено сейчас».
 */
export function adSubmittable(status: AdStatus): boolean {
  return status === "DRAFT" || status === "REJECTED" || status === "ARCHIVED";
}

/** Отозвать с проверки можно то, что на проверке: сам материал или его правку. */
export function adWithdrawable(input: { status: AdStatus; hasPending: boolean }): boolean {
  return input.status === "PENDING" || (input.status === "PUBLISHED" && input.hasPending);
}

/**
 * Занятые места карусели: опубликованные **плюс** ждущие проверки.
 *
 * Считать только опубликованные значило бы, что потолок вскрывается в момент
 * одобрения — отказом по делу, которое проверяющий уже проверил. Место занимает тот,
 * кто встал в очередь.
 */
export function adSlotsTaken(rows: { status: AdStatus }[]): number {
  return rows.filter((r) => r.status === "PUBLISHED" || r.status === "PENDING").length;
}

export function adSlotsFree(rows: { status: AdStatus }[]): number {
  return Math.max(0, MAX_PUBLISHED_ADS - adSlotsTaken(rows));
}

/** Виден ли материал продавцу как ждущий чужого решения — одна подпись на два случая. */
export function adAwaitsReview(input: { status: AdStatus; hasPending: boolean }): boolean {
  return input.status === "PENDING" || (input.status === "PUBLISHED" && input.hasPending);
}

/**
 * Слепок правки. Храним **форму**, а не разобранные значения: на одобрении слепок
 * проходит ту же проверку, что живая форма, — иначе правило, добавленное после
 * сохранения слепка, обошло бы его молча.
 */
export function readPendingPayload(raw: unknown): AdValues | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const parsed = parseAdInput(raw as AdInput);
  return parsed.ok ? parsed.value : null;
}

/** Поля, по которым модератору показывается «было → стало». */
export const AD_DIFF_FIELDS = [
  "kind", "title", "body", "language", "mediaKind", "mediaUrl", "posterUrl", "audioUrl",
  "promoCode", "startsAt", "endsAt", "eventAt", "eventEndAt",
  "placeName", "placeAddress", "placeLat", "placeLon", "placePaymentMethods",
  "placeAcceptedCoinIds", "placeAcceptedCardIds",
  "action", "productId", "pointId", "actionUrl",
] as const;

export type AdDiffRow = { field: string; from: string; to: string };

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  return String(v);
}

/**
 * Что именно просят изменить. Одинаковые значения в список не идут: проверяющему
 * нужен разговор о различиях, а не двадцать строк «осталось как было».
 */
export function adDiff(
  live: Record<string, unknown>,
  proposed: Record<string, unknown>,
): AdDiffRow[] {
  const out: AdDiffRow[] = [];
  for (const field of AD_DIFF_FIELDS) {
    const from = show(live[field]);
    const to = show(proposed[field]);
    if (from !== to) out.push({ field, from, to });
  }
  return out;
}
