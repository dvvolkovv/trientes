"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { editorCompany, type CompanyGate } from "@/lib/products/editor-company";
import { can, pointScopeAllows } from "@/lib/company-team/permissions";
import { logCompanyAction } from "@/lib/company-team/journal";
import { emitCompanyEvent } from "@/lib/automation/emit";
import { applyDeltas } from "@/lib/warehouse/apply";
import { notifySupplyEvent, supplyManagers } from "@/lib/supply/notify";
import { parseDocs, type SupplyDoc } from "@/lib/supply/docs";
import {
  DAILY_ORDERS,
  MAX_OPEN_ORDERS,
  MAX_ORDER_DOCS,
  NOTE_CHARS,
  REASON_CHARS,
  canEditLines,
  canReceive,
  canTransition,
  isFullyReceived,
  isOrderOpen,
  parsePrice,
  parseQty,
  remainingQty,
  validateOrderLine,
  validateReorderRule,
  validateSupplier,
  type OrderSide,
  type OrderStatus,
} from "@/lib/supply/rules";

/** Приём, который не удалось занять: строку принял кто-то другой тем же мгновением. */
class ConcurrentReceipt extends Error {}

type Fail = { ok: false; reason: string };
const fail = (reason: string): Fail => ({ ok: false, reason });

async function requireUser() {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

function touch(companyId: string, orderId?: string) {
  revalidatePath(`/[locale]/cabinet/companies/${companyId}/supply`, "page");
  if (orderId) revalidatePath(`/[locale]/cabinet/companies/${companyId}/supply/${orderId}`, "page");
}

/**
 * Калитка поставок. Листинга она **не требует**: заказ поставщику — внутренняя работа, и
 * витрине она ничего не обещает (правило BF для задач). Снятое надзором или удалённое
 * предприятие остаётся только для чтения. Отдельно, в `sendOrder`, листинг требуется —
 * там заказ уходит чужому предприятию.
 */
async function supplyGate(companyId: string, userId: string): Promise<CompanyGate | null> {
  const gate = await editorCompany(companyId, userId);
  if (!gate) return null;
  if (gate.suspendedAt || gate.deletedAt) return null;
  if (!can(gate.permissions, "supply", "EDIT")) return null;
  return gate;
}

/** Склад — свой, живой и в участке: склада вне участка человек не видит (правило BC). */
async function scopedWarehouse(gate: CompanyGate, warehouseId: string | null): Promise<string | null | "bad"> {
  if (!warehouseId) return null;
  const w = await prisma.warehouse.findFirst({
    where: { id: warehouseId, companyId: gate.id, archivedAt: null },
    select: { id: true, pointId: true },
  });
  if (!w) return "bad";
  if (!pointScopeAllows(gate.pointScope, w.pointId)) return "bad";
  return w.id;
}

// ───────────────────────────── Поставщики ─────────────────────────────

export type SupplierFormInput = {
  name: string;
  supplierCompanyId: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  note: string | null;
};

export async function saveSupplier(companyId: string, supplierId: string | null, input: SupplierFormInput) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const gate = await supplyGate(companyId, userId);
  if (!gate) return fail("forbidden");

  const count = supplierId ? 0 : await prisma.supplier.count({ where: { companyId, archivedAt: null } });
  const v = validateSupplier(
    {
      name: input.name,
      email: input.email,
      phone: input.phone,
      supplierCompanyId: input.supplierCompanyId,
    },
    { count, ownCompanyId: companyId },
  );
  if (!v.ok) return fail(v.reason);

  // Портал обещаем только залистованному живому предприятию: иначе кнопка «у него есть
  // портал» вела бы к заказу, которого никто не прочитает.
  if (input.supplierCompanyId) {
    const portal = await prisma.company.count({
      where: { id: input.supplierCompanyId, status: "APPROVED", suspendedAt: null, deletedAt: null },
    });
    if (portal === 0) return fail("portal_company_unknown");
  }

  const data = {
    name: input.name.trim(),
    supplierCompanyId: input.supplierCompanyId,
    contactName: input.contactName?.trim() || null,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    note: input.note?.trim().slice(0, NOTE_CHARS) || null,
  };

  if (supplierId) {
    const updated = await prisma.supplier.updateMany({ where: { id: supplierId, companyId }, data });
    if (updated.count === 0) return fail("not_found");
  } else {
    await prisma.supplier.create({ data: { companyId, ...data } });
  }
  await logCompanyAction({ companyId, actorUserId: userId, action: "SUPPLIER_SAVED", subject: data.name });
  touch(companyId);
  return { ok: true as const };
}

