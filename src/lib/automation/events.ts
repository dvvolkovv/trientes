/**
 * Словарь событий предприятия (слайс CO, ТЗ 6.7 «событийная архитектура»). Чистый
 * модуль: ни Prisma, ни сети.
 *
 * Список один на три двери — правила, исходящие оповещения и `GET /api/merchant/v1/events`.
 * Второй словарь «для внешних систем» разошёлся бы с первым (болезнь списка локалей из
 * уборки AU), поэтому его нет.
 *
 * Словарь живёт в коде, а не в enum базы: новый вид события не должен требовать
 * миграции, а негодный отсекается разбором — то же решение, что у листа проверок в AP.
 */

export const AUTOMATION_EVENTS = [
  "SALE_RECORDED",
  "SALE_CANCELLED",
  "STOCK_LOW",
  "STOCK_OUT",
  "ORDER_RECEIVED",
  "CUSTOMER_MESSAGE",
] as const;
export type AutomationEvent = (typeof AUTOMATION_EVENTS)[number];

export function isAutomationEvent(value: string): value is AutomationEvent {
  return (AUTOMATION_EVENTS as readonly string[]).includes(value);
}

/**
 * Откуда событие. `RULE` — следствие действия правила, и такое событие правил **не
 * запускает**: иначе «задача → задача» крутится вечно и первая же ошибка в условиях
 * съедает суточный потолок задач. Один шаг — весь договор слайса.
 */
export const EVENT_SOURCES = ["SYSTEM", "RULE"] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

/**
 * Снимок фактов события. Имена сняты **на момент события**: по ним правило подставляет
 * слова в задачу, и повтор доставки через шесть часов обязан нести то же тело, даже если
 * товар с тех пор переименовали.
 *
 * Поля необязательные все: у события «кончился товар» нет ни номера, ни суммы, и
 * выдумывать им нули значило бы заявить измерение, которого не было (правило BD о
 * `levelFor(null)`).
 */
export type EventData = {
  /** Касса: номер чека, суммы, способ оплаты продавца. */
  number?: number;
  total?: number;
  currency?: string;
  payment?: string;
  cashbackTotal?: number;
  lines?: { productId: string; name: string; qty: number }[];

  /** Место и полка. */
  pointId?: string | null;
  pointName?: string | null;
  warehouseId?: string | null;
  warehouseName?: string | null;

  /** Товар — у остатка и у строки чека. */
  productId?: string | null;
  productName?: string | null;
  productSlug?: string | null;
  qty?: number;
  onHand?: number;
  minQty?: number;

  /** Поставка. */
  orderId?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;

  /** Покупатель. Имя — `@имя-входа`: наружу человек виден им (решение BT). */
  threadId?: string | null;
  customerName?: string | null;
  firstMessage?: boolean;

  /** Отмена чека и отказ поставщика. */
  reason?: string | null;
};

export type AutomationEventRecord = {
  id: string;
  kind: AutomationEvent;
  source: EventSource;
  subject: string | null;
  data: EventData;
  createdAt: Date;
};

/** Разбор данных события из JSONB. Негодное тело — пустой снимок, а не падение. */
export function parseEventData(raw: unknown): EventData {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as EventData;
}

/**
 * Подстановки, доступные тексту действия. Набор зависит от триггера, и форма показывает
 * его рядом с полем: человек не обязан помнить, что у «кончился товар» нет номера чека.
 */
export const EVENT_VARS: Record<AutomationEvent, readonly string[]> = {
  SALE_RECORDED: ["number", "total", "currency", "point", "warehouse"],
  SALE_CANCELLED: ["number", "total", "currency", "reason"],
  STOCK_LOW: ["product", "warehouse", "point", "onHand", "minQty"],
  STOCK_OUT: ["product", "warehouse", "point"],
  ORDER_RECEIVED: ["supplier", "warehouse"],
  CUSTOMER_MESSAGE: ["customer"],
};

/** Значения подстановок события. Пустое поле даёт пустую строку, а не слово «null». */
export function eventVars(data: EventData): Record<string, string> {
  const num = (value: number | undefined) =>
    value === undefined || value === null ? "" : String(Number(value.toFixed(3)));
  return {
    number: data.number === undefined ? "" : `#${data.number}`,
    total: num(data.total),
    currency: data.currency ?? "",
    payment: data.payment ?? "",
    point: data.pointName ?? "",
    warehouse: data.warehouseName ?? "",
    product: data.productName ?? "",
    qty: num(data.qty),
    onHand: num(data.onHand),
    minQty: num(data.minQty),
    supplier: data.supplierName ?? "",
    customer: data.customerName ?? "",
    reason: data.reason ?? "",
  };
}
