/**
 * Ключи read-only API предприятия (слайс CL, ТЗ 6.4) — чистая часть.
 *
 * В базе лежит только sha256 и восемь знаков начала: показывается ключ один раз, и
 * повторно его не узнать (прецедент — ссылка чека в CK, приглашение сотрудника в AS).
 */
import { createHash, randomBytes } from "node:crypto";

/** Живых ключей на предприятие: больше пяти учётных систем у магазина не бывает. */
export const MAX_API_KEYS = 5;
/** Запросов в час на ключ. Считается в Redis; нет Redis — дверь не запираем (AR). */
export const API_RATE_PER_HOUR = 600;
/** Чеков в одном ответе: больше сотни — это выгрузка, а для неё есть CSV. */
export const API_PAGE_MAX = 100;
export const API_PAGE_DEFAULT = 50;
/** Имя ключа и причина отзыва. Порог причины — тот же, что у отказа в комплайнсе. */
export const KEY_NAME_MAX = 60;
export const REVOKE_REASON_MIN = 3;

const PREFIX_LEN = 8;

export function generateApiKey(): string {
  return `tri_${randomBytes(24).toString("base64url")}`;
}

export function hashApiKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Восемь знаков начала — чтобы владелец узнал свою строку в списке. */
export function apiKeyPrefix(token: string): string {
  return token.slice(0, PREFIX_LEN);
}

/**
 * Разбор заголовка. Принимаем только `Bearer`: ключ в строке запроса попадает в журнал
 * nginx, то есть утекает туда, где его не ждут.
 */
export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1];
  return token.startsWith("tri_") && token.length >= 12 ? token : null;
}

/** Имя ключа — одна строка без управляющих знаков: его читает человек в списке. */
export function keyNameValid(raw: string): boolean {
  const name = raw.trim();
  if (name.length < 2 || name.length > KEY_NAME_MAX) return false;
  return !/[\u0000-\u001f\u007f]/.test(name);
}