/** Поставщик архивируется, а не удаляется: заказы по нему записаны (правило складов BC). */
export async function setSupplierArchived(companyId: string, supplierId: string, archived: boolean) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const gate = await supplyGate(companyId, userId);
  if (!gate) return fail("forbidden");

  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, companyId },
    select: { id: true, name: true, orders: { select: { status: true } } },
  });
  if (!supplier) return fail("not_found");
  // С незакрытым заказом архив запрещён: документ повиснет без адресата.
  if (archived && supplier.orders.some((o) => isOrderOpen(o.status as OrderStatus))) {
    return fail("supplier_has_orders");
  }

  await prisma.supplier.update({ where: { id: supplierId }, data: { archivedAt: archived ? new Date() : null } });
  await logCompanyAction({
    companyId,
    actorUserId: userId,
    action: archived ? "SUPPLIER_ARCHIVED" : "SUPPLIER_RESTORED",
    subject: supplier.name,
  });
  touch(companyId);
  return { ok: true as const };
}

// ───────────────────────────── Заказ ─────────────────────────────

export type OrderFormInput = {
  supplierId: string;
  warehouseId: string | null;
  expectedDate: string | null;
  currency: string;
  note: string | null;
};

export async function createOrder(companyId: string, input: OrderFormInput) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const gate = await supplyGate(companyId, userId);
  if (!gate) return fail("forbidden");

  const warehouseId = await scopedWarehouse(gate, input.warehouseId);
  if (warehouseId === "bad") return fail("warehouse_out_of_scope");

  const [supplier, open, today] = await Promise.all([
    prisma.supplier.findFirst({ where: { id: input.supplierId, companyId, archivedAt: null }, select: { id: true, name: true } }),
    prisma.supplyOrder.count({ where: { companyId, status: { in: ["DRAFT", "SENT", "CONFIRMED", "SHIPPED"] } } }),
    prisma.supplyOrder.count({ where: { companyId, createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
  ]);
  if (!supplier) return fail("supplier_unknown");
  if (open >= MAX_OPEN_ORDERS) return fail("too_many_open");
  // Счёт до работы — тот же приём, что `DAILY_MOVEMENTS` в BC.
  if (today >= DAILY_ORDERS) return fail("daily_limit");

  const expectedAt = input.expectedDate ? new Date(`${input.expectedDate}T12:00:00.000Z`) : null;
  if (expectedAt && Number.isNaN(expectedAt.getTime())) return fail("date_invalid");

  const order = await prisma.supplyOrder.create({
    data: {
      companyId,
      supplierId: supplier.id,
      warehouseId,
      currency: input.currency.trim().toUpperCase().slice(0, 8) || "USD",
      expectedAt,
      note: input.note?.trim().slice(0, NOTE_CHARS) || null,
      createdById: userId,
    },
    select: { id: true },
  });
  await logCompanyAction({ companyId, actorUserId: userId, action: "ORDER_CREATED", subject: supplier.name });
  touch(companyId, order.id);
  return { ok: true as const, id: order.id };
}

/** Сторона в сделке: покупатель или поставщик. Не роль, а место в документе. */
async function orderSide(
  orderId: string,
  userId: string,
): Promise<
  | { ok: false; reason: string }
  | {
      ok: true;
      side: OrderSide;
      gate: CompanyGate;
      /** У поставщика есть кабинет на платформе: без него оба конца сделки держит покупатель. */
      hasPortal: boolean;
      order: {
        id: string;
        status: OrderStatus;
        companyId: string;
        supplierId: string;
        supplierName: string;
        supplierCompanyId: string | null;
        buyerName: string;
        warehouseId: string | null;
        warehousePointId: string | null;
      };
    }
> {
  const row = await prisma.supplyOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      companyId: true,
      supplierId: true,
      warehouseId: true,
      warehouse: { select: { pointId: true } },
      supplier: { select: { name: true, supplierCompanyId: true } },
      company: { select: { displayName: true } },
    },
  });
  if (!row) return { ok: false, reason: "not_found" };

  const order = {
    id: row.id,
    status: row.status as OrderStatus,
    companyId: row.companyId,
    supplierId: row.supplierId,
    supplierName: row.supplier.name,
    supplierCompanyId: row.supplier.supplierCompanyId,
    // Имя второй стороны — для журнала: строка «кто, что и когда» должна читаться
    // рассказом, а не номером документа (живой прогон BI поймал cuid на экране).
    buyerName: row.company.displayName,
    warehouseId: row.warehouseId,
    warehousePointId: row.warehouse?.pointId ?? null,
  };

  const buyerGate = await supplyGate(row.companyId, userId);
  if (buyerGate) {
    // Участок сужает и здесь: склад вне участка человек не видит, значит и заказ туда не ведёт.
    if (!pointScopeAllows(buyerGate.pointScope, order.warehousePointId) && order.warehouseId) {
      return { ok: false, reason: "forbidden" };
    }
    return { ok: true, side: "BUYER", gate: buyerGate, hasPortal: Boolean(order.supplierCompanyId), order };
  }
  if (order.supplierCompanyId) {
    const supplierGate = await supplyGate(order.supplierCompanyId, userId);
    // Черновик адресату не виден: это ещё не обещание.
    if (supplierGate && order.status !== "DRAFT") {
      return { ok: true, side: "SUPPLIER", gate: supplierGate, hasPortal: true, order };
    }
  }
  return { ok: false, reason: "forbidden" };
}

