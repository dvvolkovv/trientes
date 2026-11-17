// Восстановление пароля по письму. Токен — единственное доказательство, что
// человек владеет ящиком, поэтому он живёт час, срабатывает один раз и в базе
// лежит только его хэш: дамп таблицы не должен давать вход в чужой кабинет.
//
// Чистая часть здесь, работа с базой — в маршрутах
// /api/auth/password/{forgot,reset}.

import { createHash, randomBytes } from "node:crypto";

/** Час — столько, сколько человек идёт из письма обратно на сайт. */
export const RESET_TTL_MS = 60 * 60 * 1000;

/** Окно счёта просьб о сбросе. */
export const RESET_WINDOW_MS = 60 * 60 * 1000;
/** Просьб с одного адреса в окно. */
export const RESET_MAX_BY_IP = 10;
/** Писем на один ящик в окно — ниже, чем с адреса: это чужой ящик, не наш. */
export const RESET_MAX_BY_IP_IDENT = 3;

export type ResetTokenState = "valid" | "used" | "expired";

export type ResetTokenLifecycle = {
  expiresAt: Date;
  usedAt?: Date | null;
};

export function generateResetToken(): string {
  // 32 случайных байта → 43 знака base64url: в ссылке без кодирования.
  return randomBytes(32).toString("base64url");
}

export function hashResetToken(token: string): string {
  // Токен и так случайный на 256 бит, перебирать нечего — поэтому простого
  // sha256 довольно, bcrypt тут только замедлил бы проверку ссылки.
  return createHash("sha256").update(token).digest("hex");
}

export function resetExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + RESET_TTL_MS);
}

// Сработавший бьёт просроченный: сказать «устарела» по ссылке, которой уже
// сменили пароль, значит позвать человека просить новую без нужды.
export function resetTokenState(
  token: ResetTokenLifecycle,
  now: Date = new Date(),
): ResetTokenState {
  if (token.usedAt) return "used";
  if (token.expiresAt.getTime() <= now.getTime()) return "expired";
  return "valid";
}

export function isResetTokenUsable(
  token: ResetTokenLifecycle,
  now: Date = new Date(),
): boolean {
  return resetTokenState(token, now) === "valid";
}

export function evalResetLimit(c: {
  requestsByIp: number;
  requestsByIpAndIdentifier: number;
}): { blocked: boolean } {
  return {
    blocked:
      c.requestsByIp >= RESET_MAX_BY_IP ||
      c.requestsByIpAndIdentifier >= RESET_MAX_BY_IP_IDENT,
  };
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Приводит адрес к виду, в котором он лежит в `User.email`, или null. */
export function normalizeEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  return EMAIL_SHAPE.test(email) ? email : null;
}

/**
 * Запись в `LoginAttempt` для счёта просьб. Приставка обязательна: счёт по
 * адресу считает строки по ней, и строка без приставки ускользнула бы от
 * ограничения, а строки входа попали бы в него зря.
 */
export function resetIdentifier(email: string): string {
  return `__reset__:${email}`;
}

export const RESET_IDENTIFIER_PREFIX = "__reset__";

export function buildResetUrl(origin: string, locale: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/${locale}/reset-password/${token}`;
}
