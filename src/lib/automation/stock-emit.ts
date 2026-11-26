/**
 * События остатка (слайс CO): «кончается» и «кончился». Зовётся **после коммита**
 * движения — откатившийся расход факта не оставляет.
 *
 * Числа «до» и «после» приходят от `applyDeltas` (он единственный автор остатка), порог
 * — из правила автозаказа BI. Второго места для порога не заводим: правила нет — порог
 * ноль, и тогда работает только «кончился».
 */
import { prisma } from "@/lib/prisma";
import { emitCompanyEvent } from "@/lib/automation/emit";
import { crossedThresholds, type StockChange } from "@/lib/automation/stock-events";
import type { AppliedDelta } from "@/lib/warehouse/apply";

export async function emitStockCrossings(input: {
  companyId: string;
  actorUserId: string | null;
  applied: readonly AppliedDelta[];
}): Promise<void> {
  try {
    const spent = input.applied.filter((a) => a.delta < 0);
    if (spent.length === 0) return;

    const warehouseIds = [...new Set(spent.map((a) => a.warehouseId))];
    const productIds = [...new Set(spent.map((a) => a.productId))];
    const [rules, warehouses, products] = await Promise.all([
      prisma.reorderRule.findMany({
        where: { companyId: input.companyId, warehouseId: { in: warehouseIds }, productId: { in: productIds } },
        select: { warehouseId: true, productId: true, minQty: true },
      }),
      prisma.warehouse.findMany({
        where: { id: { in: warehouseIds } },
        select: { id: true, name: true, pointId: true, point: { select: { name: true } } },
      }),
      prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, slug: true } }),
    ]);

    const minQty = new Map(rules.map((r) => [`${r.warehouseId}:${r.productId}`, Number(r.minQty)]));
    const byWarehouse = new Map(warehouses.map((w) => [w.id, w]));
    const byProduct = new Map(products.map((p) => [p.id, p]));

    const changes: StockChange[] = spent.map((a) => ({
      warehouseId: a.warehouseId,
      productId: a.productId,
      before: a.after - a.delta,
      after: a.after,
      minQty: minQty.get(`${a.warehouseId}:${a.productId}`) ?? 0,
    }));

    for (const crossing of crossedThresholds(changes)) {
      const warehouse = byWarehouse.get(crossing.warehouseId);
      const product = byProduct.get(crossing.productId);
      await emitCompanyEvent({
        companyId: input.companyId,
        kind: crossing.kind,
        subject: product?.name ?? null,
        actorUserId: input.actorUserId,
        data: {
          productId: crossing.productId,
          productName: product?.name ?? null,
          productSlug: product?.slug ?? null,
          warehouseId: crossing.warehouseId,
          warehouseName: warehouse?.name ?? null,
          pointId: warehouse?.pointId ?? null,
          pointName: warehouse?.point?.name ?? null,
          onHand: crossing.onHand,
          minQty: crossing.minQty,
        },
      });
    }
  } catch (error) {
    // Сбой автоматизации работу не роняет: движение остатка дороже события о нём.
    console.error("automation_stock_emit_failed", input.companyId, error);
  }
}
