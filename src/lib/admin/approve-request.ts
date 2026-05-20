type CoinRow = {
  id: string; symbol: string; name: string; slug: string; rank: number;
  source: string; isActive: boolean; addedByAdminId: string | null;
  approvedFromRequestId: string | null;
};
type ReqRow = {
  id: string; userId: string; name: string; symbol: string;
  coingeckoId: string | null; status: "PENDING" | "APPROVED" | "REJECTED";
  reviewedById: string | null; reviewedAt: Date | null; rejectReason: string | null;
};

type PrismaLike = {
  coinRequest: {
    findUnique(args: { where: { id: string } }): Promise<ReqRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<ReqRow>;
  };
  coin: {
    findUnique(args: { where: { id: string } }): Promise<CoinRow | null>;
    create(args: { data: Record<string, unknown> }): Promise<CoinRow>;
  };
};

export type ApproveResult =
  | { ok: true; coinId: string }
  | { ok: false; reason: "not_found" | "not_pending" | "no_coingecko_id" | "coin_exists" };

export async function approveRequestCore(
  prisma: PrismaLike,
  input: { requestId: string; reviewerId: string; coingeckoIdOverride?: string },
): Promise<ApproveResult> {
  const req = await prisma.coinRequest.findUnique({ where: { id: input.requestId } });
  if (!req) return { ok: false, reason: "not_found" };
  if (req.status !== "PENDING") return { ok: false, reason: "not_pending" };

  const overrideTrim = (input.coingeckoIdOverride ?? "").trim().toLowerCase();
  const coinId = overrideTrim || req.coingeckoId || "";
  if (!coinId) return { ok: false, reason: "no_coingecko_id" };

  const existing = await prisma.coin.findUnique({ where: { id: coinId } });
  if (existing) return { ok: false, reason: "coin_exists" };

  await prisma.coin.create({
    data: {
      id: coinId,
      symbol: req.symbol,
      name: req.name,
      slug: coinId,
      rank: 9999,                // sorted to the end until metadata-sync updates it
      source: "ADMIN_ADDED",
      isActive: true,
      addedByAdminId: input.reviewerId,
      approvedFromRequestId: req.id,
    },
  });

  await prisma.coinRequest.update({
    where: { id: req.id },
    data: {
      status: "APPROVED",
      reviewedById: input.reviewerId,
      reviewedAt: new Date(),
    },
  });

  return { ok: true, coinId };
}
