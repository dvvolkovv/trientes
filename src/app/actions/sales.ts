"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { editorCompany } from "@/lib/products/editor-company";
import { pointScopeAllows } from "@/lib/company-team/permissions";
import { logCompanyAction } from "@/lib/company-team/journal";
import { NegativeBalance, applyDeltas } from "@/lib/warehouse/apply";
import { readTillProducts } from "@/lib/sales/read";
import {
  cancelAllowed,
  canClaimReceipt,
  saleRightsFor,
  stockDeltas,
  validateSale,
  type SaleLineInput,
} from "@/lib/sales/rules";
import { generateReceiptToken, hashReceiptToken, receiptExpiry, receiptUrl } from "@/lib/sales/token";

type Fail = { ok: false; reason: string };
const fail = (reason: string): Fail => ({ ok: false, reason });

async function requireUser() {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export type SaleFormInput = {
  warehouseId: string | null;
  lines: SaleLineInput[];
  payment: string;
  payCoin: string | null;
  payRate: string | null;
  payCoinAmount: string | null;
  payNote: string | null;
  note: string | null;
};

/**
 * Запись чека: строки, движения с полки и номер — одной транзакцией. Чек без движений
 * оставил бы склад врать, движения без чека были бы необъяснимы, а номер, выданный
 * вне транзакции, повторился бы у двух кассиров.
 *
 * Товар уходит обычным `ISSUE` через `applyDeltas` — у остатка один автор (BI), поэтому
 * касса не может увести полку в минус и сверка `scripts/stock-audit.ts` сходится без
 * правок.
 */
export async function recordSale(companyId: string, locale: string, input: SaleFormInput) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const gate = await editorCompany(companyId, userId);
  if (!saleRightsFor(gate).sell) return fail("forbidden");

  // Полка — своя, живая и в участке сотрудника.
  let warehouse: { id: string; pointId: string | null } | null = null;
  if (input.warehouseId) {
    warehouse = await prisma.warehouse.findFirst({
      where: { id: input.warehouseId, companyId, archivedAt: null, kind: "SHELF" },
      select: { id: true, pointId: true },
    });
    if (!warehouse) return fail("warehouse_unknown");
    if (!pointScopeAllows(gate!.pointScope, warehouse.pointId)) return fail("forbidden");
  }

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const [offers, salesToday] = await Promise.all([
    readTillProducts(companyId, warehouse?.id ?? null),
    prisma.sale.count({ where: { companyId, createdAt: { gte: startOfDay } } }),
  ]);

  const parsed = validateSale(
    {
      lines: input.lines,
      payment: input.payment,
      payCoin: input.payCoin,
      payRate: input.payRate,
      payCoinAmount: input.payCoinAmount,
      hasShelf: Boolean(warehouse),
    },
    { offers, salesToday },
  );
  if (!parsed.ok) return fail(parsed.reason);
  const sale = parsed.value;

  const deltas = stockDeltas(sale.lines);
  // Ранняя проверка остатка — чтобы отказать словами, ничего не записав. Решающей она
  // быть не может: настоящий охранник — получившееся число внутри транзакции.
  if (deltas.length > 0 && warehouse) {
    const have = await prisma.stockBalance.findMany({
      where: { warehouseId: warehouse.id, productId: { in: deltas.map((d) => d.productId) } },
      select: { productId: true, qty: true },
    });
    const map = new Map(have.map((b) => [b.productId, Number(b.qty)]));
    for (const d of deltas) {
      if ((map.get(d.productId) ?? 0) - d.qty < 0) return fail("insufficient_stock");
    }
  }

  const token = generateReceiptToken();

  try {
    const created = await prisma.$transaction(async (tx) => {
      // Номер — `increment` по строке предприятия: строка блокируется, два кассира
      // номера не повторят.
      const company = await tx.company.update({
        where: { id: companyId },
        data: { saleSeq: { increment: 1 } },
        select: { saleSeq: true },
      });
      const row = await tx.sale.create({
        data: {
          companyId,
          number: company.saleSeq,
          warehouseId: warehouse?.id ?? null,
          pointId: warehouse?.pointId ?? null,
          currency: sale.totals.currency,
          listTotal: new Prisma.Decimal(sale.totals.listTotal),
          total: new Prisma.Decimal(sale.totals.total),
          cashbackTotal: new Prisma.Decimal(sale.totals.cashbackTotal),
          payment: sale.payment,
          payCoin: sale.payCoin,
          payRate: sale.payRate === null ? null : new Prisma.Decimal(sale.payRate),
          payCoinAmount: sale.payCoinAmount === null ? null : new Prisma.Decimal(sale.payCoinAmount),
          payNote: input.payNote?.trim() || null,
          note: input.note?.trim() || null,
          receiptTokenHash: hashReceiptToken(token),
          receiptExpiresAt: receiptExpiry(),
          createdById: userId,
          lines: {
            create: sale.lines.map((l) => ({
              productId: l.productId,
              name: l.name,
              unit: l.unit,
              qty: new Prisma.Decimal(l.qty),
              listPrice: new Prisma.Decimal(l.listPrice),
              price: new Prisma.Decimal(l.price),
              cashbackPercent: l.cashbackPercent === null ? null : new Prisma.Decimal(l.cashbackPercent),
              cashbackAmount: new Prisma.Decimal(l.cashbackAmount),
            })),
          },
        },
        select: { id: true, number: true },
      });

      for (const d of deltas) {
        await tx.stockMovement.create({
          data: {
            companyId,
            productId: d.productId,
            kind: "ISSUE",
            status: "DONE",
            fromWarehouseId: warehouse!.id,
            qty: new Prisma.Decimal(d.qty),
            saleId: row.id,
            createdById: userId,
          },
        });
        await applyDeltas(tx, d.productId, [{ warehouseId: warehouse!.id, delta: -d.qty }], "ISSUE");
      }
      return row;
    });

    await logCompanyAction({
      companyId,
      actorUserId: userId,
      action: "SALE_RECORDED",
      subject: `#${created.number}`,
      meta: { total: sale.totals.total, currency: sale.totals.currency, lines: sale.lines.length },
    });
    revalidatePath(`/[locale]/cabinet/companies/${companyId}/sales`, "page");
    for (const l of sale.lines) {
      const offer = offers.find((o) => o.productId === l.productId);
      if (offer) revalidatePath(`/[locale]/product/${offer.slug}`, "page");
    }
    return { ok: true as const, id: created.id, number: created.number, url: receiptUrl(locale, token) };
  } catch (err) {
    if (err instanceof NegativeBalance) return fail("insufficient_stock");
    throw err;
  }
}