/**
 * Вторая сторона сделки глазами того, кто нажал: в журнале предприятия должна стоять она,
 * а не номер документа. Номер заказа ничего не говорит человеку, читающему журнал через
 * месяц (тот же дефект, что cuid предприятия в заголовке дела — живой прогон BB).
 */
function counterparty(ctx: { side: OrderSide; order: { supplierName: string; buyerName: string } }): string {
  return ctx.side === "SUPPLIER" ? ctx.order.buyerName : ctx.order.supplierName;
}

export type LineFormInput = { productId: string; qty: string; price: string | null; unit: string; note: string | null };

export async function addOrderLine(orderId: string, input: LineFormInput) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const ctx = await orderSide(orderId, userId);
  if (!ctx.ok) return fail(ctx.reason);
  if (!canEditLines(ctx.order.status, ctx.side)) return fail("not_editable");

  const qty = parseQty(input.qty);
  if (qty === null) return fail("qty_invalid");
  const price = parsePrice(input.price);
  if (price === "invalid") return fail("price_invalid");

  const [lines, product] = await Promise.all([
    prisma.supplyOrderLine.findMany({ where: { orderId }, select: { productId: true } }),
    prisma.product.findFirst({ where: { id: input.productId, deletedAt: null }, select: { id: true, name: true } }),
  ]);
  if (!product) return fail("product_unknown");
  const v = validateOrderLine({ qty, productId: product.id }, { lineCount: lines.length, productIds: lines.map((l) => l.productId) });
  if (!v.ok) return fail(v.reason);

  await prisma.supplyOrderLine.create({
    data: {
      orderId,
      productId: product.id,
      qty: new Prisma.Decimal(qty),
      price: price === null ? null : new Prisma.Decimal(price),
      unit: input.unit.trim() || "pcs",
      note: input.note?.trim().slice(0, 200) || null,
    },
  });
  touch(ctx.order.companyId, orderId);
  return { ok: true as const };
}

export async function removeOrderLine(orderId: string, lineId: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const ctx = await orderSide(orderId, userId);
  if (!ctx.ok) return fail(ctx.reason);
  if (!canEditLines(ctx.order.status, ctx.side)) return fail("not_editable");
  const deleted = await prisma.supplyOrderLine.deleteMany({ where: { id: lineId, orderId } });
  if (deleted.count === 0) return fail("not_found");
  touch(ctx.order.companyId, orderId);
  return { ok: true as const };
}

/**
 * Отправка. Это единственное действие слайса, которое **требует листинга**: заказ уходит
 * чужому предприятию, и без листинга кто угодно, едва зарегистрировавшись, писал бы
 * чужим. Внешнему поставщику (контакт без платформы) отправка — смена статуса своего
 * документа, и листинг для неё не нужен.
 */
