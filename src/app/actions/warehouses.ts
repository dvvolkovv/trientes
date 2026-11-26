"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canWrite, editorCompany, type CompanyGate } from "@/lib/products/editor-company";
import { movementScopeAllows, pointScopeAllows } from "@/lib/company-team/permissions";
import { logCompanyAction } from "@/lib/company-team/journal";
import { NegativeBalance, applyDeltas, type AppliedDelta } from "@/lib/warehouse/apply";
import { emitStockCrossings } from "@/lib/automation/stock-emit";
import {
  DAILY_MOVEMENTS,
  canArchiveWarehouse,
  cancelPlan,
  checkStock,
  isMoveKind,
  isWarehouseKind,
  movementPlan,
  receivePlan,
  validateMovement,
  validateWarehouse,
  type MoveKind,
} from "@/lib/warehouse/rules";

type Fail = { ok: false; reason: string };
const fail = (reason: string): Fail => ({ ok: false, reason });

async function requireUser() {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

/**
 * Участок сотрудника: склады, которых он не видит, он и не трогает. Склад без точки
 * (оптовый, сторонний) принадлежит предприятию целиком и в участок не попадает.
 */
async function scopedWarehouses(
  gate: CompanyGate,
  warehouseIds: readonly string[],
): Promise<boolean> {
  if (gate.pointScope.length === 0) return true;
  const ids = warehouseIds.filter(Boolean);
  if (ids.length === 0) return true;
  const rows = await prisma.warehouse.findMany({
    where: { id: { in: [...ids] }, companyId: gate.id },
    select: { id: true, pointId: true },
  });
  if (rows.length !== new Set(ids).size) return false;
  return rows.every((row) => pointScopeAllows(gate.pointScope, row.pointId));
}

export type WarehouseFormInput = {
  kind: string;
  name: string;
  pointId: string | null;
  online: boolean;
  countryCode: string | null;
  address: string | null;
  note: string | null;
};

export async function createWarehouse(companyId: string, input: WarehouseFormInput) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const company = await editorCompany(companyId, userId);
  if (!canWrite(company, "warehouses")) return fail("forbidden");
  if (!isWarehouseKind(input.kind)) return fail("kind_invalid");
  // Сотрудник участка заводит склад только на своей точке.
  if (!pointScopeAllows(company!.pointScope, input.pointId)) return fail("point_forbidden");

  const [count, points] = await Promise.all([
    prisma.warehouse.count({ where: { companyId, archivedAt: null } }),
    prisma.companyPoint.findMany({
      where: { companyId, status: "APPROVED", deletedAt: null, suspendedAt: null },
      select: { id: true },
    }),
  ]);

  // «Онлайн» — свойство полки: у оптового и стороннего склада его быть не может.
  const online = input.kind === "SHELF" ? input.online : false;

  const v = validateWarehouse(
    {
      kind: input.kind,
      name: input.name,
      pointId: input.pointId,
      online,
      countryCode: input.countryCode,
      address: input.address,
    },
    { count, pointIds: points.map((p) => p.id) },
  );
  if (!v.ok) return fail(v.reason);

  const warehouse = await prisma.warehouse.create({
    data: {
      companyId,
      kind: input.kind,
      name: input.name.trim(),
      pointId: input.pointId,
      online,
      countryCode: input.countryCode?.trim() || null,
      address: input.address?.trim() || null,
      note: input.note?.trim() || null,
    },
    select: { id: true },
  });
  await logCompanyAction({ companyId, actorUserId: userId, action: "WAREHOUSE_CREATED", subject: input.name.trim(), meta: { kind: input.kind } });
  revalidatePath(`/[locale]/cabinet/companies/${companyId}/warehouses`, "page");
  return { ok: true as const, id: warehouse.id };
}

