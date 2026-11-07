"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/notify";
import { websiteDomain } from "@/lib/claim-domain";
import { transferCardOwnership } from "@/lib/coin-card-claim-transfer";
import {
  canCheckClaim,
  canStartClaim,
  claimMessage,
  claimToken,
  CLAIM_TTL_MS,
  MAX_ATTEMPTS,
  verifyProof,
  type ClaimMethod,
} from "@/lib/coin-card-claim";

export type ClaimActionResult = { ok: true; claimId: string } | { ok: false; reason: string };
export type ClaimCheckResult =
  | { ok: true; verified: true }
  | { ok: false; reason: string };

const METHODS: ClaimMethod[] = ["OWNER_SIGNATURE", "DNS_TXT", "WELL_KNOWN"];

async function viewer(): Promise<{ id: string; username: string | null } | null> {
  const session = await auth();
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) return null;
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, username: true } });
  return user ?? null;
}

/**
 * Начало заявки: выдаём вызов. Подать может любой вошедший пользователь, в том
 * числе не состоящий в команде карточки, — в этом весь смысл: настоящий проект
 * вытесняет куратора, доказав контроль, а не договорившись с ним.
 */
export async function startClaim(cardId: string, method: string): Promise<ClaimActionResult> {
  const user = await viewer();
  if (!user) return { ok: false, reason: "unauth" };
  if (!METHODS.includes(method as ClaimMethod)) return { ok: false, reason: "bad_method" };

  const card = await prisma.coinCard.findUnique({
    where: { id: cardId },
    select: {
      id: true, slug: true, trust: true, links: true,
      contracts: { where: { isCanonical: true }, select: { id: true }, take: 1 },
    },
  });
  if (!card) return { ok: false, reason: "card_not_found" };

  const [openByUser, openByCard] = await Promise.all([
    prisma.coinCardClaim.count({ where: { claimantId: user.id, status: "PENDING" } }),
    prisma.coinCardClaim.count({ where: { cardId, status: "PENDING" } }),
  ]);

  const guard = canStartClaim({
    trust: card.trust,
    method: method as ClaimMethod,
    openByUser,
    openByCard,
    domain: websiteDomain(card.links),
    canonicalContract: card.contracts.length > 0,
  });
  if (!guard.ok) return { ok: false, reason: guard.reason };

  const claim = await prisma.coinCardClaim.create({
    data: {
      cardId,
      claimantId: user.id,
      method: method as ClaimMethod,
      token: claimToken(),
      expiresAt: new Date(Date.now() + CLAIM_TTL_MS),
    },
    select: { id: true },
  });
  revalidatePath("/", "layout");
  return { ok: true, claimId: claim.id };
}

/** Отмена своей заявки. */
export async function cancelClaim(claimId: string): Promise<ClaimCheckResult> {
  const user = await viewer();
  if (!user) return { ok: false, reason: "unauth" };
  const { count } = await prisma.coinCardClaim.updateMany({
    where: { id: claimId, claimantId: user.id, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  if (count === 0) return { ok: false, reason: "claim_closed" };
  revalidatePath("/", "layout");
  return { ok: true, verified: true };
}

/**
 * Проверка доказательства. Попытка считается всегда — и неудачная тоже: иначе
 * лимит в десять попыток не держал бы перебор.
 */
export async function checkClaim(claimId: string, signature?: string): Promise<ClaimCheckResult> {
  const user = await viewer();
  if (!user) return { ok: false, reason: "unauth" };

  const claim = await prisma.coinCardClaim.findUnique({
    where: { id: claimId },
    select: {
      id: true, cardId: true, claimantId: true, method: true, status: true,
      token: true, attempts: true, lastTriedAt: true, expiresAt: true,
      card: {
        select: {
          id: true, slug: true, name: true, trust: true, links: true, stewardUserId: true,
          contracts: {
            where: { isCanonical: true },
            select: { chain: true, address: true, verifiedAt: true },
            take: 1,
          },
        },
      },
    },
  });
  if (!claim) return { ok: false, reason: "claim_not_found" };
  if (claim.claimantId !== user.id) return { ok: false, reason: "forbidden" };

  const now = new Date();
  const guard = canCheckClaim(claim, now);
  if (!guard.ok) {
    if (guard.reason === "expired") {
      await prisma.coinCardClaim.update({ where: { id: claim.id }, data: { status: "EXPIRED" } });
    }
    return { ok: false, reason: guard.reason };
  }

  const contract = claim.card.contracts[0] ?? null;
  const proof = await verifyProof({
    method: claim.method as ClaimMethod,
    token: claim.token,
    message: claimMessage({
      slug: claim.card.slug,
      claimant: user.username ?? user.id,
      token: claim.token,
    }),
    domain: websiteDomain(claim.card.links),
    contract: contract ? { chain: contract.chain, address: contract.address } : null,
    signature: signature ?? null,
  });

  if (!proof.ok) {
    const attempts = claim.attempts + 1;
    await prisma.coinCardClaim.update({
      where: { id: claim.id },
      data: {
        attempts,
        lastTriedAt: now,
        lastError: proof.error,
        // Исчерпанные попытки закрывают заявку: новую придётся начать заново.
        status: attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
      },
    });
    revalidatePath("/", "layout");
    return { ok: false, reason: proof.error };
  }

  // Гонку двух одновременных проверок снимает условие по статусу: владение
  // передаёт только тот вызов, который первым перевёл заявку в VERIFIED.
  const claimed = await prisma.coinCardClaim.updateMany({
    where: { id: claim.id, status: "PENDING" },
    data: {
      status: "VERIFIED",
      verifiedAt: now,
      lastTriedAt: now,
      attempts: claim.attempts + 1,
      lastError: null,
      target: proof.target,
    },
  });
  if (claimed.count === 0) return { ok: false, reason: "claim_closed" };

  const previousSteward = claim.card.stewardUserId;
  await transferCardOwnership(prisma as never, {
    cardId: claim.cardId,
    claimId: claim.id,
    newOwnerId: user.id,
    previousStewardId: previousSteward,
    method: claim.method as ClaimMethod,
    target: proof.target,
    contractVerified: contract?.verifiedAt != null,
  });

  void notifyUser({
    userId: user.id,
    text: `🪙 Ownership of the "${claim.card.name}" card is confirmed — it is yours.`,
    subject: `${claim.card.name}: ownership confirmed`,
  }).catch(() => {});
  if (previousSteward && previousSteward !== user.id) {
    void notifyUser({
      userId: previousSteward,
      text: `🪙 The project proved ownership of the "${claim.card.name}" card. Your role is now editor.`,
      subject: `${claim.card.name}: ownership passed to the project`,
    }).catch(() => {});
  }

  revalidatePath("/", "layout");
  return { ok: true, verified: true };
}
