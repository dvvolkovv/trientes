/**
 * Правила складов, остатков и движений — чистые, без Prisma. Спека
 * `docs/superpowers/specs/2026-11-19-product-offers-warehouses-design.md`, раздел 3.
 *
 * Главное решение слайса живёт здесь: движение неизменяемо, остаток — его свёртка, а
 * товар у перевозчика — **третье место**, а не остаток склада-получателя. Иначе едущий
 * товар существует дважды или исчезает.
 */

export const WAREHOUSE_KINDS = ["WHOLESALE", "SHELF", "THIRD_PARTY"] as const;
export type WarehouseKind = (typeof WAREHOUSE_KINDS)[number];

export const MOVE_KINDS = ["RECEIPT", "ISSUE", "TRANSFER", "ADJUST"] as const;
export type MoveKind = (typeof MOVE_KINDS)[number];

export type MoveStatus = "IN_TRANSIT" | "DONE" | "CANCELLED";

/** Складов на предприятие. Сеть с сотней полок — отдельный разговор, не умолчание. */
export const MAX_WAREHOUSES = 50;
/** Движений в сутки на предприятие: тот же приём, что `DAILY_EDITS` у паспортов. */
export const DAILY_MOVEMENTS = 500;
/** Причина поправки — не короче порога причины отказа в комплайнсе. */
export const REASON_CHARS = 3;

export function isWarehouseKind(value: string): value is WarehouseKind {
  return (WAREHOUSE_KINDS as readonly string[]).includes(value);
}

export function isMoveKind(value: string): value is MoveKind {
  return (MOVE_KINDS as readonly string[]).includes(value);
}

type Ok = { ok: true };
type Bad<R extends string> = { ok: false; reason: R };

export type WarehouseInput = {
  kind: WarehouseKind;
  name: string;
  pointId: string | null;
  online: boolean;
  countryCode: string | null;
  address: string | null;
};

export type WarehouseReason = "name_required" | "shelf_needs_place" | "point_unknown" | "point_not_allowed" | "too_many";

/**
 * Полка — это склад с адресом, а не отдельная сущность. Поэтому у неё обязательно есть
 * место: точка продаж или онлайн. Полка, которая нигде не стоит, обещала бы покупателю
 * место, которого нет, — а раздел «где взять» считается ровно по полкам.
 */
export function validateWarehouse(
  input: WarehouseInput,
  ctx: { count: number; pointIds: readonly string[] },
): Ok | Bad<WarehouseReason> {
  if (!input.name.trim()) return { ok: false, reason: "name_required" };
  if (ctx.count >= MAX_WAREHOUSES) return { ok: false, reason: "too_many" };
  if (input.pointId) {
    // Точка — место продажи; у оптового и стороннего склада её быть не может, иначе
    // чужой товар встал бы на карту витриной.
    if (input.kind !== "SHELF") return { ok: false, reason: "point_not_allowed" };
    if (!ctx.pointIds.includes(input.pointId)) return { ok: false, reason: "point_unknown" };
  }
  if (input.kind === "SHELF" && !input.pointId && !input.online) {
    return { ok: false, reason: "shelf_needs_place" };
  }
  return { ok: true };
}

/**
 * Склад не удаляется, а архивируется: движения по нему уже записаны. Но архивировать
 * склад с остатком нельзя — товар исчез бы молча, вместе с местом, где он лежит.
 */
export function canArchiveWarehouse(totalQty: number): Ok | Bad<"warehouse_not_empty"> {
  return totalQty === 0 ? { ok: true } : { ok: false, reason: "warehouse_not_empty" };
}

export type MovementInput = {
  kind: MoveKind;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  qty: number;
  note: string | null;
  /** Назван перевозчик — значит товар уедет и приедет не сразу. */
  carrierName: string | null;
};

export type MovementReason =
  | "to_required"
  | "from_required"
  | "same_warehouse"
  | "qty_zero"
  | "qty_negative"
  | "reason_required";

