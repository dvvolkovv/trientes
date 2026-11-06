"use server";

import { revalidatePath } from "next/cache";
import type { CoinCardRole, CoinCardSection } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageMembers, canAssignRole } from "@/lib/coin-card-access";
import { getViewerCard } from "@/lib/coin-card-viewer";
import {
  MAX_ACTIVE_INVITES,
  generateInviteToken,
  inviteExpiry,
  inviteState,
} from "@/lib/coin-card-invites";
import { notifyUser } from "@/lib/notify";

const ROLES: CoinCardRole[] = ["OWNER", "ADMIN", "EDITOR", "VIEWER"];

export async function createCardInvite(input: {
  cardId: string;
  role: CoinCardRole;
  sections?: CoinCardSection[];
  isSigner?: boolean;
}) {
  const { userId, card, member } = await getViewerCard(input.cardId);
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  if (!card || !member) return { ok: false as const, reason: "not_found" as const };
  if (!ROLES.includes(input.role)) return { ok: false as const, reason: "invalid" as const };
  if (!canManageMembers(member)) return { ok: false as const, reason: "forbidden" as const };
  if (!canAssignRole(member, input.role)) return { ok: false as const, reason: "forbidden" as const };
  if (input.isSigner && member.role !== "OWNER") {
    return { ok: false as const, reason: "forbidden" as const };
  }

  const active = await prisma.coinCardInvite.count({
    where: {
      cardId: card.id,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (active >= MAX_ACTIVE_INVITES) return { ok: false as const, reason: "too_many" as const };

  const invite = await prisma.coinCardInvite.create({
    data: {
      cardId: card.id,
      role: input.role,
      sections: input.role === "EDITOR" ? Array.from(new Set(input.sections ?? [])) : [],
      isSigner: Boolean(input.isSigner),
      token: generateInviteToken(),
      createdById: userId,
      expiresAt: inviteExpiry(),
    },
    select: { id: true, token: true, expiresAt: true, role: true },
  });
  revalidatePath("/", "layout");
  return { ok: true as const, ...invite };
}

export async function revokeCardInvite(input: { cardId: string; inviteId: string }) {
  const { userId, card, member } = await getViewerCard(input.cardId);
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  if (!card || !member) return { ok: false as const, reason: "not_found" as const };
  if (!canManageMembers(member)) return { ok: false as const, reason: "forbidden" as const };

  // Scoped by cardId so a manager of card A cannot revoke B's links; guarded on
  // acceptedAt so an already-used link stays in its final state.
  const r = await prisma.coinCardInvite.updateMany({
    where: { id: input.inviteId, cardId: card.id, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (r.count === 0) return { ok: false as const, reason: "invalid" as const };
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function acceptCardInvite(input: { token: string }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false as const, reason: "unauth" as const };

  const invite = await prisma.coinCardInvite.findUnique({
    where: { token: input.token },
    select: {
      id: true, cardId: true, role: true, sections: true, isSigner: true,
      expiresAt: true, acceptedAt: true, revokedAt: true,
      card: { select: { name: true } },
    },
  });
  if (!invite) return { ok: false as const, reason: "invalid" as const };

  const state = inviteState(invite);
  if (state !== "valid") return { ok: false as const, reason: state, cardId: invite.cardId };

  // Already on the team: don't burn the link and never downgrade an existing role.
  const existing = await prisma.coinCardMember.findUnique({
    where: { cardId_userId: { cardId: invite.cardId, userId } },
    select: { id: true },
  });
  if (existing) return { ok: true as const, cardId: invite.cardId, already: true };

  // Single-use: the conditional update is the lock. Two people opening the same
  // link at once → only one update touches a row.
  const claimed = await prisma.coinCardInvite.updateMany({
    where: { id: invite.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { acceptedAt: new Date(), acceptedById: userId },
  });
  if (claimed.count === 0) {
    return { ok: false as const, reason: "accepted" as const, cardId: invite.cardId };
  }

  await prisma.coinCardMember.create({
    data: {
      cardId: invite.cardId,
      userId,
      role: invite.role,
      sections: invite.role === "EDITOR" ? invite.sections : [],
      isSigner: invite.isSigner,
      invitedById: null,
    },
  });

  const [joiner, owners] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { username: true, email: true } }),
    prisma.coinCardMember.findMany({
      where: { cardId: invite.cardId, role: "OWNER" },
      select: { userId: true },
    }),
  ]);
  const who = joiner?.username ?? joiner?.email ?? userId.slice(0, 6);
  for (const o of owners) {
    if (o.userId === userId) continue;
    void notifyUser({
      userId: o.userId,
      text: `🪙 ${who} joined the "${invite.card.name}" coin card team as ${invite.role}.`,
      subject: `New teammate on ${invite.card.name}`,
    }).catch(() => {});
  }

  revalidatePath("/", "layout");
  return { ok: true as const, cardId: invite.cardId, already: false };
}
