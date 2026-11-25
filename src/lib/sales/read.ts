/**
 * Чтение для кассы и чеков. Правила — в `rules.ts`, здесь только выборка.
 */
import { prisma } from "@/lib/prisma";
import { effectiveCashback } from "@/lib/loyalty/rates";
import { readCompanyRates } from "@/lib/loyalty/read";
import { isService, type OfferedProduct } from "@/lib/sales/rules";

/**
 * Что касса умеет продать: товар с живым предложением этого предприятия. Ставка
 * считается действующей (товар → категория → предприятие) один раз на весь список, а не
 * запросом на строку — тот же дефект, что слайс AD поймал на снимках монет.
 *
 * Остаток приходит по выбранной полке: кассиру надо видеть, сколько на ней лежит. У
 * услуги остатка нет вовсе, и это не ноль, а «не про неё».
 */
export type TillProduct = OfferedProduct & {
  slug: string;
  stock: number | null;
  category: string;
};

export async function readTillProducts(
  companyId: string,
  warehouseId: string | null,
): Promise<TillProduct[]> {
  const [offers, rates] = await Promise.all([
    prisma.productOffer.findMany({
      where: {
        companyId,
        status: "ACTIVE",
        product: { deletedAt: null, mergedIntoId: null, suspendedAt: null },
      },
      orderBy: { product: { name: "asc" } },
      take: 400,
      select: {
        productId: true,
        price: true,
        currency: true,
        unit: true,
        cashbackPercent: true,
        product: { select: { name: true, slug: true, category: true } },
      },
    }),
    readCompanyRates(companyId),
  ]);
  if (offers.length === 0) return [];

  const balances = warehouseId
    ? await prisma.stockBalance.findMany({
        where: { warehouseId, productId: { in: offers.map((o) => o.productId) } },
        select: { productId: true, qty: true },
      })
    : [];
  const stock = new Map(balances.map((b) => [b.productId, Number(b.qty)]));

  return offers.map((o) => {
    const rate = effectiveCashback({
      offer: o.cashbackPercent === null ? null : Number(o.cashbackPercent),
      category: rates.byCategory[o.product.category] ?? null,
      company: rates.base,
    });
    return {
      productId: o.productId,
      name: o.product.name,
      slug: o.product.slug,
      category: o.product.category,
      unit: o.unit,
      currency: o.currency,
      listPrice: Number(o.price),
      cashbackPercent: rate?.percent ?? null,
      stock: isService(o.unit) ? null : (stock.get(o.productId) ?? 0),
    };
  });
}

/**
 * Остатки по полкам: касса показывает число той полки, которую выбрал кассир. Числа
 * нельзя снять по одной полке заранее — полку выбирают в браузере, а «0 на полке» у
 * товара, который на ней лежит, — это ложь на экране.
 */
export async function readShelfStock(
  companyId: string,
  shelfIds: readonly string[],
): Promise<Record<string, Record<string, number>>> {
  if (shelfIds.length === 0) return {};
  const rows = await prisma.stockBalance.findMany({
    where: { warehouseId: { in: [...shelfIds] }, product: { offers: { some: { companyId, status: "ACTIVE" } } } },
    select: { warehouseId: true, productId: true, qty: true },
  });
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    out[r.warehouseId] ??= {};
    out[r.warehouseId][r.productId] = Number(r.qty);
  }
  return out;
}

export type ReceiptLine = {
  name: string;
  unit: string;
  qty: number;
  listPrice: number;
  price: number;
  cashbackPercent: number | null;
  cashbackAmount: number;
  productSlug: string | null;
};

