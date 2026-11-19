/**
 * Чтение поставок. Спека
 * `docs/superpowers/specs/2026-11-19-supplier-portal-autoorder-design.md`.
 *
 * Два разных списка заказов и это не симметрия ради симметрии: покупатель видит свои
 * заказы целиком, включая черновики, а поставщик — только то, что ему **отправили**.
 * Черновик это ещё не обещание, и показывать его адресату нельзя.
 */
import { prisma } from "@/lib/prisma";
import { parseDocs, type SupplyDoc } from "@/lib/supply/docs";
import { isOrderOpen, type OrderStatus } from "@/lib/supply/rules";

export type SupplierRow = {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  note: string | null;
  archivedAt: Date | null;
  /** Поставщик на платформе — у него есть портал; иначе заказ остаётся нашим документом. */
  portalCompanyId: string | null;
  portalCompanyName: string | null;
  openOrders: number;
};

export async function readSuppliers(companyId: string): Promise<SupplierRow[]> {
  const rows = await prisma.supplier.findMany({
    where: { companyId },
    orderBy: [{ archivedAt: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      contactName: true,
      email: true,
      phone: true,
      note: true,
      archivedAt: true,
      supplierCompanyId: true,
      supplierCompany: { select: { displayName: true } },
      orders: { select: { status: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    contactName: r.contactName,
    email: r.email,
    phone: r.phone,
    note: r.note,
    archivedAt: r.archivedAt,
    portalCompanyId: r.supplierCompanyId,
    portalCompanyName: r.supplierCompany?.displayName ?? null,
    openOrders: r.orders.filter((o) => isOrderOpen(o.status as OrderStatus)).length,
  }));
}

export type OrderRow = {
  id: string;
  status: OrderStatus;
  supplierName: string;
  buyerName: string;
  warehouseName: string | null;
  lineCount: number;
  expectedAt: Date | null;
  confirmedEta: Date | null;
  autoDrafted: boolean;
  createdAt: Date;
};

const ORDER_LIST_SELECT = {
  id: true,
  status: true,
  expectedAt: true,
  confirmedEta: true,
  autoDrafted: true,
  createdAt: true,
  supplier: { select: { name: true } },
  company: { select: { displayName: true } },
  warehouse: { select: { name: true } },
  _count: { select: { lines: true } },
} as const;

type ListShape = {
  id: string;
  status: string;
  expectedAt: Date | null;
  confirmedEta: Date | null;
  autoDrafted: boolean;
  createdAt: Date;
  supplier: { name: string };
  company: { displayName: string };
  warehouse: { name: string } | null;
  _count: { lines: number };
};

function toRow(r: ListShape): OrderRow {
  return {
    id: r.id,
    status: r.status as OrderStatus,
    supplierName: r.supplier.name,
    buyerName: r.company.displayName,
    warehouseName: r.warehouse?.name ?? null,
    lineCount: r._count.lines,
    expectedAt: r.expectedAt,
    confirmedEta: r.confirmedEta,
    autoDrafted: r.autoDrafted,
    createdAt: r.createdAt,
  };
}

/** Заказы покупателя. Участок сужает по складу: склада вне участка человек не видит. */
export async function readOrders(
  companyId: string,
  opts: { scope?: readonly string[]; take?: number } = {},
): Promise<OrderRow[]> {
  const scope = opts.scope ?? [];
  const rows = await prisma.supplyOrder.findMany({
    where: {
      companyId,
      // Склад без точки принадлежит предприятию целиком и в участок не попадает — то же
      // правило, что у складов BC. Заказ без склада видят все: адресата сужать нечем.
      ...(scope.length > 0 ? { OR: [{ warehouseId: null }, { warehouse: { pointId: { in: [...scope] } } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 100,
    select: ORDER_LIST_SELECT,
  });
  return rows.map(toRow);
}

/**
 * «Заказы нам» — портал поставщика. Черновиков тут нет по построению: черновик живёт у
 * покупателя и адресату не виден.
 */
export async function readIncomingOrders(companyId: string, take = 100): Promise<OrderRow[]> {
  const rows = await prisma.supplyOrder.findMany({
    where: { supplier: { supplierCompanyId: companyId }, status: { not: "DRAFT" } },
    orderBy: { createdAt: "desc" },
    take,
    select: ORDER_LIST_SELECT,
  });
  return rows.map(toRow);
}

export type OrderLineView = {
  id: string;
  productId: string;
  productName: string;
  productSlug: string;
  qty: number;
  receivedQty: number;
  price: number | null;
  unit: string;
  note: string | null;
};

export type OrderView = {
  id: string;
  status: OrderStatus;
  currency: string;
  buyerCompanyId: string;
  buyerName: string;
  supplierId: string;
  supplierName: string;
  /** Предприятие-поставщик, если поставщик на платформе: только у него есть портал. */
  supplierCompanyId: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
  warehousePointId: string | null;
  expectedAt: Date | null;
  confirmedEta: Date | null;
  note: string | null;
  declineReason: string | null;
  cancelReason: string | null;
  autoDrafted: boolean;
  docs: SupplyDoc[];
  sentAt: Date | null;
  confirmedAt: Date | null;
  shippedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  lines: OrderLineView[];
};

/** Заказ целиком. Сторону вызывающий решает сам: документ один, кнопки у сторон разные. */
export async function readOrder(orderId: string): Promise<OrderView | null> {
  const row = await prisma.supplyOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      currency: true,
      companyId: true,
      company: { select: { displayName: true } },
      supplierId: true,
      supplier: { select: { name: true, supplierCompanyId: true } },
      warehouseId: true,
      warehouse: { select: { name: true, pointId: true } },
      expectedAt: true,
      confirmedEta: true,
      note: true,
      declineReason: true,
      cancelReason: true,
      autoDrafted: true,
      docs: true,
      sentAt: true,
      confirmedAt: true,
      shippedAt: true,
      closedAt: true,
      createdAt: true,
      lines: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          productId: true,
          qty: true,
          receivedQty: true,
          price: true,
          unit: true,
          note: true,
          product: { select: { name: true, slug: true } },
        },
      },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    status: row.status as OrderStatus,
    currency: row.currency,
    buyerCompanyId: row.companyId,
    buyerName: row.company.displayName,
    supplierId: row.supplierId,
    supplierName: row.supplier.name,
    supplierCompanyId: row.supplier.supplierCompanyId,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouse?.name ?? null,
    warehousePointId: row.warehouse?.pointId ?? null,
    expectedAt: row.expectedAt,
    confirmedEta: row.confirmedEta,
    note: row.note,
    declineReason: row.declineReason,
    cancelReason: row.cancelReason,
    autoDrafted: row.autoDrafted,
    docs: parseDocs(row.docs),
    sentAt: row.sentAt,
    confirmedAt: row.confirmedAt,
    shippedAt: row.shippedAt,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    lines: row.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      productName: l.product.name,
      productSlug: l.product.slug,
      qty: Number(l.qty),
      receivedQty: Number(l.receivedQty),
      price: l.price === null ? null : Number(l.price),
      unit: l.unit,
      note: l.note,
    })),
  };
}

export type ReorderRuleRow = {
  id: string;
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productName: string;
  supplierId: string;
  supplierName: string;
  minQty: number;
  targetQty: number;
  onHand: number;
};

/** Правила автозаказа с текущим остатком рядом: порог без остатка не читается. */
export async function readReorderRules(
  companyId: string,
  scope: readonly string[] = [],
): Promise<ReorderRuleRow[]> {
  const rows = await prisma.reorderRule.findMany({
    where: {
      companyId,
      ...(scope.length > 0 ? { warehouse: { pointId: { in: [...scope] } } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      warehouseId: true,
      productId: true,
      supplierId: true,
      minQty: true,
      targetQty: true,
      warehouse: { select: { name: true } },
      product: { select: { name: true } },
      supplier: { select: { name: true } },
    },
  });
  if (rows.length === 0) return [];
  const balances = await prisma.stockBalance.findMany({
    where: {
      warehouseId: { in: rows.map((r) => r.warehouseId) },
      productId: { in: rows.map((r) => r.productId) },
    },
    select: { warehouseId: true, productId: true, qty: true },
  });
  const have = new Map(balances.map((b) => [`${b.warehouseId}:${b.productId}`, Number(b.qty)]));
  return rows.map((r) => ({
    id: r.id,
    warehouseId: r.warehouseId,
    warehouseName: r.warehouse.name,
    productId: r.productId,
    productName: r.product.name,
    supplierId: r.supplierId,
    supplierName: r.supplier.name,
    minQty: Number(r.minQty),
    targetQty: Number(r.targetQty),
    onHand: have.get(`${r.warehouseId}:${r.productId}`) ?? 0,
  }));
}

/** Предприятия, которых можно назвать поставщиком-порталом: залистованные и живые. */
export async function readPortalCandidates(ownCompanyId: string, take = 50) {
  return prisma.company.findMany({
    where: {
      id: { not: ownCompanyId },
      status: "APPROVED",
      suspendedAt: null,
      deletedAt: null,
    },
    orderBy: { displayName: "asc" },
    take,
    select: { id: true, displayName: true },
  });
}
