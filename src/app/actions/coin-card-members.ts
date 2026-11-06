"use server";

import { revalidatePath } from "next/cache";
import type { CoinCardRole, CoinCardSection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canManageMembers, canAssignRole } from "@/lib/coin-card-access";
import { getViewerCard } from "@/lib/coin-card-viewer";
import { notifyUser } from "@/lib/notify";

const ROLES: CoinCardRole[] = ["OWNER", "ADMIN", "EDITOR", "VIEWER"];

export type MemberResult = { ok: true } | { ok: false; reason: string };

/** Section grants only mean anything for an EDITOR; stale grants are a trap. */
function normalizeSections(role: CoinCardRole, sections: CoinCardSection[]): CoinCardSection[] {
  return role === "EDITOR" ? Array.from(new Set(sections)) : [];
}

async function ownerCount(cardId: string): Promise<number> {
  return prisma.coinCardMember.count({ where: { cardId, role: "OWNER" } });
}

/**
 * Would the card still have enough signers for its own threshold? An explicit
 * refusal beats silently lowering someone's multisig threshold.
 */
async function signersWouldHold(cardId: string, delta: number): Promise<boolean> {
  const policy = await prisma.coinCardPolicy.findUnique({ where: { cardId } });
  if (!policy?.multisig) return true;
  const signers = await prisma.coinCardMember.count({ where: { cardId, isSigner: true } });
  return signers + delta >= policy.threshold;
}

async function findUserByIdentifier(identifier: string) {
  const id = identifier.trim().toLowerCase();
  if (!id) return null;
  if (id.includes("@")) {
    return prisma.user.findUnique({ where: { email: id }, select: { id: true } });
  }
  return prisma.user.findUnique({ where: { username: id }, select: { id: true } });
}

export async function inviteCardMember(input: {
  cardId: string;
  identifier: string;
  role: CoinCardRole;
  sections?: CoinCardSection[];
  isSigner?: boolean;
}): Promise<MemberResult> {
  const { userId, card, member } = await getViewerCard(input.cardId);
  if (!userId) return { ok: false, reason: "unauth" };
  if (!card || !member) return { ok: false, reason: "not_found" };
  if (!ROLES.includes(input.role)) return { ok: false, reason: "invalid" };
  if (!canManageMembers(member)) return { ok: false, reason: "forbidden" };
  if (!canAssignRole(member, input.role)) return { ok: false, reason: "forbidden" };
  // Only an OWNER hands out signing rights — they are the multisig.
  if (input.isSigner && member.role !== "OWNER") return { ok: false, reason: "forbidden" };

  const target = await findUserByIdentifier(input.identifier);
  if (!target) return { ok: false, reason: "user_not_found" };
  if (target.id === userId) return { ok: false, reason: "self" };

  const existing = await prisma.coinCardMember.findUnique({
    where: { cardId_userId: { cardId: card.id, userId: target.id } },
    select: { role: true },
  });
  // An ADMIN must not be able to overwrite an OWNER's membership.
  if (existing && !canAssignRole(member, existing.role)) {
    return { ok: false, reason: "forbidden" };
  }

  await prisma.coinCardMember.upsert({
    where: { cardId_userId: { cardId: card.id, userId: target.id } },
    create: {
      cardId: card.id,
      userId: target.id,
      role: input.role,
      sections: normalizeSections(input.role, input.sections ?? []),
      isSigner: Boolean(input.isSigner),
      invitedById: userId,
    },
    update: {
      role: input.role,
      sections: normalizeSections(input.role, input.sections ?? []),
      isSigner: Boolean(input.isSigner),
    },
  });

  void notifyUser({
    userId: target.id,
    text: `🪙 You were added to the "${card.name}" coin card on Trientes as ${input.role}.`,
    subject: `Added to ${card.name} on Trientes`,
  }).catch(() => {});

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateCardMember(input: {
  cardId: string;
  userId: string;
  role: CoinCardRole;
  sections?: CoinCardSection[];
  isSigner?: boolean;
}): Promise<MemberResult> {
  const { userId: actorId, card, member } = await getViewerCard(input.cardId);
  if (!actorId) return { ok: false, reason: "unauth" };
  if (!card || !member) return { ok: false, reason: "not_found" };
  if (!ROLES.includes(input.role)) return { ok: false, reason: "invalid" };
  if (!canManageMembers(member)) return { ok: false, reason: "forbidden" };

  const target = await prisma.coinCardMember.findUnique({
    where: { cardId_userId: { cardId: card.id, userId: input.userId } },
    select: { role: true, isSigner: true },
  });
  if (!target) return { ok: false, reason: "not_found" };
  if (!canAssignRole(member, target.role)) return { ok: false, reason: "forbidden" };
  if (!canAssignRole(member, input.role)) return { ok: false, reason: "forbidden" };
  if (input.isSigner !== undefined && input.isSigner !== target.isSigner && member.role !== "OWNER") {
    return { ok: false, reason: "forbidden" };
  }

  // The card must never be left without an owner.
  if (target.role === "OWNER" && input.role !== "OWNER" && (await ownerCount(card.id)) <= 1) {
    return { ok: false, reason: "last_owner" };
  }
  if (target.isSigner && input.isSigner === false && !(await signersWouldHold(card.id, -1))) {
    return { ok: false, reason: "threshold_unreachable" };
  }

  await prisma.coinCardMember.update({
    where: { cardId_userId: { cardId: card.id, userId: input.userId } },
    data: {
      role: input.role,
      sections: normalizeSections(input.role, input.sections ?? []),
      isSigner: input.isSigner ?? target.isSigner,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeCardMember(input: {
  cardId: string;
  userId: string;
}): Promise<MemberResult> {
  const { userId: actorId, card, member } = await getViewerCard(input.cardId);
  if (!actorId) return { ok: false, reason: "unauth" };
  if (!card || !member) return { ok: false, reason: "not_found" };
  if (!canManageMembers(member)) return { ok: false, reason: "forbidden" };

  const target = await prisma.coinCardMember.findUnique({
    where: { cardId_userId: { cardId: card.id, userId: input.userId } },
    select: { role: true, isSigner: true },
  });
  if (!target) return { ok: false, reason: "not_found" };
  if (!canAssignRole(member, target.role)) return { ok: false, reason: "forbidden" };
  if (target.role === "OWNER" && (await ownerCount(card.id)) <= 1) {
    return { ok: false, reason: "last_owner" };
  }
  if (target.isSigner && !(await signersWouldHold(card.id, -1))) {
    return { ok: false, reason: "threshold_unreachable" };
  }

  await prisma.coinCardMember.delete({
    where: { cardId_userId: { cardId: card.id, userId: input.userId } },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