export type Receipt = {
  id: string;
  number: number;
  createdAt: Date;
  currency: string;
  listTotal: number;
  total: number;
  discount: number;
  cashbackTotal: number;
  payment: "CASH" | "CARD" | "TRANSFER" | "CRYPTO" | "OTHER";
  payCoin: string | null;
  payRate: number | null;
  payCoinAmount: number | null;
  payNote: string | null;
  status: "COMPLETED" | "CANCELLED";
  cancelledAt: Date | null;
  cancelReason: string | null;
  note: string | null;
  warehouseName: string | null;
  pointName: string | null;
  pointId: string | null;
  sellerName: string;
  sellerId: string;
  sellerLogoUrl: string | null;
  cashierName: string | null;
  buyerUserId: string | null;
  buyerClaimedAt: Date | null;
  lines: ReceiptLine[];
};

const RECEIPT_SELECT = {
  id: true,
  number: true,
  createdAt: true,
  currency: true,
  listTotal: true,
  total: true,
  cashbackTotal: true,
  payment: true,
  payCoin: true,
  payRate: true,
  payCoinAmount: true,
  payNote: true,
  status: true,
  cancelledAt: true,
  cancelReason: true,
  note: true,
  buyerUserId: true,
  buyerClaimedAt: true,
  warehouse: { select: { name: true } },
  point: { select: { id: true, name: true } },
  company: { select: { id: true, displayName: true, logoUrl: true } },
  createdBy: { select: { name: true, username: true } },
  lines: {
    select: {
      name: true,
      unit: true,
      qty: true,
      listPrice: true,
      price: true,
      cashbackPercent: true,
      cashbackAmount: true,
      product: { select: { slug: true } },
    },
  },
} as const;

type Row = {
  id: string;
  number: number;
  createdAt: Date;
  currency: string;
  listTotal: unknown;
  total: unknown;
  cashbackTotal: unknown;
  payment: "CASH" | "CARD" | "TRANSFER" | "CRYPTO" | "OTHER";
  payCoin: string | null;
  payRate: unknown;
  payCoinAmount: unknown;
  payNote: string | null;
  status: "COMPLETED" | "CANCELLED";
  cancelledAt: Date | null;
  cancelReason: string | null;
  note: string | null;
  buyerUserId: string | null;
  buyerClaimedAt: Date | null;
  warehouse: { name: string } | null;
  point: { id: string; name: string } | null;
  company: { id: string; displayName: string; logoUrl: string | null };
  createdBy: { name: string | null; username: string | null } | null;
  lines: {
    name: string;
    unit: string;
    qty: unknown;
    listPrice: unknown;
    price: unknown;
    cashbackPercent: unknown;
    cashbackAmount: unknown;
    product: { slug: string } | null;
  }[];
};

function shape(row: Row): Receipt {
  const listTotal = Number(row.listTotal);
  const total = Number(row.total);
  return {
    id: row.id,
    number: row.number,
    createdAt: row.createdAt,
    currency: row.currency,
    listTotal,
    total,
    // Скидка выводится, а не хранится: третье число разошлось бы с первыми двумя.
    discount: Math.round((listTotal - total) * 100) / 100,
    cashbackTotal: Number(row.cashbackTotal),
    payment: row.payment,
    payCoin: row.payCoin,
    payRate: row.payRate === null ? null : Number(row.payRate),
    payCoinAmount: row.payCoinAmount === null ? null : Number(row.payCoinAmount),
    payNote: row.payNote,
    status: row.status,
    cancelledAt: row.cancelledAt,
    cancelReason: row.cancelReason,
    note: row.note,
    warehouseName: row.warehouse?.name ?? null,
    pointName: row.point?.name ?? null,
    pointId: row.point?.id ?? null,
    sellerName: row.company.displayName,
    sellerId: row.company.id,
    sellerLogoUrl: row.company.logoUrl,
    cashierName: row.createdBy?.name ?? row.createdBy?.username ?? null,
    buyerUserId: row.buyerUserId,
    buyerClaimedAt: row.buyerClaimedAt,
    lines: row.lines.map((l) => ({
      name: l.name,
      unit: l.unit,
      qty: Number(l.qty),
      listPrice: Number(l.listPrice),
      price: Number(l.price),
      cashbackPercent: l.cashbackPercent === null ? null : Number(l.cashbackPercent),
      cashbackAmount: Number(l.cashbackAmount),
      productSlug: l.product?.slug ?? null,
    })),
  };
}

