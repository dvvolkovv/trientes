"use server";

/**
 * Конструктор ролей предприятия и участки по точкам продаж (ТЗ 6.6, слайс BE).
 * Спека `docs/superpowers/specs/2026-11-19-merchant-team-roles-design.md`.
 *
 * Выдаёт права **только владелец** — право «выдавать права» в самом конструкторе
 * означало бы, что приглашённый повышает себя сам (то же решение в AS: `requireOwner`,
 * запрет `self_grant`).
 */

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logCompanyAction } from "@/lib/company-team/journal";
import { MAX_TEAM_ROLES, parsePermissions, type TeamPermissions } from "@/lib/company-team/permissions";

type Fail = { ok: false; reason: string };
const fail = (reason: string): Fail => ({ ok: false, reason });

const NAME_MIN = 2;
const NAME_MAX = 40;

async function requireUserId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

async function requireOwner(companyId: string, userId: string): Promise<boolean> {
  const m = await prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId, userId } },
    select: { role: true },
  });
  return m?.role === "OWNER";
}

export async function saveTeamRole(input: {
  companyId: string;
  roleId?: string | null;
  name: string;
  permissions: Record<string, string>;
}) {
  const userId = await requireUserId();
  if (!userId) return fail("unauth");
  if (!(await requireOwner(input.companyId, userId))) return fail("forbidden");

  const name = (input.name ?? "").trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) return fail("name_invalid");

  // Набор разбирается тем же парсером, что читает базу: мусор из формы и мусор из
  // дампа должны значить одно и то же — запрет.
  const permissions: TeamPermissions = parsePermissions(input.permissions);
  // Роль без единого права — ловушка: человек с ней не видит кабинета вовсе, а
  // владелец думает, что кого-то наделил. Пусть это будет сказано вслух.
  if (Object.keys(permissions).length === 0) return fail("permissions_empty");

  try {
    if (input.roleId) {
      const updated = await prisma.companyTeamRole.updateMany({
        where: { id: input.roleId, companyId: input.companyId },
        data: { name, permissions: permissions as never },
      });
      if (updated.count === 0) return fail("not_found");
      await logCompanyAction({
        companyId: input.companyId,
        actorUserId: userId,
        action: "TEAM_ROLE_SAVED",
        subject: name,
        meta: { permissions, roleId: input.roleId },
      });
      revalidatePath("/", "layout");
      return { ok: true as const, id: input.roleId };
    }

    const count = await prisma.companyTeamRole.count({ where: { companyId: input.companyId } });
    if (count >= MAX_TEAM_ROLES) return fail("too_many");

    const role = await prisma.companyTeamRole.create({
      data: {
        companyId: input.companyId,
        name,
        permissions: permissions as never,
        createdById: userId,
      },
      select: { id: true },
    });
    await logCompanyAction({
      companyId: input.companyId,
      actorUserId: userId,
      action: "TEAM_ROLE_SAVED",
      subject: name,
      meta: { permissions, roleId: role.id },
    });
    revalidatePath("/", "layout");
    return { ok: true as const, id: role.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail("name_taken");
    }
    throw error;
  }
}

/**
 * Снятие роли. Члены, у которых она стояла, падают в `roleId: null` — и остаются
 * **наблюдателями**: при назначении своей роли базовая роль становится `VIEWER`
 * (см. `setMemberTeamRole`), поэтому снос роли понижает, а не повышает до редактора.
 */
export async function deleteTeamRole(input: { companyId: string; roleId: string }) {
  const userId = await requireUserId();
  if (!userId) return fail("unauth");
  if (!(await requireOwner(input.companyId, userId))) return fail("forbidden");

  const role = await prisma.companyTeamRole.findFirst({
    where: { id: input.roleId, companyId: input.companyId },
    select: { id: true, name: true, _count: { select: { members: true } } },
  });
  if (!role) return fail("not_found");

  await prisma.companyTeamRole.delete({ where: { id: role.id } });
  await logCompanyAction({
    companyId: input.companyId,
    actorUserId: userId,
    action: "TEAM_ROLE_DELETED",
    subject: role.name,
    meta: { members: role._count.members },
  });
  revalidatePath("/", "layout");
  return { ok: true as const, members: role._count.members };
}

/**
 * Назначение своей роли члену. Базовая роль при этом становится `VIEWER`: если роль
 * однажды снесут, человек останется смотрящим, а не получит права редактора фазы 10.
 * `roleId: null` возвращает наследие — базовую роль назовёт владелец отдельно.
 */
export async function setMemberTeamRole(input: { companyId: string; userId: string; roleId: string | null }) {
  const actorId = await requireUserId();
  if (!actorId) return fail("unauth");
  if (!(await requireOwner(input.companyId, actorId))) return fail("forbidden");

  const member = await prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId: input.companyId, userId: input.userId } },
    select: { id: true, role: true, user: { select: { username: true, name: true } } },
  });
  if (!member) return fail("not_found");
  // Владелец не настраивается: иначе набор прав можно довести до состояния, из
  // которого нет выхода — тот же мотив, что запрет понижать последнего владельца.
  if (member.role === "OWNER") return fail("owner_target");

  let roleName: string | null = null;
  if (input.roleId) {
    const role = await prisma.companyTeamRole.findFirst({
      where: { id: input.roleId, companyId: input.companyId },
      select: { id: true, name: true },
    });
    if (!role) return fail("role_not_found");
    roleName = role.name;
  }

  await prisma.companyMember.update({
    where: { id: member.id },
    data: { roleId: input.roleId, ...(input.roleId ? { role: "VIEWER" as const } : {}) },
  });
  await logCompanyAction({
    companyId: input.companyId,
    actorUserId: actorId,
    action: "MEMBER_ROLE_SET",
    subject: member.user.username ?? member.user.name ?? input.userId,
    meta: { roleId: input.roleId, roleName },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Участок: точки, которыми член ограничен. Пустой список снимает ограничение. */
export async function setMemberPoints(input: { companyId: string; userId: string; pointIds: string[] }) {
  const actorId = await requireUserId();
  if (!actorId) return fail("unauth");
  if (!(await requireOwner(input.companyId, actorId))) return fail("forbidden");

  const member = await prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId: input.companyId, userId: input.userId } },
    select: { id: true, role: true, user: { select: { username: true, name: true } } },
  });
  if (!member) return fail("not_found");
  // Владельца участком не ограничиваем: предприятию нужен человек, который видит всё.
  if (member.role === "OWNER") return fail("owner_target");

  const wanted = Array.from(new Set(input.pointIds.filter(Boolean)));
  if (wanted.length > 0) {
    const own = await prisma.companyPoint.count({
      where: { id: { in: wanted }, companyId: input.companyId, deletedAt: null },
    });
    if (own !== wanted.length) return fail("point_unknown");
  }

  await prisma.$transaction([
    prisma.companyMemberPoint.deleteMany({ where: { memberId: member.id } }),
    ...(wanted.length > 0
      ? [prisma.companyMemberPoint.createMany({ data: wanted.map((pointId) => ({ memberId: member.id, pointId })) })]
      : []),
  ]);
  await logCompanyAction({
    companyId: input.companyId,
    actorUserId: actorId,
    action: "MEMBER_POINTS_SET",
    subject: member.user.username ?? member.user.name ?? input.userId,
    meta: { points: wanted.length },
  });
  revalidatePath("/", "layout");
  return { ok: true as const, points: wanted.length };
}