/**
 * Отмена чека — встречный приход, а сам чек остаётся со статусом `CANCELLED`: он
 * неизменяем, и покупатель держит его копию. Условие по прежнему статусу внутри
 * транзакции: два одновременных нажатия не вернут товар дважды.
 */
export async function cancelSale(companyId: string, saleId: string, reason: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const gate = await editorCompany(companyId, userId);
  if (!saleRightsFor(gate).sell) return fail("forbidden");

  const sale = await prisma.sale.findFirst({
    where: { id: saleId, companyId },
    select: {
      id: true,
      number: true,
      status: true,
      warehouseId: true,
      pointId: true,
      movements: { where: { status: "DONE", kind: "ISSUE" }, select: { id: true, productId: true, qty: true } },
    },
  });
  if (!sale) return fail("not_found");
  if (!pointScopeAllows(gate!.pointScope, sale.pointId)) return fail("forbidden");

  const note = (reason ?? "").trim();
  const allowed = cancelAllowed({ status: sale.status, reason: note });
  if (!allowed.ok) return fail(allowed.reason);

  const applied = await prisma.$transaction(async (tx) => {
    const claimed = await tx.sale.updateMany({
      where: { id: sale.id, status: "COMPLETED" },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: note, cancelledById: userId },
    });
    if (claimed.count === 0) return false;
    for (const m of sale.movements) {
      if (!sale.warehouseId) continue;
      await tx.stockMovement.create({
        data: {
          companyId,
          productId: m.productId,
          kind: "RECEIPT",
          status: "DONE",
          toWarehouseId: sale.warehouseId,
          qty: m.qty,
          note,
          reverseOfId: m.id,
          saleId: sale.id,
          createdById: userId,
        },
      });
      await applyDeltas(tx, m.productId, [{ warehouseId: sale.warehouseId, delta: Number(m.qty) }], "RECEIPT");
    }
    return true;
  });
  if (!applied) return fail("already_cancelled");

  await logCompanyAction({
    companyId,
    actorUserId: userId,
    action: "SALE_CANCELLED",
    subject: `#${sale.number}`,
    meta: { reason: note },
  });
  revalidatePath(`/[locale]/cabinet/companies/${companyId}/sales`, "page");
  return { ok: true as const };
}

