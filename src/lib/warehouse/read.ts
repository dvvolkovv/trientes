/**
 * Чтение складов, остатков и движений для кабинета предприятия. Числа здесь — для
 * продавца: он видит остаток числом, покупатель — только наличие (спека, раздел 4.1).
 */
import { prisma } from "@/lib/prisma";
import { firstPhotoUrl } from "@/lib/products/read";
import { transitTotals } from "@/lib/warehouse/rules";

export type WarehouseRow = {
  id: string;
  kind: "WHOLESALE" | "SHELF" | "THIRD_PARTY";
  name: string;
  pointId: string | null;
  pointName: string | null;
  online: boolean;
  countryCode: string | null;
  address: string | null;
  archivedAt: Date | null;
  positions: number;
  totalQty: number;
};

export async function readWarehouses(companyId: string): Promise<WarehouseRow[]> {
  const rows = await prisma.warehouse.findMany({
    where: { companyId },
    orderBy: [{ archivedAt: "asc" }, { kind: "asc" }, { name: "asc" }],
    select: {
      id: true,
      kind: true,
      name: true,
      pointId: true,
      online: true,
      countryCode: true,
      address: true,
      archivedAt: true,
      point: { select: { name: true } },
      balances: { select: { qty: true } },
    },
  });
  return rows.map((w) => {
    const quantities = w.balances.map((b) => Number(b.qty));
    return {
      id: w.id,
      kind: w.kind,
      name: w.name,
      pointId: w.pointId,
      pointName: w.point?.name ?? null,
      online: w.online,
      countryCode: w.countryCode,
      address: w.address,
      archivedAt: w.archivedAt,
      // Позицией считается строка с ненулевым остатком: обнулённая строка остаётся в базе
      // (её историю видно), но складом не числится.
      positions: quantities.filter((q) => q !== 0).length,
      totalQty: quantities.reduce((a, b) => a + b, 0),
    };
  });
}

export async function readWarehouse(companyId: string, id: string) {
  return prisma.warehouse.findFirst({
    where: { id, companyId },
    select: {
      id: true,
      kind: true,
      name: true,
      pointId: true,
      online: true,
      countryCode: true,
      address: true,
      note: true,
      archivedAt: true,
      point: { select: { id: true, name: true, city: true } },
    },
  });
}

export type StockRow = {
  productId: string;
  slug: string;
  name: string;
  brand: string | null;
  photoUrl: string | null;
  qty: number;
};

export async function readWarehouseStock(warehouseId: string): Promise<StockRow[]> {
  const rows = await prisma.stockBalance.findMany({
    where: { warehouseId },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      productId: true,
      qty: true,
      product: { select: { slug: true, name: true, brand: true, photos: true } },
    },
  });
  return rows.map((r) => ({
    productId: r.productId,
    slug: r.product.slug,
    name: r.product.name,
    brand: r.product.brand,
    photoUrl: firstPhotoUrl(r.product.photos),
    qty: Number(r.qty),
  }));
}

/** Остаток одного товара по складам предприятия — строка под формой паспорта в кабинете. */
export async function readStockByProduct(companyId: string, productId: string) {
  const rows = await prisma.stockBalance.findMany({
    where: { productId, warehouse: { companyId } },
    select: {
      qty: true,
      warehouse: { select: { id: true, name: true, kind: true, archivedAt: true } },
    },
  });
  const transit = await prisma.stockMovement.findMany({
    where: { companyId, productId, status: "IN_TRANSIT" },
    select: { status: true, qty: true, productId: true },
  });
  return {
    byWarehouse: rows
      .map((r) => ({
        warehouseId: r.warehouse.id,
        name: r.warehouse.name,
        kind: r.warehouse.kind,
        archived: Boolean(r.warehouse.archivedAt),
        qty: Number(r.qty),
      }))
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name)),
    // «В пути» — своё число, а не остаток склада-получателя.
    inTransit: transitTotals(transit.map((t) => ({ ...t, qty: Number(t.qty) })))[productId] ?? 0,
  };
}

export type MovementRow = {
  id: string;
  kind: "RECEIPT" | "ISSUE" | "TRANSFER" | "ADJUST";
  status: "IN_TRANSIT" | "DONE" | "CANCELLED";
  qty: number;
  productId: string;
  productName: string;
  productSlug: string;
  fromName: string | null;
  toName: string | null;
  carrierName: string | null;
  trackingCode: string | null;
  expectedAt: Date | null;
  arrivedAt: Date | null;
  note: string | null;
  authorName: string | null;
  createdAt: Date;
};

export async function readMovements(
  companyId: string,
  opts: { warehouseId?: string; status?: "IN_TRANSIT"; take?: number } = {},
): Promise<MovementRow[]> {
  const rows = await prisma.stockMovement.findMany({
    where: {
      companyId,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.warehouseId
        ? { OR: [{ fromWarehouseId: opts.warehouseId }, { toWarehouseId: opts.warehouseId }] }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 50,
    select: {
      id: true,
      kind: true,
      status: true,
      qty: true,
      productId: true,
      carrierName: true,
      trackingCode: true,
      expectedAt: true,
      arrivedAt: true,
      note: true,
      createdAt: true,
      product: { select: { name: true, slug: true } },
      fromWarehouse: { select: { name: true } },
      toWarehouse: { select: { name: true } },
      createdBy: { select: { username: true, name: true } },
    },
  });
  return rows.map((m) => ({
    id: m.id,
    kind: m.kind,
    status: m.status,
    qty: Number(m.qty),
    productId: m.productId,
    productName: m.product.name,
    productSlug: m.product.slug,
    fromName: m.fromWarehouse?.name ?? null,
    toName: m.toWarehouse?.name ?? null,
    carrierName: m.carrierName,
    trackingCode: m.trackingCode,
    expectedAt: m.expectedAt,
    arrivedAt: m.arrivedAt,
    note: m.note,
    authorName: m.createdBy?.name ?? m.createdBy?.username ?? null,
    createdAt: m.createdAt,
  }));
}

/** Товары, которые предприятие уже трогало движениями или предложением: выбор в форме. */
export async function readMovableProducts(companyId: string, take = 200) {
  const [offers, balances] = await Promise.all([
    prisma.productOffer.findMany({
      where: { companyId, product: { deletedAt: null } },
      select: { productId: true, product: { select: { name: true, slug: true } } },
      take,
    }),
    prisma.stockBalance.findMany({
      where: { warehouse: { companyId }, product: { deletedAt: null } },
      select: { productId: true, product: { select: { name: true, slug: true } } },
      take,
    }),
  ]);
  const map = new Map<string, { id: string; name: string; slug: string }>();
  for (const row of [...offers, ...balances]) {
    map.set(row.productId, { id: row.productId, name: row.product.name, slug: row.product.slug });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Свои одобренные живые точки — места, на которых может стоять полка. */
export async function readShelfPoints(companyId: string) {
  return prisma.companyPoint.findMany({
    where: { companyId, status: "APPROVED", deletedAt: null, suspendedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, city: true },
  });
}