export async function sendOrder(orderId: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const ctx = await orderSide(orderId, userId);
  if (!ctx.ok) return fail(ctx.reason);
  if (!canTransition({ status: ctx.order.status, move: "SEND", side: ctx.side, hasPortal: ctx.hasPortal })) return fail("not_allowed");

  const lines = await prisma.supplyOrderLine.count({ where: { orderId } });
  if (lines === 0) return fail("no_lines");

  if (ctx.order.supplierCompanyId && ctx.gate.status !== "APPROVED") return fail("not_listed");

  const updated = await prisma.supplyOrder.updateMany({
    where: { id: orderId, status: "DRAFT" },
    data: { status: "SENT", sentAt: new Date() },
  });
  if (updated.count === 0) return fail("not_allowed");

  await logCompanyAction({ companyId: ctx.order.companyId, actorUserId: userId, action: "ORDER_SENT", subject: ctx.order.supplierName });
  if (ctx.order.supplierCompanyId) {
    const [targets, buyer] = await Promise.all([
      supplyManagers(ctx.order.supplierCompanyId),
      prisma.company.findUnique({ where: { id: ctx.order.companyId }, select: { displayName: true } }),
    ]);
    await notifySupplyEvent({
      kind: "sent",
      userIds: targets.filter((id) => id !== userId),
      companyId: ctx.order.supplierCompanyId,
      companyName: buyer?.displayName ?? "",
      orderId,
    });
  }
  touch(ctx.order.companyId, orderId);
  return { ok: true as const };
}

/** Подтверждение срока — суть портала: поставщик называет своё число, а не наше. */
export async function confirmOrder(orderId: string, etaDate: string | null) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const ctx = await orderSide(orderId, userId);
  if (!ctx.ok) return fail(ctx.reason);
  if (!canTransition({ status: ctx.order.status, move: "CONFIRM", side: ctx.side, hasPortal: ctx.hasPortal })) return fail("not_allowed");

  const eta = etaDate ? new Date(`${etaDate}T12:00:00.000Z`) : null;
  if (eta && Number.isNaN(eta.getTime())) return fail("date_invalid");

  const updated = await prisma.supplyOrder.updateMany({
    where: { id: orderId, status: "SENT" },
    data: { status: "CONFIRMED", confirmedAt: new Date(), confirmedEta: eta },
  });
  if (updated.count === 0) return fail("not_allowed");

  await logCompanyAction({ companyId: ctx.gate.id, actorUserId: userId, action: "ORDER_CONFIRMED", subject: counterparty(ctx) });
  // Весть идёт с той стороны. У заказа без портала обе стороны — одни и те же люди, и
  // письмо «ваш заказ подтверждён» о собственной же записи им незачем.
  if (ctx.hasPortal) await notifyBuyer(ctx.order.companyId, orderId, userId, "confirmed");
  touch(ctx.order.companyId, orderId);
  touch(ctx.gate.id, orderId);
  return { ok: true as const };
}

export async function declineOrder(orderId: string, reason: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const ctx = await orderSide(orderId, userId);
  if (!ctx.ok) return fail(ctx.reason);
  if (!canTransition({ status: ctx.order.status, move: "DECLINE", side: ctx.side, hasPortal: ctx.hasPortal })) return fail("not_allowed");
  const text = (reason ?? "").trim();
  if (text.length < REASON_CHARS) return fail("reason_required");

  const updated = await prisma.supplyOrder.updateMany({
    where: { id: orderId, status: { in: ["SENT", "CONFIRMED"] } },
    data: { status: "DECLINED", declineReason: text.slice(0, NOTE_CHARS), closedAt: new Date() },
  });
  if (updated.count === 0) return fail("not_allowed");

  await logCompanyAction({ companyId: ctx.gate.id, actorUserId: userId, action: "ORDER_DECLINED", subject: counterparty(ctx), meta: { reason: text } });
  await notifyBuyer(ctx.order.companyId, orderId, userId, "declined", text);
  touch(ctx.order.companyId, orderId);
  touch(ctx.gate.id, orderId);
  return { ok: true as const };
}

