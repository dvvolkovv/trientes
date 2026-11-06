"use server";

import { revalidatePath } from "next/cache";
import type { CompanyRole } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/notify";
import { NOT_DELETED } from "@/lib/soft-delete";

const ROLES: CompanyRole[] = ["OWNER", "EDITOR", "VIEWER"];

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

// Resolve "username or email" to a User. Username takes precedence (registered
// users prefer their handle); falls back to email if the string contains an @.
async function findUserByIdentifier(identifier: string) {
  const id = identifier.trim();
  if (!id) return null;
  if (id.includes("@")) {
    return prisma.user.findUnique({ where: { email: id.toLowerCase() }, select: { id: true, username: true, email: true } });
  }
  return prisma.user.findUnique({ where: { username: id.toLowerCase() }, select: { id: true, username: true, email: true } });
}

export async function inviteMember(input: { companyId: string; identifier: string; role: CompanyRole }) {
  const userId = await requireUserId();
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  if (!ROLES.includes(input.role)) return { ok: false as const, reason: "invalid" as const };
  if (!(await requireOwner(input.companyId, userId))) return { ok: false as const, reason: "forbidden" as const };
  const target = await findUserByIdentifier(input.identifier);
  if (!target) return { ok: false as const, reason: "user_not_found" as const };
  if (target.id === userId) return { ok: false as const, reason: "self" as const };

  // Upsert: if the user is already a member, bump them to the new role.
  await prisma.companyMember.upsert({
    where: { companyId_userId: { companyId: input.companyId, userId: target.id } },
    create: { companyId: input.companyId, userId: target.id, role: input.role, invitedById: userId },
    update: { role: input.role },
  });

  const company = await prisma.company.findFirst({
    where: { id: input.companyId, ...NOT_DELETED },
    select: { displayName: true },
  });
  void notifyUser({
    userId: target.id,
    text: `🤝 You were added to "${company?.displayName ?? "a company"}" on Trientes as ${input.role}.`,
    subject: `Added to ${company?.displayName ?? "a company"} on Trientes`,
  }).catch(() => {});

  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function updateMemberRole(input: { companyId: string; userId: string; role: CompanyRole }) {
  const actorId = await requireUserId();
  if (!actorId) return { ok: false as const, reason: "unauth" as const };
  if (!ROLES.includes(input.role)) return { ok: false as const, reason: "invalid" as const };
  if (!(await requireOwner(input.companyId, actorId))) return { ok: false as const, reason: "forbidden" as const };

  // Don't allow the only OWNER to step themselves down — the company needs at
  // least one OWNER for member admin and moderation handoff.
  if (input.userId === actorId && input.role !== "OWNER") {
    const owners = await prisma.companyMember.count({
      where: { companyId: input.companyId, role: "OWNER" },
    });
    if (owners <= 1) return { ok: false as const, reason: "last_owner" as const };
  }

  await prisma.companyMember.update({
    where: { companyId_userId: { companyId: input.companyId, userId: input.userId } },
    data: { role: input.role },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function removeMember(input: { companyId: string; userId: string }) {
  const actorId = await requireUserId();
  if (!actorId) return { ok: false as const, reason: "unauth" as const };
  if (!(await requireOwner(input.companyId, actorId))) return { ok: false as const, reason: "forbidden" as const };
  if (input.userId === actorId) {
    const owners = await prisma.companyMember.count({
      where: { companyId: input.companyId, role: "OWNER" },
    });
    if (owners <= 1) return { ok: false as const, reason: "last_owner" as const };
  }
  await prisma.companyMember.delete({
    where: { companyId_userId: { companyId: input.companyId, userId: input.userId } },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
