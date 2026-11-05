"use server";

import { revalidatePath } from "next/cache";
import type { CompanyRole } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/notify";
import {
  MAX_ACTIVE_INVITES,
  generateInviteToken,
  inviteExpiry,
  inviteState,
} from "@/lib/company-invites";

const ROLES: CompanyRole[] = ["OWNER", "EDITOR", "VIEWER"];

async function requireUserId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

async function isOwner(companyId: string, userId: string): Promise<boolean> {
  const m = await prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId, userId } },
    select: { role: true },
  });
  return m?.role === "OWNER";
}

export async function createInvite(input: { companyId: string; role: CompanyRole }) {
  const userId = await requireUserId();
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  if (!ROLES.includes(input.role)) return { ok: false as const, reason: "invalid" as const };
  if (!(await isOwner(input.companyId, userId))) return { ok: false as const, reason: "forbidden" as const };

  const active = await prisma.companyInvite.count({
    where: {
      companyId: input.companyId,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (active >= MAX_ACTIVE_INVITES) return { ok: false as const, reason: "too_many" as const };

  const invite = await prisma.companyInvite.create({
    data: {
      companyId: input.companyId,
      role: input.role,
      token: generateInviteToken(),
      createdById: userId,
      expiresAt: inviteExpiry(),
    },
    select: { id: true, token: true, expiresAt: true },
  });
  revalidatePath("/", "layout");
  return { ok: true as const, ...invite };
}

export async function revokeInvite(input: { companyId: string; inviteId: string }) {
  const userId = await requireUserId();
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  if (!(await isOwner(input.companyId, userId))) return { ok: false as const, reason: "forbidden" as const };

  // Scoped by companyId so an owner of company A cannot revoke B's invites;
  // guarded on acceptedAt so an already-used link stays in its final state.
  const r = await prisma.companyInvite.updateMany({
    where: { id: input.inviteId, companyId: input.companyId, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (r.count === 0) return { ok: false as const, reason: "invalid" as const };
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function acceptInvite(input: { token: string }) {
  const userId = await requireUserId();
  if (!userId) return { ok: false as const, reason: "unauth" as const };

  const invite = await prisma.companyInvite.findUnique({
    where: { token: input.token },
    select: {
      id: true,
      companyId: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      company: { select: { displayName: true } },
    },
  });
  if (!invite) return { ok: false as const, reason: "invalid" as const };

  const state = inviteState(invite);
  if (state !== "valid") return { ok: false as const, reason: state, companyId: invite.companyId };

  // Already on the team: don't burn the link and never downgrade an existing
  // role — just send them to the company page.
  const existing = await prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId: invite.companyId, userId } },
    select: { id: true },
  });
  if (existing) return { ok: true as const, companyId: invite.companyId, already: true };

  // Single-use: the conditional update is the lock. If two people open the
  // same link at once, only one update touches a row.
  const claimed = await prisma.companyInvite.updateMany({
    where: { id: invite.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { acceptedAt: new Date(), acceptedById: userId },
  });
  if (claimed.count === 0) return { ok: false as const, reason: "accepted" as const, companyId: invite.companyId };

  await prisma.companyMember.create({
    data: { companyId: invite.companyId, userId, role: invite.role, invitedById: null },
  });

  const [joiner, owners] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { username: true, email: true } }),
    prisma.companyMember.findMany({
      where: { companyId: invite.companyId, role: "OWNER" },
      select: { userId: true },
    }),
  ]);
  const who = joiner?.username ?? joiner?.email ?? userId.slice(0, 6);
  for (const o of owners) {
    if (o.userId === userId) continue;
    void notifyUser({
      userId: o.userId,
      text: `🤝 ${who} joined "${invite.company.displayName}" on Trientes as ${invite.role}.`,
      subject: `New teammate in ${invite.company.displayName}`,
    }).catch(() => {});
  }

  revalidatePath("/", "layout");
  return { ok: true as const, companyId: invite.companyId, already: false };
}
