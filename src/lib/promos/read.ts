/**
 * Чтение акций: витрина, кабинет, числа. Спека
 * `docs/superpowers/specs/2026-11-19-merchant-promos-antispam-design.md`.
 */
import { prisma } from "@/lib/prisma";
import { PUBLIC_COMPANY } from "@/lib/company-visibility";
import { PROMO_RECEIVES_PER_DAY, PROMO_SENDS_PER_DAY, type RecipientState } from "@/lib/promos/antispam";

const DAY = 24 * 60 * 60 * 1000;

/** Условие «акция идёт сейчас» для запроса. Это ускорение `promoVisible`, не замена. */
export function runningPromoWhere(now: Date) {
  return { archivedAt: null, startsAt: { lte: now }, endsAt: { gte: now } };
}

export type StorefrontPromo = {
  id: string;
  title: string;
  body: string;
  endsAt: Date;
  productSlug: string | null;
  productName: string | null;
  pointId: string | null;
  pointCity: string | null;
};

/** Акции предприятия для витрины. Снятое надзором предприятие сюда не попадает. */
export async function readStorefrontPromos(companyId: string, now = new Date()): Promise<StorefrontPromo[]> {
  const rows = await prisma.merchantPromo.findMany({
    where: { companyId, company: PUBLIC_COMPANY, ...runningPromoWhere(now) },
    orderBy: { endsAt: "asc" },
    take: 20,
    select: {
      id: true,
      title: true,
      body: true,
      endsAt: true,
      product: { select: { slug: true, name: true, suspendedAt: true, mergedIntoId: true } },
      point: { select: { id: true, city: true, status: true, suspendedAt: true } },
    },
  });
  return rows.map((r) => {
    // Снятый паспорт или снятая точка гасят привязку, а не акцию: обещание продавца
    // остаётся его обещанием, а ссылка на снятое вела бы в никуда.
    const liveProduct = r.product && !r.product.suspendedAt && !r.product.mergedIntoId ? r.product : null;
    const livePoint = r.point && r.point.status === "APPROVED" && !r.point.suspendedAt ? r.point : null;
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      endsAt: r.endsAt,
      productSlug: liveProduct?.slug ?? null,
      productName: liveProduct?.name ?? null,
      pointId: livePoint?.id ?? null,
      pointCity: livePoint?.city ?? null,
    };
  });
}

/** Акции продавцов этого товара — показываются рядом с их предложениями. */
export async function readProductPromos(productId: string, now = new Date()) {
  return prisma.merchantPromo.findMany({
    where: { productId, company: PUBLIC_COMPANY, ...runningPromoWhere(now) },
    orderBy: { endsAt: "asc" },
    take: 20,
    select: { id: true, companyId: true, title: true, body: true, endsAt: true },
  });
}

/** Акции, привязанные к названным точкам — строка в карточке точки навигатора. */
export async function readPointPromos(pointIds: readonly string[], now = new Date()) {
  if (pointIds.length === 0) return [];
  return prisma.merchantPromo.findMany({
    where: { pointId: { in: [...pointIds] }, company: PUBLIC_COMPANY, ...runningPromoWhere(now) },
    orderBy: { endsAt: "asc" },
    select: { id: true, pointId: true, title: true, body: true, endsAt: true },
  });
}

export type CabinetPromo = {
  id: string;
  title: string;
  body: string;
  startsAt: Date;
  endsAt: Date;
  archivedAt: Date | null;
  sentAt: Date | null;
  productSlug: string | null;
  pointId: string | null;
  followers: number;
  delivered: number;
  skipped: number;
  clicks: number;
};

/** Акции предприятия для кабинета — с числами рассылки и переходов. */
export async function readCabinetPromos(companyId: string): Promise<CabinetPromo[]> {
  const rows = await prisma.merchantPromo.findMany({
    where: { companyId },
    orderBy: [{ archivedAt: "asc" }, { endsAt: "desc" }],
    take: 100,
    select: {
      id: true,
      title: true,
      body: true,
      startsAt: true,
      endsAt: true,
      archivedAt: true,
      sentAt: true,
      product: { select: { slug: true } },
      pointId: true,
      sends: { select: { followers: true, delivered: true, skipped: true } },
      _count: { select: { clicks: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    archivedAt: r.archivedAt,
    sentAt: r.sentAt,
    productSlug: r.product?.slug ?? null,
    pointId: r.pointId,
    followers: r.sends.reduce((a, s) => a + s.followers, 0),
    delivered: r.sends.reduce((a, s) => a + s.delivered, 0),
    skipped: r.sends.reduce((a, s) => a + s.skipped, 0),
    clicks: r._count.clicks,
  }));
}

/** Состояние суточной квоты предприятия — по факту отправленного, а не по намерению. */
export async function companySendState(companyId: string, now = new Date()) {
  const sends = await prisma.promoSend.findMany({
    where: { promo: { companyId }, createdAt: { gte: new Date(now.getTime() - DAY) } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const last = await prisma.promoSend.findFirst({
    where: { promo: { companyId } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return { sentToday: sends.length, lastSentAt: last?.createdAt ?? null };
}

/** Сколько рассылок предприятию осталось на сегодня — число для кнопки в кабинете. */
export function quotaLeft(state: { sentToday: number }): number {
  return Math.max(0, PROMO_SENDS_PER_DAY - state.sentToday);
}

/**
 * Подписчики предприятия с тем, что нужно решению «писать ли ему»: отключение по
 * магазину, общий выключатель и сколько он уже получил за сутки от всех магазинов.
 */
export async function recipientStates(
  companyId: string,
  now = new Date(),
): Promise<(RecipientState & { userId: string })[]> {
  const follows = await prisma.companyFollow.findMany({
    where: { companyId },
    select: { userId: true, muted: true, user: { select: { notifyPromos: true } } },
    take: 5000,
  });
  if (follows.length === 0) return [];
  const since = new Date(now.getTime() - DAY);
  // Потолок получателя считается по доставленному, а не по строкам пропуска: пропуск
  // сообщением не был, и считать его сообщением значило бы наказывать человека за то,
  // что ему не написали.
  const counts = await prisma.promoDelivery.groupBy({
    by: ["userId"],
    where: {
      userId: { in: follows.map((f) => f.userId) },
      createdAt: { gte: since },
      outcome: { in: ["TELEGRAM", "EMAIL", "WEBPUSH"] },
    },
    _count: { _all: true },
  });
  const byUser = new Map(counts.map((c) => [c.userId, c._count._all]));
  return follows.map((f) => ({
    userId: f.userId,
    muted: f.muted,
    notifyPromos: f.user.notifyPromos,
    receivedToday: byUser.get(f.userId) ?? 0,
  }));
}

export { PROMO_RECEIVES_PER_DAY, PROMO_SENDS_PER_DAY };

/** Подписки человека — раздел «Подписки» в его кабинете. */
export async function readUserFollows(userId: string) {
  return prisma.companyFollow.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      companyId: true,
      muted: true,
      company: {
        select: { id: true, displayName: true, logoUrl: true, status: true, suspendedAt: true, deletedAt: true },
      },
    },
  });
}

export async function readFollow(userId: string, companyId: string) {
  return prisma.companyFollow.findUnique({
    where: { userId_companyId: { userId, companyId } },
    select: { muted: true },
  });
}

export async function countFollowers(companyId: string) {
  return prisma.companyFollow.count({ where: { companyId } });
}
