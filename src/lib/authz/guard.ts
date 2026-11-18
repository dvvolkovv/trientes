/**
 * Охранник: читает доступ из базы и отвечает на вопрос действия. Решает
 * политика (`policy.ts`), охранник только подаёт ей факты — политику можно
 * проверить тестом, а охранника нельзя.
 *
 * Доступ читается из базы на каждом запросе, поэтому снятое право действует
 * сразу, без перезахода (так же читается роль в `callbacks.session`).
 */
import { cache } from "react";
import { cookies } from "next/headers";
import type { CaseSubjectType } from "@prisma/client";
import { auth } from "@/auth";
import { authSessionCookieName } from "@/lib/session";
import { mfaGate, type MfaGate } from "@/lib/mfa/policy";
import { prisma } from "@/lib/prisma";
import {
  can,
  canAny,
  canOwnerOnly,
  isStaffRole,
  levelFor,
  type StaffLevel,
  type ViewerAccess,
  type ViewerRole,
} from "@/lib/authz/policy";
import { SUBJECT_QUEUES } from "@/lib/authz/map";

export type DenyReason = "unauth" | "no_access" | "mfa_setup" | "mfa_verify";
export type GuardResult =
  | { ok: true; userId: string; access: ViewerAccess }
  | { ok: false; reason: DenyReason };

/** Один запрос на запрос страницы: роль, отзыв и права. */
export const loadViewerAccess = cache(async (): Promise<ViewerAccess | null> => {
  const session = await auth();
  const user = session?.user as { id?: string } | undefined;
  if (!user?.id) return null;
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      role: true,
      staffMember: { select: { revokedAt: true } },
      staffGrants: { select: { queue: true, level: true, expiresAt: true } },
    },
  });
  if (!row) return null;
  return {
    userId: row.id,
    role: row.role as ViewerRole,
    revokedAt: row.staffMember?.revokedAt ?? null,
    grants: row.staffGrants.map((g) => ({
      queue: g.queue,
      level: g.level as StaffLevel,
      expiresAt: g.expiresAt,
    })),
  };
});

/**
 * Второй фактор — на сеансе, а не внутри входа: провайдеров входа четыре, и
 * встраивать проверку в каждый означало бы четыре места, где можно забыть.
 * Читается здесь, в той же калитке, где читается право на очередь, поэтому
 * фактор спрашивается у любого экрана и любого действия админки сразу.
 */
export const loadMfaGate = cache(async (): Promise<MfaGate> => {
  const access = await loadViewerAccess();
  if (!access) return "ok";
  const [mfa, token] = await Promise.all([
    prisma.staffMfa.findUnique({
      where: { userId: access.userId },
      select: { confirmedAt: true, disabledAt: true },
    }),
    cookies().then((jar) => jar.get(authSessionCookieName())?.value ?? null),
  ]);
  const session = token
    ? await prisma.session.findUnique({ where: { sessionToken: token }, select: { mfaAt: true } })
    : null;
  return mfaGate({ role: access.role, mfa, sessionMfaAt: session?.mfaAt ?? null });
});

/** Общая калитка в админку: вошёл, сотрудник или владелец, доступ не отозван, фактор показан. */
export async function requireStaff(): Promise<GuardResult> {
  const access = await loadViewerAccess();
  if (!access) return { ok: false, reason: "unauth" };
  if (access.revokedAt || !isStaffRole(access.role)) return { ok: false, reason: "no_access" };
  const gate = await loadMfaGate();
  if (gate === "setup") return { ok: false, reason: "mfa_setup" };
  if (gate === "verify") return { ok: false, reason: "mfa_verify" };
  return { ok: true, userId: access.userId, access };
}

export async function requireQueue(queue: string, need: StaffLevel): Promise<GuardResult> {
  const r = await requireStaff();
  if (!r.ok) return r;
  if (!can(r.access, queue, need, new Date())) return { ok: false, reason: "no_access" };
  return r;
}

/** Объект, за который отвечают две очереди (точка в делах о жалобах). */
export async function requireAnyQueue(queues: string[], need: StaffLevel): Promise<GuardResult> {
  const r = await requireStaff();
  if (!r.ok) return r;
  if (!canAny(r.access, queues, need, new Date())) return { ok: false, reason: "no_access" };
  return r;
}

export async function requireSubject(
  subjectType: CaseSubjectType,
  need: StaffLevel,
): Promise<GuardResult> {
  return requireAnyQueue(SUBJECT_QUEUES[subjectType], need);
}

export async function requireOwner(): Promise<GuardResult> {
  const access = await loadViewerAccess();
  if (!access) return { ok: false, reason: "unauth" };
  if (!canOwnerOnly(access)) return { ok: false, reason: "no_access" };
  return { ok: true, userId: access.userId, access };
}

/** Уровень смотрящего в очереди — чтобы страница не рисовала недоступных кнопок. */
export async function myLevel(queue: string): Promise<StaffLevel | null> {
  const access = await loadViewerAccess();
  return access ? levelFor(access, queue, new Date()) : null;
}

export async function mySubjectLevel(subjectType: CaseSubjectType): Promise<StaffLevel | null> {
  const access = await loadViewerAccess();
  if (!access) return null;
  const now = new Date();
  let best: StaffLevel | null = null;
  const ORDER: Record<StaffLevel, number> = { VIEW: 1, HANDLE: 2, APPROVE: 3 };
  for (const q of SUBJECT_QUEUES[subjectType]) {
    const lvl = levelFor(access, q, now);
    if (lvl && (!best || ORDER[lvl] > ORDER[best])) best = lvl;
  }
  return best;
}
