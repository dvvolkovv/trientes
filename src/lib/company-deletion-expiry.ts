// Запрос на удаление, который никто не рассмотрел за DELETION_TTL_DAYS, протух,
// а не висит: иначе очередь подтверждений теряет смысл. Принимает PrismaLike,
// чтобы работа воркера проверялась тестом без базы — образец взят из
// coin-card-expiry.ts.

type PrismaLike = {
  companyDeletionRequest: {
    updateMany(args: {
      where: { status: "PENDING"; expiresAt: { lt: Date } };
      data: { status: "EXPIRED"; decidedAt: Date };
    }): Promise<{ count: number }>;
  };
};

export async function expireStaleDeletionRequests(
  prisma: PrismaLike,
  now: Date = new Date(),
): Promise<number> {
  const r = await prisma.companyDeletionRequest.updateMany({
    where: { status: "PENDING", expiresAt: { lt: now } },
    data: { status: "EXPIRED", decidedAt: now },
  });
  return r.count;
}
