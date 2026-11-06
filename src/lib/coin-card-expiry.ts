// A revision nobody signed within REVISION_TTL_DAYS is stale, not pending —
// leaving it open forever would make the queue meaningless. Takes a PrismaLike
// so the worker's only scheduled coin-card job is unit-testable.

type PrismaLike = {
  coinCardRevision: {
    updateMany(args: {
      where: { status: "PENDING_SIGNERS"; expiresAt: { lt: Date } };
      data: { status: "EXPIRED"; decidedAt: Date };
    }): Promise<{ count: number }>;
  };
};

export async function expireStaleRevisions(
  prisma: PrismaLike,
  now: Date = new Date(),
): Promise<number> {
  const r = await prisma.coinCardRevision.updateMany({
    where: { status: "PENDING_SIGNERS", expiresAt: { lt: now } },
    data: { status: "EXPIRED", decidedAt: now },
  });
  return r.count;
}