export async function renameWarehouse(companyId: string, warehouseId: string, name: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const gate = await editorCompany(companyId, userId);
  if (!canWrite(gate, "warehouses")) return fail("forbidden");
  if (!(await scopedWarehouses(gate!, [warehouseId]))) return fail("forbidden");
  if (!name.trim()) return fail("name_required");
  const updated = await prisma.warehouse.updateMany({
    where: { id: warehouseId, companyId },
    data: { name: name.trim() },
  });
  if (updated.count === 0) return fail("not_found");
  await logCompanyAction({ companyId, actorUserId: userId, action: "WAREHOUSE_RENAMED", subject: name.trim() });
  revalidatePath(`/[locale]/cabinet/companies/${companyId}/warehouses`, "page");
  return { ok: true as const };
}

/**
 * Склад архивируется, а не удаляется: движения по нему записаны, и снос стёр бы историю.
 * С остатком — отказ: иначе товар исчезает молча вместе с местом, где он лежал.
 */
export async function archiveWarehouse(companyId: string, warehouseId: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const gate = await editorCompany(companyId, userId);
  if (!canWrite(gate, "warehouses")) return fail("forbidden");
  if (!(await scopedWarehouses(gate!, [warehouseId]))) return fail("forbidden");

  const warehouse = await prisma.warehouse.findFirst({
    where: { id: warehouseId, companyId },
    select: { id: true, name: true, archivedAt: true, balances: { select: { qty: true } } },
  });
  if (!warehouse) return fail("not_found");
  if (warehouse.archivedAt) return fail("already_archived");

  const total = warehouse.balances.reduce((sum, b) => sum + Number(b.qty), 0);
  const can = canArchiveWarehouse(total);
  if (!can.ok) return fail(can.reason);

  // В пути тоже нельзя оставлять: товар вернётся на архивный склад и повиснет.
  const transit = await prisma.stockMovement.count({
    where: { companyId, status: "IN_TRANSIT", OR: [{ fromWarehouseId: warehouseId }, { toWarehouseId: warehouseId }] },
  });
  if (transit > 0) return fail("transit_pending");

  await prisma.warehouse.update({ where: { id: warehouseId }, data: { archivedAt: new Date() } });
  await logCompanyAction({ companyId, actorUserId: userId, action: "WAREHOUSE_ARCHIVED", subject: warehouse.name });
  revalidatePath(`/[locale]/cabinet/companies/${companyId}/warehouses`, "page");
  return { ok: true as const };
}

export async function restoreWarehouse(companyId: string, warehouseId: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const gate = await editorCompany(companyId, userId);
  if (!canWrite(gate, "warehouses")) return fail("forbidden");
  if (!(await scopedWarehouses(gate!, [warehouseId]))) return fail("forbidden");
  const updated = await prisma.warehouse.updateMany({
    where: { id: warehouseId, companyId, archivedAt: { not: null } },
    data: { archivedAt: null },
  });
  if (updated.count === 0) return fail("not_found");
  await logCompanyAction({ companyId, actorUserId: userId, action: "WAREHOUSE_RESTORED", subject: warehouseId });
  revalidatePath(`/[locale]/cabinet/companies/${companyId}/warehouses`, "page");
  return { ok: true as const };
}

export type MovementFormInput = {
  kind: string;
  productId: string;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  qty: string;
  carrierName: string | null;
  trackingCode: string | null;
  expectedAt: string | null;
  note: string | null;
};