export async function readSale(companyId: string, saleId: string): Promise<Receipt | null> {
  const row = await prisma.sale.findFirst({ where: { id: saleId, companyId }, select: RECEIPT_SELECT });
  return row ? shape(row as unknown as Row) : null;
}

/** Чек по ссылке-предъявителю: ищем по sha256, самого токена в базе нет. */
export async function readSaleByTokenHash(hash: string): Promise<Receipt | null> {
  const row = await prisma.sale.findUnique({ where: { receiptTokenHash: hash }, select: RECEIPT_SELECT });
  return row ? shape(row as unknown as Row) : null;
}

/** Свой чек глазами покупателя: право — в самой записи (`buyerUserId`). */
export async function readBuyerSale(userId: string, saleId: string): Promise<Receipt | null> {
  const row = await prisma.sale.findFirst({ where: { id: saleId, buyerUserId: userId }, select: RECEIPT_SELECT });
  return row ? shape(row as unknown as Row) : null;
}

export type SaleRow = {
  id: string;
  number: number;
  createdAt: Date;
  currency: string;
  total: number;
  cashbackTotal: number;
  payment: "CASH" | "CARD" | "TRANSFER" | "CRYPTO" | "OTHER";
  status: "COMPLETED" | "CANCELLED";
  lineCount: number;
  pointName: string | null;
  buyerClaimed: boolean;
  sellerName: string;
  sellerId: string;
};

/** Чеки предприятия. Участок сотрудника сужает список по точке полки (правило BE). */
export async function readSales(
  companyId: string,
  opts: { scope?: readonly string[]; take?: number } = {},
): Promise<SaleRow[]> {
  const scope = opts.scope ?? [];
  const rows = await prisma.sale.findMany({
    where: { companyId, ...(scope.length > 0 ? { pointId: { in: [...scope] } } : {}) },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 50,
    select: {
      id: true,
      number: true,
      createdAt: true,
      currency: true,
      total: true,
      cashbackTotal: true,
      payment: true,
      status: true,
      buyerUserId: true,
      point: { select: { name: true } },
      company: { select: { id: true, displayName: true } },
      _count: { select: { lines: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    createdAt: r.createdAt,
    currency: r.currency,
    total: Number(r.total),
    cashbackTotal: Number(r.cashbackTotal),
    payment: r.payment,
    status: r.status,
    lineCount: r._count.lines,
    pointName: r.point?.name ?? null,
    buyerClaimed: Boolean(r.buyerUserId),
    sellerName: r.company.displayName,
    sellerId: r.company.id,
  }));
}

/** Свои чеки покупателя — те, что он сам привязал, перейдя по ссылке. */
export async function readBuyerReceipts(userId: string, take = 100): Promise<SaleRow[]> {
  const rows = await prisma.sale.findMany({
    where: { buyerUserId: userId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      number: true,
      createdAt: true,
      currency: true,
      total: true,
      cashbackTotal: true,
      payment: true,
      status: true,
      buyerUserId: true,
      point: { select: { name: true } },
      company: { select: { id: true, displayName: true } },
      _count: { select: { lines: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    createdAt: r.createdAt,
    currency: r.currency,
    total: Number(r.total),
    cashbackTotal: Number(r.cashbackTotal),
    payment: r.payment,
    status: r.status,
    lineCount: r._count.lines,
    pointName: r.point?.name ?? null,
    buyerClaimed: true,
    sellerName: r.company.displayName,
    sellerId: r.company.id,
  }));
}

export function countBuyerReceipts(userId: string): Promise<number> {
  return prisma.sale.count({ where: { buyerUserId: userId } });
}