/**
 * «Отправлено» ставит поставщик, и на остаток это не влияет: остаток меняет только
 * приёмка покупателя — иначе чужое предприятие пишет в наши числа.
 */
export async function markOrderShipped(orderId: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const ctx = await orderSide(orderId, userId);
  if (!ctx.ok) return fail(ctx.reason);
  if (!canTransition({ status: ctx.order.status, move: "SHIP", side: ctx.side, hasPortal: ctx.hasPortal })) return fail("not_allowed");

  const updated = await prisma.supplyOrder.updateMany({
    where: { id: orderId, status: { in: ["SENT", "CONFIRMED"] } },
    data: { status: "SHIPPED", shippedAt: new Date() },
  });
  if (updated.count === 0) return fail("not_allowed");

  await logCompanyAction({ companyId: ctx.gate.id, actorUserId: userId, action: "ORDER_SHIPPED", subject: counterparty(ctx) });
  // Весть идёт с той стороны. У заказа без портала обе стороны — одни и те же люди, и
  // письмо «ваш заказ подтверждён» о собственной же записи им незачем.
  if (ctx.hasPortal) await notifyBuyer(ctx.order.companyId, orderId, userId, "shipped");
  touch(ctx.order.companyId, orderId);
  touch(ctx.gate.id, orderId);
  return { ok: true as const };
}

async function notifyBuyer(
  buyerCompanyId: string,
  orderId: string,
  actorUserId: string,
  kind: "confirmed" | "declined" | "shipped",
  extra?: string,
) {
  const [targets, buyer] = await Promise.all([
    supplyManagers(buyerCompanyId),
    prisma.company.findUnique({ where: { id: buyerCompanyId }, select: { displayName: true } }),
  ]);
  await notifySupplyEvent({
    kind,
    userIds: targets.filter((id) => id !== actorUserId),
    companyId: buyerCompanyId,
    companyName: buyer?.displayName ?? "",
    orderId,
    extra,
  });
}

/**
 * Приёмка строки. Пишет **движение BC** тем же кодом, что ручной приход: у остатка один
 * автор. Приём идёт построчно, потому что недовоз — обычное дело; принято по всем
 * строкам — заказ закрывается сам.
 */
export async function receiveOrderLine(orderId: string, lineId: string, qtyRaw: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const ctx = await orderSide(orderId, userId);
  if (!ctx.ok) return fail(ctx.reason);
  if (ctx.side !== "BUYER") return fail("not_allowed");
  if (!canReceive(ctx.order.status)) return fail("not_shipped");
  if (!ctx.order.warehouseId) return fail("warehouse_required");

  const qty = parseQty(qtyRaw);
  if (qty === null) return fail("qty_invalid");

  const line = await prisma.supplyOrderLine.findFirst({
    where: { id: lineId, orderId },
    select: { id: true, productId: true, qty: true, receivedQty: true, product: { select: { slug: true } } },
  });
  if (!line) return fail("not_found");

  // Переприём запрещён: один привоз — один раз. Больше заказанного тоже не принимаем —
  // привоз сверх заказа это другой документ, а не этот.
  const left = remainingQty({ qty: Number(line.qty), receivedQty: Number(line.receivedQty) });
  if (left <= 0) return fail("already_received");
  if (qty > left) return fail("qty_over_remaining");

  const warehouseId = ctx.order.warehouseId;
  try {
    await prisma.$transaction(async (tx) => {
      // Условие по прежнему принятому количеству: два одновременных приёма не зачислят
      // товар дважды (тот же приём, что у приёмки транзита в BC).
      const claimed = await tx.supplyOrderLine.updateMany({
        where: { id: line.id, receivedQty: line.receivedQty },
        data: { receivedQty: { increment: new Prisma.Decimal(qty) } },
      });
      if (claimed.count === 0) throw new ConcurrentReceipt();
      await tx.stockMovement.create({
        data: {
          companyId: ctx.order.companyId,
          productId: line.productId,
          kind: "RECEIPT",
          status: "DONE",
          toWarehouseId: warehouseId,
          qty: new Prisma.Decimal(qty),
          supplyLineId: line.id,
          createdById: userId,
        },
      });
      await applyDeltas(tx, line.productId, [{ warehouseId, delta: qty }], "RECEIPT");
    });
  } catch (err) {
    if (err instanceof ConcurrentReceipt) return fail("concurrent_receipt");
    throw err;
  }

  const lines = await prisma.supplyOrderLine.findMany({ where: { orderId }, select: { qty: true, receivedQty: true } });
  const full = isFullyReceived(lines.map((l) => ({ qty: Number(l.qty), receivedQty: Number(l.receivedQty) })));
  if (full) {
    await prisma.supplyOrder.updateMany({
      where: { id: orderId, status: "SHIPPED" },
      data: { status: "RECEIVED", closedAt: new Date() },
    });
  }

  await logCompanyAction({
    companyId: ctx.order.companyId,
    actorUserId: userId,
    action: "ORDER_RECEIVED",
    subject: line.product.slug,
    meta: { qty, full },
  });
  // Событие — только на **полном** приёме: приёмка идёт построчно, и пять оповещений об
  // одном привозе читались бы как пять привозов.
  if (full) {
    const order = await prisma.supplyOrder.findUnique({
      where: { id: orderId },
      select: { warehouseId: true, supplier: { select: { id: true, name: true } } },
    });
    const warehouse = order?.warehouseId
      ? await prisma.warehouse.findUnique({
          where: { id: order.warehouseId },
          select: { name: true, pointId: true },
        })
      : null;
    await emitCompanyEvent({
      companyId: ctx.order.companyId,
      kind: "ORDER_RECEIVED",
      subject: order?.supplier?.name ?? null,
      actorUserId: userId,
      data: {
        orderId,
        supplierId: order?.supplier?.id ?? null,
        supplierName: order?.supplier?.name ?? null,
        warehouseId: order?.warehouseId ?? null,
        warehouseName: warehouse?.name ?? null,
        pointId: warehouse?.pointId ?? null,
      },
    });
  }
  touch(ctx.order.companyId, orderId);
  revalidatePath(`/[locale]/product/${line.product.slug}`, "page");
  return { ok: true as const, full };
}

