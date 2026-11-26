/**
 * Выборка покупателей предприятия (слайс CN). Правила сегментов — в `segments.ts`,
 * здесь только чтение: один источник фактов служит и плиткам сегментов, и списку, и
 * карточке человека, и отбору адресной рассылки (второй источник разошёлся бы с первым
 * — болезнь двух сборок витрины из живого прогона BX).
 */
import { prisma } from "@/lib/prisma";
import { addMoney, type CustomerFacts } from "@/lib/crm/segments";
import { REGULAR_WINDOW_DAYS } from "@/lib/crm/segments";

/**
 * Потолок списка. Две тысячи — это крупная сеть; усечение названо на экране, а не
 * обрезано молча (правило BK «no silent caps»).
 */
export const CRM_MAX_CUSTOMERS = 2000;

const DAY = 24 * 60 * 60 * 1000;

export type CrmOverview = {
  customers: CustomerFacts[];
  truncated: boolean;
  /**
   * Чеки, которые покупатель не привязал к кабинету. Называются отдельной строкой:
   * молчание читалось бы как «у нас мало продаж», а не «мы не знаем, кто покупал».
   */
  anonymousSales: number;
};

export async function readCompanyCustomers(companyId: string, now = new Date()): Promise<CrmOverview> {
  const since = new Date(now.getTime() - REGULAR_WINDOW_DAYS * DAY);

  const [follows, byCurrency, totals, inWindow, cancelled, threads, anonymousSales] = await Promise.all([
    prisma.companyFollow.findMany({
      where: { companyId },
      select: { userId: true, muted: true },
      take: CRM_MAX_CUSTOMERS + 1,
    }),
    // Оборот и кэшбэк по валютам: суммы разных валют не складываются (CK, CL).
    prisma.sale.groupBy({
      by: ["buyerUserId", "currency"],
      where: { companyId, status: "COMPLETED", buyerUserId: { not: null } },
      _sum: { total: true, cashbackTotal: true },
    }),
    prisma.sale.groupBy({
      by: ["buyerUserId"],
      where: { companyId, status: "COMPLETED", buyerUserId: { not: null } },
      _count: { _all: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
    }),
    prisma.sale.groupBy({
      by: ["buyerUserId"],
      where: { companyId, status: "COMPLETED", buyerUserId: { not: null }, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.sale.groupBy({
      by: ["buyerUserId"],
      where: { companyId, status: "CANCELLED", buyerUserId: { not: null } },
      _count: { _all: true },
    }),
    // Последнее сообщение **покупателя**: наш ответ активностью человека не является.
    prisma.customerThread.findMany({
      where: { companyId },
      select: {
        customerUserId: true,
        messages: {
          where: { side: "CUSTOMER" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
      },
      take: CRM_MAX_CUSTOMERS + 1,
    }),
    prisma.sale.count({ where: { companyId, status: "COMPLETED", buyerUserId: null } }),
  ]);

  const facts = new Map<string, CustomerFacts>();
  const blank = (userId: string): CustomerFacts => ({
    userId,
    username: null,
    name: null,
    follows: false,
    muted: false,
    notifyPromos: true,
    purchases: 0,
    purchasesInWindow: 0,
    cancelled: 0,
    firstPurchaseAt: null,
    lastPurchaseAt: null,
    lastMessageAt: null,
    turnover: {},
    cashback: {},
  });
  const touch = (userId: string): CustomerFacts => {
    const have = facts.get(userId);
    if (have) return have;
    const fresh = blank(userId);
    facts.set(userId, fresh);
    return fresh;
  };

  for (const f of follows) {
    const row = touch(f.userId);
    row.follows = true;
    row.muted = f.muted;
  }
  for (const t of totals) {
    if (!t.buyerUserId) continue;
    const row = touch(t.buyerUserId);
    row.purchases = t._count._all;
    row.firstPurchaseAt = t._min.createdAt ?? null;
    row.lastPurchaseAt = t._max.createdAt ?? null;
  }
  for (const w of inWindow) {
    if (!w.buyerUserId) continue;
    touch(w.buyerUserId).purchasesInWindow = w._count._all;
  }
  for (const c of cancelled) {
    if (!c.buyerUserId) continue;
    touch(c.buyerUserId).cancelled = c._count._all;
  }
  for (const m of byCurrency) {
    if (!m.buyerUserId) continue;
    const row = touch(m.buyerUserId);
    addMoney(row.turnover, m.currency, Number(m._sum.total ?? 0));
    addMoney(row.cashback, m.currency, Number(m._sum.cashbackTotal ?? 0));
  }
  for (const th of threads) {
    const row = touch(th.customerUserId);
    row.lastMessageAt = th.messages[0]?.createdAt ?? null;
  }

  const ids = [...facts.keys()];
  const truncated = ids.length > CRM_MAX_CUSTOMERS;
  const kept = truncated ? ids.slice(0, CRM_MAX_CUSTOMERS) : ids;

  // Имя входа и общий выключатель рассылок — одним запросом на всех: `findMany` со
  // связью на каждую строку уже стоил проекту 6,2 с и 355 МБ (живой прогон AD).
  const users = await prisma.user.findMany({
    where: { id: { in: kept } },
    select: { id: true, username: true, name: true, notifyPromos: true },
  });
  for (const u of users) {
    const row = facts.get(u.id);
    if (!row) continue;
    row.username = u.username;
    row.name = u.name;
    row.notifyPromos = u.notifyPromos;
  }

  const customers = kept
    .map((id) => facts.get(id)!)
    // Порядок: сперва те, кто покупал недавно, потом остальные по подписке.
    .sort((a, b) => (b.lastPurchaseAt?.getTime() ?? 0) - (a.lastPurchaseAt?.getTime() ?? 0));

  return { customers, truncated, anonymousSales };
}

/** Факты одного человека — карточка покупателя. Та же выборка, тот же счёт. */
export async function readCompanyCustomer(
  companyId: string,
  userId: string,
  now = new Date(),
): Promise<CustomerFacts | null> {
  const overview = await readCompanyCustomers(companyId, now);
  return overview.customers.find((c) => c.userId === userId) ?? null;
}

export type CustomerSaleRow = {
  id: string;
  number: number;
  createdAt: Date;
  currency: string;
  total: number;
  cashbackTotal: number;
  status: "COMPLETED" | "CANCELLED";
  cancelReason: string | null;
  pointName: string | null;
  lines: { name: string; qty: number }[];
};

/** История покупок человека **в этом магазине** и больше ничего: чужая покупка — не его. */
export async function readCustomerSales(
  companyId: string,
  userId: string,
  take = 50,
): Promise<CustomerSaleRow[]> {
  const rows = await prisma.sale.findMany({
    where: { companyId, buyerUserId: userId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      number: true,
      createdAt: true,
      currency: true,
      total: true,
      cashbackTotal: true,
      status: true,
      cancelReason: true,
      point: { select: { name: true } },
      lines: { select: { name: true, qty: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    createdAt: r.createdAt,
    currency: r.currency,
    total: Number(r.total),
    cashbackTotal: Number(r.cashbackTotal),
    status: r.status === "CANCELLED" ? "CANCELLED" : "COMPLETED",
    cancelReason: r.cancelReason,
    pointName: r.point?.name ?? null,
    lines: r.lines.map((l) => ({ name: l.name, qty: Number(l.qty) })),
  }));
}

/** Нитка переписки с этим человеком, если она есть — ссылка из карточки покупателя. */
export async function readCustomerThreadId(companyId: string, userId: string): Promise<string | null> {
  const thread = await prisma.customerThread.findUnique({
    where: { companyId_customerUserId: { companyId, customerUserId: userId } },
    select: { id: true },
  });
  return thread?.id ?? null;
}
