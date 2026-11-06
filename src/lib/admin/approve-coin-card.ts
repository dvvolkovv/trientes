/** Cards below this completeness are not worth showing publicly. */
export const MIN_COMPLETENESS_TO_PUBLISH = 35;
const MIN_REJECT_REASON = 3;

type CardRow = {
  id: string;
  slug: string;
  name: string;
  symbol: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  completeness: number;
  logoUrl: string | null;
};

type PrismaLike = {
  coinCard: {
    findUnique(args: { where: { id: string } }): Promise<CardRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<CardRow>;
  };
};

export type ApproveCardResult =
  | { ok: true; slug: string }
  | { ok: false; reason: "not_found" | "not_pending" | "too_incomplete" | "logo_required" };

export async function approveCoinCardCore(
  prisma: PrismaLike,
  input: { cardId: string; reviewerId: string },
): Promise<ApproveCardResult> {
  const card = await prisma.coinCard.findUnique({ where: { id: input.cardId } });
  if (!card) return { ok: false, reason: "not_found" };
  if (card.status !== "PENDING") return { ok: false, reason: "not_pending" };
  if (card.completeness < MIN_COMPLETENESS_TO_PUBLISH) {
    return { ok: false, reason: "too_incomplete" };
  }
  if (!card.logoUrl) return { ok: false, reason: "logo_required" };

  await prisma.coinCard.update({
    where: { id: card.id },
    data: {
      status: "APPROVED",
      reviewedById: input.reviewerId,
      reviewedAt: new Date(),
      rejectReason: null,
    },
  });
  return { ok: true, slug: card.slug };
}

export type RejectCardResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_pending" | "reason_too_short" };

export async function rejectCoinCardCore(
  prisma: PrismaLike,
  input: { cardId: string; reviewerId: string; reason: string },
): Promise<RejectCardResult> {
  const reason = (input.reason ?? "").trim();
  if (reason.length < MIN_REJECT_REASON) {
    return { ok: false, reason: "reason_too_short" };
  }
  const card = await prisma.coinCard.findUnique({ where: { id: input.cardId } });
  if (!card) return { ok: false, reason: "not_found" };
  if (card.status !== "PENDING") return { ok: false, reason: "not_pending" };

  await prisma.coinCard.update({
    where: { id: card.id },
    data: {
      status: "REJECTED",
      rejectReason: reason,
      reviewedById: input.reviewerId,
      reviewedAt: new Date(),
    },
  });
  return { ok: true };
}
