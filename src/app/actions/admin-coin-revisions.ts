"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { applyRevisionNow } from "@/app/actions/coin-card-revisions";
import { notifyUser } from "@/lib/notify";

const MIN_REJECT_REASON = 3;

async function requireAdmin(): Promise<string | null> {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id || user.role !== "ADMIN") return null;
  return user.id;
}

export type AdminRevisionResult = { ok: true } | { ok: false; reason: string };

export async function applyCoinRevision(revisionId: string): Promise<AdminRevisionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return { ok: false, reason: "forbidden" };

  const rev = await prisma.coinCardRevision.findUnique({
    where: { id: revisionId },
    select: { id: true, cardId: true, status: true, authorId: true, card: { select: { name: true } } },
  });
  if (!rev) return { ok: false, reason: "not_found" };
  if (rev.status !== "PENDING_ADMIN") return { ok: false, reason: "revision_closed" };

  await prisma.coinCardRevision.update({
    where: { id: rev.id },
    data: { adminId, decidedAt: new Date() },
  });
  await applyRevisionNow(rev.id);
  await prisma.adminAuditLog.create({
    data: {
      actorId: adminId,
      action: "APPLY_COIN_REVISION",
      targetType: "CoinCardRevision",
      targetId: rev.id,
      details: { cardId: rev.cardId },
    },
  });
  void notifyUser({
    userId: rev.authorId,
    text: `✅ Your change to "${rev.card.name}" is live.`,
    subject: `${rev.card.name} updated`,
  }).catch(() => {});
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function rejectCoinRevision(
  revisionId: string,
  reason: string,
): Promise<AdminRevisionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return { ok: false, reason: "forbidden" };
  const note = (reason ?? "").trim();
  if (note.length < MIN_REJECT_REASON) return { ok: false, reason: "reason_too_short" };

  const rev = await prisma.coinCardRevision.findUnique({
    where: { id: revisionId },
    select: { id: true, cardId: true, status: true, authorId: true, card: { select: { name: true } } },
  });
  if (!rev) return { ok: false, reason: "not_found" };
  if (rev.status !== "PENDING_ADMIN") return { ok: false, reason: "revision_closed" };

  await prisma.coinCardRevision.update({
    where: { id: rev.id },
    data: { status: "REJECTED", adminId, adminNote: note, decidedAt: new Date() },
  });
  await prisma.adminAuditLog.create({
    data: {
      actorId: adminId,
      action: "REJECT_COIN_REVISION",
      targetType: "CoinCardRevision",
      targetId: rev.id,
      details: { cardId: rev.cardId, reason: note },
    },
  });
  void notifyUser({
    userId: rev.authorId,
    text: `❌ Your change to "${rev.card.name}" was rejected: ${note}`,
    subject: `${rev.card.name}: change rejected`,
  }).catch(() => {});
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Emergency exit: the signers are gone and the card is stuck. Applies a
 * revision that never collected its signatures. Audit-logged and shown in the
 * card's public history — there is no silent override.
 */
export async function forceCoinRevision(
  revisionId: string,
  reason: string,
): Promise<AdminRevisionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return { ok: false, reason: "forbidden" };
  const note = (reason ?? "").trim();
  if (note.length < MIN_REJECT_REASON) return { ok: false, reason: "reason_too_short" };

  const rev = await prisma.coinCardRevision.findUnique({
    where: { id: revisionId },
    select: { id: true, cardId: true, status: true },
  });
  if (!rev) return { ok: false, reason: "not_found" };
  if (rev.status !== "PENDING_SIGNERS" && rev.status !== "EXPIRED") {
    return { ok: false, reason: "revision_closed" };
  }

  await prisma.coinCardRevision.update({
    where: { id: rev.id },
    data: { adminId, adminNote: note, decidedAt: new Date() },
  });
  await applyRevisionNow(rev.id);
  await prisma.adminAuditLog.create({
    data: {
      actorId: adminId,
      action: "FORCE_COIN_REVISION",
      targetType: "CoinCard",
      targetId: rev.cardId,
      details: { revisionId: rev.id, reason: note },
    },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function disableCoinMultisig(
  cardId: string,
  reason: string,
): Promise<AdminRevisionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return { ok: false, reason: "forbidden" };
  const note = (reason ?? "").trim();
  if (note.length < MIN_REJECT_REASON) return { ok: false, reason: "reason_too_short" };

  const card = await prisma.coinCard.findUnique({ where: { id: cardId }, select: { id: true } });
  if (!card) return { ok: false, reason: "not_found" };

  await prisma.coinCardPolicy.upsert({
    where: { cardId },
    create: { cardId, multisig: false, threshold: 1, sections: [] },
    update: { multisig: false },
  });
  await prisma.adminAuditLog.create({
    data: {
      actorId: adminId,
      action: "DISABLE_COIN_MULTISIG",
      targetType: "CoinCard",
      targetId: cardId,
      details: { reason: note },
    },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Hands the card to the real project: the claimant becomes OWNER and the
 * steward is demoted to EDITOR rather than deleted — what happens next is the
 * project's call. Until slice D ships the proof flow, an admin does this by
 * hand on request.
 */
export async function transferCoinCard(input: {
  cardId: string;
  identifier: string;
}): Promise<AdminRevisionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return { ok: false, reason: "forbidden" };

  const id = input.identifier.trim().toLowerCase();
  const target = id.includes("@")
    ? await prisma.user.findUnique({ where: { email: id }, select: { id: true } })
    : await prisma.user.findUnique({ where: { username: id }, select: { id: true } });
  if (!target) return { ok: false, reason: "user_not_found" };

  const card = await prisma.coinCard.findUnique({
    where: { id: input.cardId },
    select: { id: true, stewardUserId: true, name: true },
  });
  if (!card) return { ok: false, reason: "not_found" };

  await prisma.coinCardMember.upsert({
    where: { cardId_userId: { cardId: card.id, userId: target.id } },
    create: { cardId: card.id, userId: target.id, role: "OWNER", isSigner: true },
    update: { role: "OWNER", sections: [], isSigner: true },
  });
  if (card.stewardUserId && card.stewardUserId !== target.id) {
    await prisma.coinCardMember.updateMany({
      where: { cardId: card.id, userId: card.stewardUserId },
      data: { role: "EDITOR" },
    });
  }
  await prisma.coinCard.update({
    where: { id: card.id },
    data: { stewardUserId: target.id, trust: "PROJECT_CLAIMED" },
  });
  await prisma.adminAuditLog.create({
    data: {
      actorId: adminId,
      action: "TRANSFER_COIN_CARD",
      targetType: "CoinCard",
      targetId: card.id,
      details: { toUserId: target.id, fromUserId: card.stewardUserId },
    },
  });
  void notifyUser({
    userId: target.id,
    text: `🪙 You are now the owner of the "${card.name}" card on Trientes.`,
    subject: `${card.name}: ownership transferred`,
  }).catch(() => {});
  revalidatePath("/", "layout");
  return { ok: true };
}
