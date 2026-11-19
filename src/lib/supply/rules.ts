/**
 * Правила поставок — чистые, без Prisma. Спека
 * `docs/superpowers/specs/2026-11-19-supplier-portal-autoorder-design.md`, разделы 3–7.
 *
 * Главные решения слайса живут здесь: заказ — документ, а не платёж; подтверждает и
 * отправляет поставщик, а **принимает покупатель** (остаток меняет только приёмка
 * покупателя — иначе чужое предприятие пишет в наши числа); закрывает заказ человек, а
 * не часы.
 */
import { can, type TeamPermissions } from "@/lib/company-team/permissions";

export const ORDER_STATUSES = [
  "DRAFT",
  "SENT",
  "CONFIRMED",
  "DECLINED",
  "SHIPPED",
  "RECEIVED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Поставщиков на предприятие: столько ведёт человек, а не выгрузка. */
export const MAX_SUPPLIERS = 200;
/** Незакрытых заказов — тот же приём, что `MAX_OPEN_TASKS` в BF. */
export const MAX_OPEN_ORDERS = 200;
/** Новых заказов в сутки; считается **до** работы, как `DAILY_MOVEMENTS` в BC. */
export const DAILY_ORDERS = 100;
export const MAX_ORDER_LINES = 50;
export const MAX_REORDER_RULES = 500;
export const MAX_ORDER_DOCS = 20;
export const NAME_CHARS = 200;
export const NOTE_CHARS = 2000;
/** Причина отказа и отмены — не короче порога причины во всём проекте. */
export const REASON_CHARS = 3;

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

/** Заказ закрыт: ни приёмки, ни переходов. */
export function isOrderClosed(status: OrderStatus): boolean {
  return status === "RECEIVED" || status === "DECLINED" || status === "CANCELLED";
}

/** Заказ занимает место в потолке незакрытых и прячет пару «склад × товар» от автозаказа. */
export function isOrderOpen(status: OrderStatus): boolean {
  return !isOrderClosed(status);
}

export type OrderSide = "BUYER" | "SUPPLIER";

export const ORDER_MOVES = ["SEND", "CONFIRM", "DECLINE", "SHIP", "CLOSE", "CANCEL"] as const;
export type OrderMove = (typeof ORDER_MOVES)[number];

/**
 * Кто и когда вправе двинуть заказ. Сторона — не роль, а место в сделке: покупатель
 * собирает и отправляет, поставщик подтверждает срок и отмечает отправку, закрывает
 * покупатель — «остального не будет» знает только он.
 *
 * `hasPortal` — есть ли у поставщика кабинет на платформе, и это не мелочь: у поставщика
 * **вне платформы** второй стороны не существует вовсе, и заказ ему, дойдя до
 * «отправлено», замер бы навсегда — принимать нечего, потому что никто не нажмёт
 * «отгружено». Поэтому у заказа без портала оба конца держит покупатель: он записывает
 * срок, который поставщик назвал по телефону, и отмечает отгрузку, о которой узнал
 * письмом. Ровно это обещает спека: «заказ остаётся документом покупателя — он сам ведёт
 * его статусы». Поймано живым прогоном BI.
 */
export function canTransition(input: {
  status: OrderStatus;
  move: OrderMove;
  side: OrderSide;
  hasPortal: boolean;
}): boolean {
  const { status, move, side, hasPortal } = input;
  if (isOrderClosed(status)) return false;
  // Ходы поставщика: у заказа без портала их делает сам покупатель — за второй стороной
  // некому нажимать.
  const supplierSide = hasPortal ? side === "SUPPLIER" : side === "BUYER";
  switch (move) {
    case "SEND":
      return side === "BUYER" && status === "DRAFT";
    case "CONFIRM":
      return supplierSide && status === "SENT";
    case "DECLINE":
      // Отказаться можно и после подтверждения: машина сломалась, товара не стало.
      // Отказ остаётся ходом портала: отказ поставщика вне платформы покупатель
      // записывает отменой с причиной — второго пути к одному факту не заводим.
      return hasPortal && side === "SUPPLIER" && (status === "SENT" || status === "CONFIRMED");
    case "SHIP":
      return supplierSide && (status === "CONFIRMED" || status === "SENT");
    case "CLOSE":
      return side === "BUYER" && (status === "SHIPPED" || status === "CONFIRMED" || status === "SENT");
    case "CANCEL":
      // Отменяет покупатель, пока товар не отправлен: отправленное уже едет.
      return side === "BUYER" && (status === "DRAFT" || status === "SENT" || status === "CONFIRMED");
  }
}

/** Принимать можно только то, что поставщик отправил. */
export function canReceive(status: OrderStatus): boolean {
  return status === "SHIPPED";
}

/** Строки правит только покупатель и только в черновике: отправленное — обещание. */
export function canEditLines(status: OrderStatus, side: OrderSide): boolean {
  return side === "BUYER" && status === "DRAFT";
}

type Ok = { ok: true };
type Bad<R extends string> = { ok: false; reason: R };

export type SupplierInput = {
  name: string;
  email: string | null;
  phone: string | null;
  supplierCompanyId: string | null;
};

export type SupplierReason = "name_required" | "name_long" | "email_invalid" | "self_supplier" | "too_many";

/**
 * Поставщик. Своим поставщиком предприятие быть не может: заказ самому себе — это
 * перемещение между складами, и оно уже есть в BC.
 */
export function validateSupplier(
  input: SupplierInput,
  ctx: { count: number; ownCompanyId: string },
): Ok | Bad<SupplierReason> {
  const name = input.name.trim();
  if (!name) return { ok: false, reason: "name_required" };
  if (name.length > NAME_CHARS) return { ok: false, reason: "name_long" };
  if (ctx.count >= MAX_SUPPLIERS) return { ok: false, reason: "too_many" };
  if (input.supplierCompanyId && input.supplierCompanyId === ctx.ownCompanyId) {
    return { ok: false, reason: "self_supplier" };
  }
  const email = input.email?.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, reason: "email_invalid" };
  return { ok: true };
}