export function validateMovement(input: MovementInput): Ok | Bad<MovementReason> {
  if (!Number.isFinite(input.qty) || input.qty === 0) return { ok: false, reason: "qty_zero" };
  // Отрицательное количество принимает только поправка: «минус три» прихода — это
  // расход, набранный не в то поле, и угадывать за человека мы не станем.
  if (input.qty < 0 && input.kind !== "ADJUST") return { ok: false, reason: "qty_negative" };

  const needsFrom = input.kind === "ISSUE" || input.kind === "TRANSFER";
  const needsTo = input.kind === "RECEIPT" || input.kind === "TRANSFER" || input.kind === "ADJUST";
  if (needsFrom && !input.fromWarehouseId) return { ok: false, reason: "from_required" };
  if (needsTo && !input.toWarehouseId) return { ok: false, reason: "to_required" };
  if (input.kind === "TRANSFER" && input.fromWarehouseId === input.toWarehouseId) {
    return { ok: false, reason: "same_warehouse" };
  }
  // «Нашлось на три меньше» без слов через год не значит ничего — то же правило, что у
  // пункта проверки «не применимо» в комплайнсе.
  if (input.kind === "ADJUST" && (input.note ?? "").trim().length < REASON_CHARS) {
    return { ok: false, reason: "reason_required" };
  }
  return { ok: true };
}

export type Delta = { warehouseId: string; delta: number };
export type MovementPlan = { status: MoveStatus; deltas: Delta[] };

/**
 * Что движение делает с остатками. Перемещение с перевозчиком списывает с источника
 * сразу, а приёмнику не зачисляет ничего: пока товар едет, он не лежит ни на одной
 * полке, и «в пути» — своё число (см. `transitTotals`).
 */
export function movementPlan(input: MovementInput): MovementPlan {
  switch (input.kind) {
    case "RECEIPT":
      return { status: "DONE", deltas: [{ warehouseId: input.toWarehouseId!, delta: input.qty }] };
    case "ISSUE":
      return { status: "DONE", deltas: [{ warehouseId: input.fromWarehouseId!, delta: -input.qty }] };
    case "ADJUST":
      return { status: "DONE", deltas: [{ warehouseId: input.toWarehouseId!, delta: input.qty }] };
    case "TRANSFER":
      return input.carrierName && input.carrierName.trim()
        ? { status: "IN_TRANSIT", deltas: [{ warehouseId: input.fromWarehouseId!, delta: -input.qty }] }
        : {
            status: "DONE",
            deltas: [
              { warehouseId: input.fromWarehouseId!, delta: -input.qty },
              { warehouseId: input.toWarehouseId!, delta: input.qty },
            ],
          };
  }
}

type TransitRow = { status: MoveStatus; toWarehouseId: string | null; fromWarehouseId: string | null; qty: number };

/** Приём: товар доехал и лёг на полку. Второй приём той же записи запрещён — иначе
 * один и тот же товар приедет дважды. */
export function receivePlan(row: TransitRow): { ok: true; deltas: Delta[] } | Bad<"not_in_transit"> {
  if (row.status !== "IN_TRANSIT" || !row.toWarehouseId) return { ok: false, reason: "not_in_transit" };
  return { ok: true, deltas: [{ warehouseId: row.toWarehouseId, delta: row.qty }] };
}

/** Отмена — встречное движение, а не удаление: журнал неизменяем. Доехавшее не
 * отменяется, его возвращают расходом или поправкой. */
export function cancelPlan(row: TransitRow): { ok: true; deltas: Delta[] } | Bad<"not_cancellable"> {
  if (row.status !== "IN_TRANSIT" || !row.fromWarehouseId) return { ok: false, reason: "not_cancellable" };
  return { ok: true, deltas: [{ warehouseId: row.fromWarehouseId, delta: row.qty }] };
}

/**
 * Остаток в минус не уходит. Исключение — поправка: пересчёт вправе обнаружить дыру, и
 * запретить ему значило бы заставить кладовщика врать. Везде иначе отрицательный остаток
 * — ошибка ввода, и принять её значит обещать покупателю «в наличии».
 */
export function checkStock(
  deltas: readonly Delta[],
  balances: Readonly<Record<string, number>>,
  kind: MoveKind,
): Ok | Bad<"insufficient_stock"> {
  if (kind === "ADJUST") return { ok: true };
  for (const d of deltas) {
    if (d.delta >= 0) continue;
    const have = balances[d.warehouseId] ?? 0;
    if (have + d.delta < 0) return { ok: false, reason: "insufficient_stock" };
  }
  return { ok: true };
}

/** «В пути» по товарам: считается по `IN_TRANSIT`, а не по всем движениям. */
export function transitTotals(
  rows: readonly { status: MoveStatus; qty: number; productId: string }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.status !== "IN_TRANSIT") continue;
    out[r.productId] = (out[r.productId] ?? 0) + r.qty;
  }
  return out;
}