/**
 * Покупатель привязывает чек к своему кабинету сам, перейдя по ссылке. Гонку двух
 * переходов снимает условный `updateMany` по `buyerUserId: null`: чек достаётся первому,
 * а не последнему.
 */
export async function claimReceipt(token: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const hash = hashReceiptToken(token);
  const sale = await prisma.sale.findUnique({
    where: { receiptTokenHash: hash },
    select: {
      id: true,
      buyerUserId: true,
      receiptExpiresAt: true,
      company: { select: { status: true, suspendedAt: true, deletedAt: true } },
    },
  });
  if (!sale) return fail("not_found");
  if (sale.buyerUserId) return fail(sale.buyerUserId === userId ? "already_yours" : "already_claimed");

  const can = canClaimReceipt({
    status: sale.company.status,
    suspendedAt: sale.company.suspendedAt,
    deletedAt: sale.company.deletedAt,
    expiresAt: sale.receiptExpiresAt,
    now: new Date(),
  });
  if (!can.ok) return fail(can.reason);

  const claimed = await prisma.sale.updateMany({
    where: { id: sale.id, buyerUserId: null },
    data: { buyerUserId: userId, buyerClaimedAt: new Date() },
  });
  if (claimed.count === 0) return fail("already_claimed");
  revalidatePath("/[locale]/cabinet/receipts", "page");
  return { ok: true as const, id: sale.id };
}

/**
 * Показать QR снова. Токена в базе нет — только sha256, — поэтому «снова» значит
 * **новую ссылку**: прежняя гаснет, и это честнее, чем хранить предъявитель открытым
 * (чек — это состав покупки, то есть персональные данные). Пока чек не привязан к
 * кабинету, терять нечего; привязанный лежит у покупателя сам, и ссылка ему не нужна.
 *
 * Строки журнала у этого действия нет: сам чек оно не меняет, а продавец показывает
 * покупателю его же покупку.
 */
export async function reissueReceiptLink(companyId: string, saleId: string, locale: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const gate = await editorCompany(companyId, userId);
  if (!saleRightsFor(gate).sell) return fail("forbidden");

  const sale = await prisma.sale.findFirst({
    where: { id: saleId, companyId },
    select: { id: true, pointId: true, buyerUserId: true },
  });
  if (!sale) return fail("not_found");
  if (!pointScopeAllows(gate!.pointScope, sale.pointId)) return fail("forbidden");
  if (sale.buyerUserId) return fail("already_claimed");

  const token = generateReceiptToken();
  await prisma.sale.update({
    where: { id: sale.id },
    data: { receiptTokenHash: hashReceiptToken(token), receiptExpiresAt: receiptExpiry() },
  });
  return { ok: true as const, url: receiptUrl(locale, token) };
}