/** Количество в заказе: три знака после точки, как в движениях BC. */
export function parseQty(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,3})?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Цена справочная и необязательная: платежа у нас нет. */
export function parsePrice(raw: string | null): number | null | "invalid" {
  const text = (raw ?? "").trim().replace(",", ".");
  if (!text) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return "invalid";
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : "invalid";
}

export type LineReason = "qty_invalid" | "too_many_lines" | "duplicate_product";

export function validateOrderLine(
  input: { qty: number; productId: string },
  ctx: { lineCount: number; productIds: readonly string[] },
): Ok | Bad<LineReason> {
  if (!Number.isFinite(input.qty) || input.qty <= 0) return { ok: false, reason: "qty_invalid" };
  if (ctx.lineCount >= MAX_ORDER_LINES) return { ok: false, reason: "too_many_lines" };
  // Один товар — одна строка: две строки одного товара означали бы два разных
  // количества одной вещи в одном документе (то же решение, что одно предложение на
  // товар в BC).
  if (ctx.productIds.includes(input.productId)) return { ok: false, reason: "duplicate_product" };
  return { ok: true };
}

export type ReorderReason = "qty_invalid" | "target_not_above_min" | "supplier_required" | "too_many";

/**
 * Правило автозаказа. «Добирать до» обязано быть больше порога: равные числа дают
 * заявку на ноль, а меньшее — заявку, которая сразу снова ниже порога.
 */
export function validateReorderRule(
  input: { minQty: number; targetQty: number; supplierId: string | null },
  ctx: { count: number },
): Ok | Bad<ReorderReason> {
  if (!input.supplierId) return { ok: false, reason: "supplier_required" };
  if (!Number.isFinite(input.minQty) || input.minQty < 0) return { ok: false, reason: "qty_invalid" };
  if (!Number.isFinite(input.targetQty) || input.targetQty <= 0) return { ok: false, reason: "qty_invalid" };
  if (input.targetQty <= input.minQty) return { ok: false, reason: "target_not_above_min" };
  if (ctx.count >= MAX_REORDER_RULES) return { ok: false, reason: "too_many" };
  return { ok: true };
}

/** Сумма заказа — на экране, а не в базе: цена справочная, и считать её больше нечем. */
export function orderTotal(lines: readonly { qty: number; price: number | null }[]): number | null {
  const priced = lines.filter((l) => l.price !== null);
  if (priced.length === 0) return null;
  return priced.reduce((sum, l) => sum + l.qty * (l.price ?? 0), 0);
}

/** Принято по всем строкам — заказ закрывается сам. */
export function isFullyReceived(lines: readonly { qty: number; receivedQty: number }[]): boolean {
  if (lines.length === 0) return false;
  return lines.every((l) => l.receivedQty >= l.qty);
}

/** Сколько по строке осталось принять. Переприём запрещён: один привоз — один раз. */
export function remainingQty(line: { qty: number; receivedQty: number }): number {
  return Math.max(0, Number((line.qty - line.receivedQty).toFixed(3)));
}

export type SupplyRights = {
  see: boolean;
  manage: boolean;
};

export function supplyRights(perms: TeamPermissions): SupplyRights {
  return {
    see: can(perms, "supply", "VIEW"),
    manage: can(perms, "supply", "EDIT"),
  };
}