/** Закрыть недовезённое: «остального не будет» знает покупатель, а не часы. */
export async function closeOrder(orderId: string, reason: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const ctx = await orderSide(orderId, userId);
  if (!ctx.ok) return fail(ctx.reason);
  if (!canTransition({ status: ctx.order.status, move: "CLOSE", side: ctx.side, hasPortal: ctx.hasPortal })) return fail("not_allowed");
  const text = (reason ?? "").trim();
  if (text.length < REASON_CHARS) return fail("reason_required");

  // Причина **дописывается** к примечанию, а не затирает его: примечание покупателя —
  // часть документа, и стереть его закрытием значило бы потерять, зачем заказ был нужен.
  const prev = await prisma.supplyOrder.findUnique({ where: { id: orderId }, select: { note: true } });
  const note = [prev?.note ?? "", text].filter(Boolean).join("\n").slice(0, NOTE_CHARS);
  const updated = await prisma.supplyOrder.updateMany({
    where: { id: orderId, status: { in: ["SENT", "CONFIRMED", "SHIPPED"] } },
    data: { status: "RECEIVED", closedAt: new Date(), note },
  });
  if (updated.count === 0) return fail("not_allowed");
  await logCompanyAction({ companyId: ctx.order.companyId, actorUserId: userId, action: "ORDER_CLOSED", subject: counterparty(ctx), meta: { reason: text } });
  touch(ctx.order.companyId, orderId);
  return { ok: true as const };
}

export async function cancelOrder(orderId: string, reason: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const ctx = await orderSide(orderId, userId);
  if (!ctx.ok) return fail(ctx.reason);
  if (!canTransition({ status: ctx.order.status, move: "CANCEL", side: ctx.side, hasPortal: ctx.hasPortal })) return fail("not_allowed");
  const text = (reason ?? "").trim();
  if (text.length < REASON_CHARS) return fail("reason_required");

  const updated = await prisma.supplyOrder.updateMany({
    where: { id: orderId, status: { in: ["DRAFT", "SENT", "CONFIRMED"] } },
    data: { status: "CANCELLED", cancelReason: text.slice(0, NOTE_CHARS), closedAt: new Date() },
  });
  if (updated.count === 0) return fail("not_allowed");
  await logCompanyAction({ companyId: ctx.order.companyId, actorUserId: userId, action: "ORDER_CANCELLED", subject: counterparty(ctx), meta: { reason: text } });
  touch(ctx.order.companyId, orderId);
  return { ok: true as const };
}

