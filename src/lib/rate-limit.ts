import { prisma } from "@/lib/prisma";
import {
  RESET_IDENTIFIER_PREFIX,
  RESET_WINDOW_MS,
  evalResetLimit,
  resetIdentifier,
} from "@/lib/password-reset";

// Spec: 10 failed attempts per IP per 10 minutes → block for ~15 minutes.
// Implemented as a 15-minute sliding window with a 10-failure threshold: once
// the count is hit, the limiter stays blocked until the oldest failure ages out
// of the window (i.e., naturally ~15 min from the 10th attempt).
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILS_BY_IP = 10;
export const LOGIN_MAX_FAILS_BY_IP_IDENT = 5;
export const REGISTER_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const REGISTER_MAX_BY_IP = 5;

export function evalLoginLimit(c: {
  failuresByIp: number;
  failuresByIpAndIdentifier: number;
}): { blocked: boolean } {
  return {
    blocked:
      c.failuresByIp >= LOGIN_MAX_FAILS_BY_IP ||
      c.failuresByIpAndIdentifier >= LOGIN_MAX_FAILS_BY_IP_IDENT,
  };
}

export function evalRegisterLimit(c: { registrationsByIp: number }): { blocked: boolean } {
  return { blocked: c.registrationsByIp >= REGISTER_MAX_BY_IP };
}

// DB-backed checks (used in route handlers).
export async function checkLoginRateLimit(ip: string, identifier: string): Promise<{ blocked: boolean }> {
  const since = new Date(Date.now() - LOGIN_WINDOW_MS);
  const [failuresByIp, failuresByIpAndIdentifier] = await Promise.all([
    prisma.loginAttempt.count({ where: { ip, success: false, createdAt: { gte: since } } }),
    prisma.loginAttempt.count({
      where: { ip, identifier, success: false, createdAt: { gte: since } },
    }),
  ]);
  return evalLoginLimit({ failuresByIp, failuresByIpAndIdentifier });
}

export async function checkRegisterRateLimit(ip: string): Promise<{ blocked: boolean }> {
  const since = new Date(Date.now() - REGISTER_WINDOW_MS);
  // Re-use LoginAttempt with identifier="__register__" to avoid a 2nd table.
  const registrationsByIp = await prisma.loginAttempt.count({
    where: { ip, identifier: "__register__", createdAt: { gte: since } },
  });
  return evalRegisterLimit({ registrationsByIp });
}

export async function recordLoginAttempt(input: {
  ip: string;
  identifier: string;
  success: boolean;
  userId?: string | null;
}): Promise<void> {
  await prisma.loginAttempt.create({
    data: {
      ip: input.ip,
      identifier: input.identifier,
      success: input.success,
      userId: input.userId ?? null,
    },
  });
  // Lazy cleanup of old rows; cheap because indexed on createdAt.
  await prisma.loginAttempt.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
}

// Просьбы о сбросе пароля. Считаются по тем же строкам LoginAttempt: запись
// несёт приставку `__reset__`, поэтому счёт по адресу берёт только их, а не
// попытки входа.
export async function checkResetRateLimit(
  ip: string,
  email: string,
): Promise<{ blocked: boolean }> {
  const since = new Date(Date.now() - RESET_WINDOW_MS);
  const [requestsByIp, requestsByIpAndIdentifier] = await Promise.all([
    prisma.loginAttempt.count({
      where: {
        ip,
        identifier: { startsWith: RESET_IDENTIFIER_PREFIX },
        createdAt: { gte: since },
      },
    }),
    prisma.loginAttempt.count({
      where: { ip, identifier: resetIdentifier(email), createdAt: { gte: since } },
    }),
  ]);
  return evalResetLimit({ requestsByIp, requestsByIpAndIdentifier });
}

// --- Второй фактор (слайс BA) ---
// Шестизначный код при неограниченных попытках подбирается за сутки, поэтому
// ограничитель здесь обязателен. Считается по человеку, а не по адресу: вор
// знает пароль и может менять адрес, а защищаем мы одну конкретную запись.
export const MFA_WINDOW_MS = 15 * 60 * 1000;
export const MFA_MAX_FAILS = 10;

export function mfaIdentifier(userId: string): string {
  return `__mfa__:${userId}`;
}

export function evalMfaLimit(c: { failures: number }): { blocked: boolean } {
  return { blocked: c.failures >= MFA_MAX_FAILS };
}

export async function checkMfaRateLimit(userId: string): Promise<{ blocked: boolean }> {
  const since = new Date(Date.now() - MFA_WINDOW_MS);
  const failures = await prisma.loginAttempt.count({
    where: { identifier: mfaIdentifier(userId), success: false, createdAt: { gte: since } },
  });
  return evalMfaLimit({ failures });
}

export async function recordMfaAttempt(input: {
  userId: string;
  ip: string;
  success: boolean;
}): Promise<void> {
  await recordLoginAttempt({
    ip: input.ip,
    identifier: mfaIdentifier(input.userId),
    success: input.success,
    userId: input.userId,
  });
}