function parseQty(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (!/^-?\d+(\.\d{1,3})?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * Запись движения и остатков — одной транзакцией: движение без остатка оставило бы
 * склад врать, остаток без движения — необъяснимым. Само применение живёт в
 * `src/lib/warehouse/apply.ts`: ту же запись делает приёмка заказа поставщику (BI), и у
 * остатка должен быть один автор.
 */
export async function recordMovement(companyId: string, input: MovementFormInput) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const gate = await editorCompany(companyId, userId);
  if (!canWrite(gate, "warehouses")) return fail("forbidden");
  if (!isMoveKind(input.kind)) return fail("kind_invalid");

  const qty = parseQty(input.qty);
  if (qty === null) return fail("qty_invalid");

  const v = validateMovement({
    kind: input.kind,
    fromWarehouseId: input.fromWarehouseId,
    toWarehouseId: input.toWarehouseId,
    qty,
    note: input.note,
    carrierName: input.carrierName,
  });
  if (!v.ok) return fail(v.reason);

  // Склады — только свои и не архивные: архивный склад новых движений не принимает.
  const ids = [input.fromWarehouseId, input.toWarehouseId].filter((x): x is string => Boolean(x));
  const [warehouses, product, movesToday] = await Promise.all([
    prisma.warehouse.findMany({ where: { id: { in: ids }, companyId, archivedAt: null }, select: { id: true, pointId: true } }),
    prisma.product.findFirst({ where: { id: input.productId, deletedAt: null }, select: { id: true, slug: true } }),
    prisma.stockMovement.count({ where: { companyId, createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
  ]);
  if (warehouses.length !== new Set(ids).size) return fail("warehouse_unknown");
  // Оба конца — в участке: иначе сотрудник вывозил бы товар на склад, которого не видит.
  const pointOf = (id: string | null) => (id ? (warehouses.find((w) => w.id === id)?.pointId ?? null) : undefined);
  if (
    !movementScopeAllows(gate!.pointScope, {
      ...(input.fromWarehouseId ? { fromPointId: pointOf(input.fromWarehouseId) } : {}),
      ...(input.toWarehouseId ? { toPointId: pointOf(input.toWarehouseId) } : {}),
    })
  ) {
    return fail("forbidden");
  }
  if (!product) return fail("product_not_found");
  if (movesToday >= DAILY_MOVEMENTS) return fail("daily_limit");

  const plan = movementPlan({
    kind: input.kind,
    fromWarehouseId: input.fromWarehouseId,
    toWarehouseId: input.toWarehouseId,
    qty,
    note: input.note,
    carrierName: input.carrierName,
  });

  const expectedAt = input.expectedAt ? new Date(input.expectedAt) : null;
  if (expectedAt && Number.isNaN(expectedAt.getTime())) return fail("date_invalid");

  // Ранняя проверка остатка — чтобы отказать словами, не записав ничего. Решающей она
  // быть не может: под двумя одновременными расходами «до» пропускает оба, и настоящим
  // охранником остаётся проверка получившегося числа внутри транзакции.
  const current = await prisma.stockBalance.findMany({
    where: { productId: product.id, warehouseId: { in: plan.deltas.map((d) => d.warehouseId) } },
    select: { warehouseId: true, qty: true },
  });
  const have = Object.fromEntries(current.map((b) => [b.warehouseId, Number(b.qty)]));
  const enough = checkStock(plan.deltas, have, input.kind as MoveKind);
  if (!enough.ok) return fail(enough.reason);

  const applied: AppliedDelta[] = [];
  try {
    const movement = await prisma.$transaction(async (tx) => {
      const created = await tx.stockMovement.create({
        data: {
          companyId,
          productId: product.id,
          kind: input.kind as MoveKind,
          status: plan.status,
          fromWarehouseId: input.fromWarehouseId,
          toWarehouseId: input.toWarehouseId,
          qty: new Prisma.Decimal(qty),
          carrierName: input.carrierName?.trim() || null,
          trackingCode: input.trackingCode?.trim() || null,
          shippedAt: plan.status === "IN_TRANSIT" ? new Date() : null,
          expectedAt,
          arrivedAt: plan.status === "DONE" && input.kind === "TRANSFER" ? new Date() : null,
          note: input.note?.trim() || null,
          createdById: userId,
        },
        select: { id: true },
      });
      applied.push(...(await applyDeltas(tx, product.id, plan.deltas, input.kind as MoveKind)));
      return created;
    });
    await logCompanyAction({
      companyId,
      actorUserId: userId,
      action: "MOVEMENT_RECORDED",
      subject: product.slug,
      meta: { kind: input.kind, qty, status: plan.status },
    });
    // Пересечение порога остатка (CO) — после коммита: откатившийся расход факта не
    // оставляет.
    await emitStockCrossings({ companyId, actorUserId: userId, applied });
    revalidatePath(`/[locale]/cabinet/companies/${companyId}/warehouses`, "page");
    revalidatePath(`/[locale]/product/${product.slug}`, "page");
    return { ok: true as const, id: movement.id, status: plan.status };
  } catch (err) {
    if (err instanceof NegativeBalance) return fail("insufficient_stock");
    throw err;
  }
}

/** Приём доехавшего: только теперь товар ложится на полку получателя. */
export async function receiveMovement(companyId: string, movementId: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const gate = await editorCompany(companyId, userId);
  if (!canWrite(gate, "warehouses")) return fail("forbidden");

  const movement = await prisma.stockMovement.findFirst({
    where: { id: movementId, companyId },
    select: { id: true, status: true, qty: true, productId: true, fromWarehouseId: true, toWarehouseId: true },
  });
  if (!movement) return fail("not_found");
  if (!(await scopedWarehouses(gate!, [movement.fromWarehouseId, movement.toWarehouseId].filter((x): x is string => Boolean(x))))) {
    return fail("forbidden");
  }

  const plan = receivePlan({
    status: movement.status,
    fromWarehouseId: movement.fromWarehouseId,
    toWarehouseId: movement.toWarehouseId,
    qty: Number(movement.qty),
  });
  if (!plan.ok) return fail(plan.reason);

  const applied = await prisma.$transaction(async (tx) => {
    // Условие по прежнему состоянию: два одновременных приёма не зачислят товар дважды.
    const claimed = await tx.stockMovement.updateMany({
      where: { id: movement.id, status: "IN_TRANSIT" },
      data: { status: "DONE", arrivedAt: new Date() },
    });
    if (claimed.count === 0) return false;
    await applyDeltas(tx, movement.productId, plan.deltas, "TRANSFER");
    return true;
  });
  if (!applied) return fail("not_in_transit");

  await logCompanyAction({ companyId, actorUserId: userId, action: "MOVEMENT_RECEIVED", subject: movementId });
  revalidatePath(`/[locale]/cabinet/companies/${companyId}/warehouses`, "page");
  return { ok: true as const };
}

/** Отмена транзита — встречное движение: журнал неизменяем, запись получает пару. */
export async function cancelMovement(companyId: string, movementId: string, reason: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const gate = await editorCompany(companyId, userId);
  if (!canWrite(gate, "warehouses")) return fail("forbidden");

  const movement = await prisma.stockMovement.findFirst({
    where: { id: movementId, companyId },
    select: { id: true, status: true, qty: true, productId: true, fromWarehouseId: true, toWarehouseId: true, kind: true },
  });
  if (!movement) return fail("not_found");
  if (!(await scopedWarehouses(gate!, [movement.fromWarehouseId, movement.toWarehouseId].filter((x): x is string => Boolean(x))))) {
    return fail("forbidden");
  }
  const note = (reason ?? "").trim();
  if (note.length < 3) return fail("reason_required");

  const plan = cancelPlan({
    status: movement.status,
    fromWarehouseId: movement.fromWarehouseId,
    toWarehouseId: movement.toWarehouseId,
    qty: Number(movement.qty),
  });
  if (!plan.ok) return fail(plan.reason);

  const applied = await prisma.$transaction(async (tx) => {
    const claimed = await tx.stockMovement.updateMany({
      where: { id: movement.id, status: "IN_TRANSIT" },
      data: { status: "CANCELLED" },
    });
    if (claimed.count === 0) return false;
    await tx.stockMovement.create({
      data: {
        companyId,
        productId: movement.productId,
        kind: "RECEIPT",
        status: "DONE",
        toWarehouseId: movement.fromWarehouseId,
        qty: new Prisma.Decimal(Number(movement.qty)),
        note,
        reverseOfId: movement.id,
        createdById: userId,
      },
    });
    await applyDeltas(tx, movement.productId, plan.deltas, "RECEIPT");
    return true;
  });
  if (!applied) return fail("not_cancellable");

  await logCompanyAction({ companyId, actorUserId: userId, action: "MOVEMENT_CANCELLED", subject: movementId, meta: { reason: note } });
  revalidatePath(`/[locale]/cabinet/companies/${companyId}/warehouses`, "page");
  return { ok: true as const };
}