/** Накладную несёт та сторона, у которой она на руках: сторона пишется в самой записи. */
export async function addOrderDoc(orderId: string, doc: { name: string; filename: string; size: number; mime: string }) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const ctx = await orderSide(orderId, userId);
  if (!ctx.ok) return fail(ctx.reason);

  const row = await prisma.supplyOrder.findUnique({ where: { id: orderId }, select: { docs: true } });
  const docs = parseDocs(row?.docs);
  if (docs.length >= MAX_ORDER_DOCS) return fail("too_many_docs");

  const next: SupplyDoc[] = [
    ...docs,
    {
      name: doc.name,
      filename: doc.filename,
      size: doc.size,
      mime: doc.mime,
      side: ctx.side === "BUYER" ? "buyer" : "supplier",
      at: new Date().toISOString(),
    },
  ];
  // Разбор на входе: в базу ложится только то, что мы потом согласны прочитать.
  await prisma.supplyOrder.update({ where: { id: orderId }, data: { docs: parseDocs(next) as never } });
  await logCompanyAction({ companyId: ctx.gate.id, actorUserId: userId, action: "ORDER_DOC_ADDED", subject: doc.filename });
  touch(ctx.order.companyId, orderId);
  touch(ctx.gate.id, orderId);
  return { ok: true as const };
}

// ───────────────────────────── Автозаказ ─────────────────────────────

export type ReorderFormInput = {
  warehouseId: string;
  productId: string;
  supplierId: string | null;
  minQty: string;
  targetQty: string;
};

export async function saveReorderRule(companyId: string, input: ReorderFormInput) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const gate = await supplyGate(companyId, userId);
  if (!gate) return fail("forbidden");

  const warehouseId = await scopedWarehouse(gate, input.warehouseId);
  if (warehouseId === "bad" || !warehouseId) return fail("warehouse_out_of_scope");

  const minQty = Number((input.minQty ?? "").trim().replace(",", "."));
  const targetQty = Number((input.targetQty ?? "").trim().replace(",", "."));
  const count = await prisma.reorderRule.count({ where: { companyId } });
  const v = validateReorderRule({ minQty, targetQty, supplierId: input.supplierId }, { count });
  if (!v.ok) return fail(v.reason);

  const [product, supplier] = await Promise.all([
    prisma.product.findFirst({ where: { id: input.productId, deletedAt: null }, select: { id: true, name: true } }),
    prisma.supplier.findFirst({ where: { id: input.supplierId!, companyId, archivedAt: null }, select: { id: true } }),
  ]);
  if (!product) return fail("product_unknown");
  if (!supplier) return fail("supplier_unknown");

  await prisma.reorderRule.upsert({
    where: { warehouseId_productId: { warehouseId, productId: product.id } },
    create: {
      companyId,
      warehouseId,
      productId: product.id,
      supplierId: supplier.id,
      minQty: new Prisma.Decimal(minQty),
      targetQty: new Prisma.Decimal(targetQty),
    },
    update: {
      supplierId: supplier.id,
      minQty: new Prisma.Decimal(minQty),
      targetQty: new Prisma.Decimal(targetQty),
    },
  });
  await logCompanyAction({ companyId, actorUserId: userId, action: "REORDER_RULE_SAVED", subject: product.name, meta: { minQty, targetQty } });
  touch(companyId);
  return { ok: true as const };
}

export async function deleteReorderRule(companyId: string, ruleId: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const gate = await supplyGate(companyId, userId);
  if (!gate) return fail("forbidden");
  const rule = await prisma.reorderRule.findFirst({
    where: { id: ruleId, companyId },
    select: { id: true, warehouseId: true, product: { select: { name: true } } },
  });
  if (!rule) return fail("not_found");
  if ((await scopedWarehouse(gate, rule.warehouseId)) === "bad") return fail("forbidden");
  await prisma.reorderRule.delete({ where: { id: rule.id } });
  await logCompanyAction({ companyId, actorUserId: userId, action: "REORDER_RULE_DELETED", subject: rule.product.name });
  touch(companyId);
  return { ok: true as const };
}
