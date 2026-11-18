"use server";

/**
 * Второй фактор: действия сотрудника над своим фактором и владельца — над
 * чужим. Решения разобраны в спеке
 * `docs/superpowers/specs/2026-11-18-staff-second-factor-design.md`.
 */

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadMfaGate, requireOwner } from "@/lib/authz/guard";
import { logAdminAction } from "@/lib/admin/audit";
import { authSessionCookieName } from "@/lib/session";
import { enrollmentAllowedFor, mfaRequiredForRole } from "@/lib/mfa/policy";
import { checkMfaRateLimit, recordMfaAttempt } from "@/lib/rate-limit";
import {
  beginEnrollment,
  checkCode,
  confirmEnrollment,
  disableMfa,
  stampSession,
  useRecoveryCode,
} from "@/lib/mfa/service";

const MIN_REASON = 3;

type Viewer = { id: string; role: string; account: string };

/**
 * Кто перед нами. Фактор заводит себе сам человек, поэтому здесь не
 * `requireStaff()` (он сам требует фактора и отправил бы нас по кругу), а
 * прямое чтение роли из базы.
 */
async function viewer(): Promise<Viewer | null> {
  const session = await auth();
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) return null;
  const row = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, username: true, email: true, staffMember: { select: { revokedAt: true } } },
  });
  if (!row || row.staffMember?.revokedAt) return null;
  if (!mfaRequiredForRole(row.role)) return null;
  return { id: row.id, role: row.role, account: row.username ?? row.email ?? row.id };
}

async function currentIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  const first = fwd?.split(",")[0]?.trim();
  return first || h.get("x-real-ip")?.trim() || "unknown";
}

async function currentSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(authSessionCookieName())?.value ?? null;
}

export type MfaActionResult =
  | { ok: true }
  | { ok: true; recoveryCodes: string[] }
  | { ok: false; reason: string };

/**
 * Заводить фактор можно, только если его ещё нет — или если он есть и человек
 * **уже показал код в этом сеансе** (перевод на другой телефон).
 *
 * Без этой проверки второго фактора не было бы вовсе: украденного пароля хватало
 * бы, чтобы завести сеанс и перезаписать ключ своим — то есть обойти фактор
 * через дверь его же заведения. Экран `/mfa/setup` это и так не показывает, но
 * серверное действие вызывается прямым запросом, а не только с экрана.
 */
async function enrollmentAllowed(): Promise<boolean> {
  return enrollmentAllowedFor(await loadMfaGate());
}

/** Начать заведение: новый ключ и ссылка для приложения. */
export async function startMfaEnrollment(): Promise<
  { ok: true; secretB32: string; uri: string } | { ok: false; reason: string }
> {
  const me = await viewer();
  if (!me) return { ok: false, reason: "no_access" };
  if (!(await enrollmentAllowed())) return { ok: false, reason: "verify_first" };
  const { secretB32, uri } = await beginEnrollment(me.id, me.account);
  return { ok: true, secretB32, uri };
}

/** Подтвердить заведение кодом из приложения; в ответе — коды восстановления. */
export async function confirmMfaEnrollment(code: string): Promise<MfaActionResult> {
  const me = await viewer();
  if (!me) return { ok: false, reason: "no_access" };
  if (!(await enrollmentAllowed())) return { ok: false, reason: "verify_first" };

  const limit = await checkMfaRateLimit(me.id);
  if (limit.blocked) return { ok: false, reason: "rate_limited" };

  const r = await confirmEnrollment({ userId: me.id, code });
  // Запись о попытке — всегда: без неё подбор кода не стоил бы ничего.
  await recordMfaAttempt({ userId: me.id, ip: await currentIp(), success: r.ok });
  if (!r.ok) return { ok: false, reason: r.reason };

  const token = await currentSessionToken();
  if (token) await stampSession(token);
  await logAdminAction({
    actorId: me.id,
    action: "STAFF_MFA_ENABLED",
    targetType: "User",
    targetId: me.id,
    details: { kind: "TOTP" },
  });
  revalidatePath("/");
  return { ok: true, recoveryCodes: r.recoveryCodes };
}

/** Код из приложения при входе в админку. */
export async function verifyMfaCode(code: string): Promise<MfaActionResult> {
  const me = await viewer();
  if (!me) return { ok: false, reason: "no_access" };

  const limit = await checkMfaRateLimit(me.id);
  if (limit.blocked) return { ok: false, reason: "rate_limited" };

  const r = await checkCode({ userId: me.id, code });
  await recordMfaAttempt({ userId: me.id, ip: await currentIp(), success: r.ok });
  if (!r.ok) return { ok: false, reason: r.reason };

  const token = await currentSessionToken();
  if (token) await stampSession(token);
  revalidatePath("/");
  return { ok: true };
}

/** Код восстановления вместо кода из приложения. */
export async function useMfaRecoveryCode(code: string): Promise<MfaActionResult> {
  const me = await viewer();
  if (!me) return { ok: false, reason: "no_access" };

  const limit = await checkMfaRateLimit(me.id);
  if (limit.blocked) return { ok: false, reason: "rate_limited" };

  const r = await useRecoveryCode({ userId: me.id, code });
  await recordMfaAttempt({ userId: me.id, ip: await currentIp(), success: r.ok });
  if (!r.ok) return { ok: false, reason: r.reason };
  const token = await currentSessionToken();
  if (token) await stampSession(token);
  revalidatePath("/");
  return { ok: true };
}

/**
 * Снять фактор сотруднику. Только владелец и только с причиной; себе — нельзя:
 * иначе выманенный у владельца пароль снимал бы и фактор.
 */
export async function disableStaffMfa(input: {
  userId: string;
  reason: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const owner = await requireOwner();
  if (!owner.ok) return { ok: false, reason: owner.reason };
  if (input.userId === owner.userId) return { ok: false, reason: "self_target" };

  const reason = input.reason.trim();
  if (reason.length < MIN_REASON) return { ok: false, reason: "reason_too_short" };

  const row = await prisma.staffMfa.findUnique({
    where: { userId: input.userId },
    select: { userId: true },
  });
  if (!row) return { ok: false, reason: "not_enrolled" };

  await disableMfa({ targetUserId: input.userId, byUserId: owner.userId, reason });
  await logAdminAction({
    actorId: owner.userId,
    action: "STAFF_MFA_DISABLED",
    targetType: "User",
    targetId: input.userId,
    details: { reason },
  });
  revalidatePath("/");
  return { ok: true };
}
