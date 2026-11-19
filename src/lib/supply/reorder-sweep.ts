/**
 * Прогон автозаказа. Спека
 * `docs/superpowers/specs/2026-11-19-supplier-portal-autoorder-design.md`, раздел 4.
 *
 * Прогон **формирует черновик**, а не отправляет заказ: ТЗ говорит «система формирует
 * заявку», и это ровно то, что мы делаем — отправка остаётся обещанием человека.
 *
 * Раз в сутки, а не в час: порог меряется днями поставки, и частый прогон ничего не
 * ускорит (тот же разбор, что у лестницы жалоб AQ).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logCompanyAction } from "@/lib/company-team/journal";
import { notifySupplyEvent, supplyManagers } from "@/lib/supply/notify";
import { reorderPlan, type ReorderCandidate } from "@/lib/supply/reorder";

export type ReorderSweepStats = {
  rules: number;
  drafts: number;
  lines: number;
  skippedOpenOrder: number;
};

export async function runReorderSweep(): Promise<ReorderSweepStats> {
  const rules = await prisma.reorderRule.findMany({
    select: {
      id: true,
      companyId: true,
      warehouseId: true,
      productId: true,
      supplierId: true,
      minQty: true,
      targetQty: true,
      // Снятое надзором предприятие заказов не формирует: оно и в кабинете только читает.
      company: { select: { suspendedAt: true, deletedAt: true } },
      warehouse: { select: { archivedAt: true } },
      supplier: { select: { archivedAt: true } },
      product: { select: { deletedAt: true } },
    },
  });

  const live = rules.filter(
    (r) =>
      !r.company.suspendedAt &&
      !r.company.deletedAt &&
      !r.warehouse.archivedAt &&
      !r.supplier.archivedAt &&
      !r.product.deletedAt,
  );
  if (live.length === 0) {
    console.log("reorder sweep ok: 0 rules");
    return { rules: 0, drafts: 0, lines: 0, skippedOpenOrder: 0 };
  }

  const warehouseIds = [...new Set(live.map((r) => r.warehouseId))];
  const productIds = [...new Set(live.map((r) => r.productId))];

  const [balances, transit, openLines] = await Promise.all([
    prisma.stockBalance.findMany({
      where: { warehouseId: { in: warehouseIds }, productId: { in: productIds } },
      select: { warehouseId: true, productId: true, qty: true },
    }),
    // Товар у перевозчика уже куплен: без этого прогон каждое утро заказывает то, что едет.
    prisma.stockMovement.findMany({
      where: { status: "IN_TRANSIT", toWarehouseId: { in: warehouseIds }, productId: { in: productIds } },
      select: { toWarehouseId: true, productId: true, qty: true },
    }),
    // Незакрытый заказ по этой паре молчит целиком — иначе за неделю молчания кладовщика
    // в очереди лежало бы семь одинаковых черновиков.
    prisma.supplyOrderLine.findMany({
      where: {
        productId: { in: productIds },
        order: { status: { in: ["DRAFT", "SENT", "CONFIRMED", "SHIPPED"] }, warehouseId: { in: warehouseIds } },
      },
      select: { productId: true, qty: true, receivedQty: true, order: { select: { warehouseId: true } } },
    }),
  ]);

  const key = (w: string, p: string) => `${w}:${p}`;
  const onHand = new Map(balances.map((b) => [key(b.warehouseId, b.productId), Number(b.qty)]));
  const inTransit = new Map<string, number>();
  for (const m of transit) {
    if (!m.toWarehouseId) continue;
    const k = key(m.toWarehouseId, m.productId);
    inTransit.set(k, (inTransit.get(k) ?? 0) + Number(m.qty));
  }
  const ordered = new Map<string, number>();
  const openPairs = new Set<string>();
  for (const l of openLines) {
    if (!l.order.warehouseId) continue;
    const k = key(l.order.warehouseId, l.productId);
    openPairs.add(k);
    ordered.set(k, (ordered.get(k) ?? 0) + Math.max(0, Number(l.qty) - Number(l.receivedQty)));
  }

  const candidates: ReorderCandidate[] = live.map((r) => {
    const k = key(r.warehouseId, r.productId);
    return {
      ruleId: r.id,
      companyId: r.companyId,
      warehouseId: r.warehouseId,
      productId: r.productId,
      supplierId: r.supplierId,
      minQty: Number(r.minQty),
      targetQty: Number(r.targetQty),
      onHand: onHand.get(k) ?? 0,
      inTransit: inTransit.get(k) ?? 0,
      onOrder: ordered.get(k) ?? 0,
      hasOpenOrder: openPairs.has(k),
    };
  });

  const plans = reorderPlan(candidates);
  let lines = 0;

  for (const plan of plans) {
    try {
      const order = await prisma.supplyOrder.create({
        data: {
          companyId: plan.companyId,
          supplierId: plan.supplierId,
          warehouseId: plan.warehouseId,
          status: "DRAFT",
          autoDrafted: true,
          lines: {
            create: plan.lines.map((l) => ({ productId: l.productId, qty: new Prisma.Decimal(l.qty) })),
          },
        },
        select: { id: true, supplier: { select: { name: true } }, company: { select: { displayName: true } } },
      });
      lines += plan.lines.length;
      await logCompanyAction({
        companyId: plan.companyId,
        // Автор — прогон, а не человек: `null` в журнале читается как «система».
        actorUserId: null,
        action: "ORDER_CREATED",
        subject: order.supplier.name,
        // `by: "system"` — потому что пустой автор в журнале означает «участника
        // удалили» (связь `SET NULL`), а здесь автора не было вовсе: это прогон.
        meta: { autoDrafted: true, lines: plan.lines.length, by: "system" },
      });
      await notifySupplyEvent({
        kind: "autodraft",
        userIds: await supplyManagers(plan.companyId),
        companyId: plan.companyId,
        companyName: order.company.displayName,
        orderId: order.id,
      });
    } catch (error) {
      // Сбой по одному предприятию не должен ронять прогон остальных.
      console.error("reorder_draft_failed", plan.companyId, plan.supplierId, error);
    }
  }

  const stats: ReorderSweepStats = {
    rules: live.length,
    drafts: plans.length,
    lines,
    skippedOpenOrder: candidates.filter((c) => c.hasOpenOrder).length,
  };
  console.log(`reorder sweep ok: ${JSON.stringify(stats)}`);
  return stats;
}
