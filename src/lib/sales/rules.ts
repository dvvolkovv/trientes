/**
 * Правила кассы — чистые, без Prisma. Спека
 * `docs/superpowers/specs/2026-11-25-merchant-sales-receipts-design.md`, раздел 3.
 *
 * Главное решение слайса живёт здесь: продажа — это **уход товара с полки и чек**, а не
 * платёж. Денег сайт не двигает (эквайринг в ТЗ исключён из объёма разработки), поэтому
 * способ оплаты и курс — заявление продавца, а не наблюдённый нами факт.
 */
import { CASHBACK_MAX, CASHBACK_MIN, OFFER_CURRENCIES, isServiceUnit, parseAmount } from "@/lib/products/offers-rules";
import { checkAddress, checkTxHash } from "@/lib/crypto-ledger/address";

export const SALE_PAYMENTS = ["CASH", "CARD", "TRANSFER", "CRYPTO", "OTHER"] as const;
export type SalePayment = (typeof SALE_PAYMENTS)[number];

/** Строк в чеке — столько, сколько человек проверит глазами на экране телефона. */
export const MAX_SALE_LINES = 50;
/** Чеков в сутки на предприятие: тот же приём, что `DAILY_MOVEMENTS` в BC. */
export const DAILY_SALES = 500;
/** Причина отмены — не короче порога причины отказа в комплайнсе. */
export const REASON_CHARS = 3;
/** Ссылка на чек живёт месяц: покупатель приходит за ней не в ту же минуту. */
export const RECEIPT_TTL_DAYS = 30;

/**
 * Единицы, которые работа, а не товар. Такая строка с полки не списывается и полки не
 * требует. Угадывать «есть ли строка остатка» нельзя: кончившаяся полка тоже имеет
 * строку, только с нулём. Набор живёт в правилах предложения — там же его читает
 * витрина, и вторая копия разошлась бы с первой.
 */
export function isService(unit: string): boolean {
  return isServiceUnit(unit);
}

export function isSalePayment(value: string): value is SalePayment {
  return (SALE_PAYMENTS as readonly string[]).includes(value);
}

/**
 * Количество с клавиатуры телефона: запятая и точка значат одно. Три знака после
 * запятой — предел склада (`Decimal(18,3)`), дальше это не количество, а опечатка.
 */
export function parseQty(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,3})?$/.test(text)) return null;
  const value = Number(text);
  return value > 0 ? value : null;
}

/** Копейки: считаем в целых сотых и округляем от половины вверх. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export type SaleLineInput = {
  productId: string;
  qty: string;
  /** Пусто — продаём по витринной цене. */
  price: string;
};

export type OfferedProduct = {
  productId: string;
  name: string;
  unit: string;
  currency: string;
  listPrice: number;
  /** Действующая ставка: товар → категория → предприятие (`effectiveCashback`). */
  cashbackPercent: number | null;
};

export type SaleLineValue = {
  productId: string;
  name: string;
  unit: string;
  qty: number;
  listPrice: number;
  price: number;
  cashbackPercent: number | null;
  cashbackAmount: number;
  /** Товарная строка списывается с полки; услуга — нет. */
  stocked: boolean;
};

export type SaleTotals = {
  currency: string;
  listTotal: number;
  total: number;
  discount: number;
  cashbackTotal: number;
};

export type SaleReason =
  | "lines_required"
  | "too_many_lines"
  | "duplicate_line"
  | "offer_missing"
  | "qty_invalid"
  | "price_invalid"
  | "price_above_list"
  | "currency_mismatch"
  | "currency_unknown"
  | "payment_invalid"
  | "coin_required"
  | "rate_invalid"
  | "pay_address_invalid"
  | "pay_tx_invalid"
  | "shelf_required"
  | "daily_limit";

export type SaleInput = {
  lines: readonly SaleLineInput[];
  payment: string;
  payCoin: string | null;
  payRate: string | null;
  payCoinAmount: string | null;
  /** Слайс CR: адрес получения и хеш транзакции — необязательные факты для книги. */
  payAddress?: string | null;
  payTxHash?: string | null;
  /** Полка выбрана или нет — услуге она не нужна. */
  hasShelf: boolean;
};

export type SaleValue = {
  lines: SaleLineValue[];
  totals: SaleTotals;
  payment: SalePayment;
  payCoin: string | null;
  payRate: number | null;
  payCoinAmount: number | null;
  payAddress: string | null;
  payTxHash: string | null;
};

type Bad = { ok: false; reason: SaleReason };

/** Курс и сумма в монете — числа продавца, и их может не быть: он знает не всегда. */
function parsePayNumber(raw: string | null): number | null {
  const text = (raw ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d{1,8})?$/.test(text)) return null;
  const value = Number(text);
  return value > 0 ? value : null;
}

/**
 * Разбор чека целиком. Цена подставляется из предложения продавца и может быть
 * **понижена** — продажа по согласованной цене бывает, и тогда скидка выводится
 * вычитанием. Поднять её выше витринной нельзя: витрина — обещание покупателю.
 */
export function validateSale(
  input: SaleInput,
  ctx: { offers: readonly OfferedProduct[]; salesToday: number },
): { ok: true; value: SaleValue } | Bad {
  if (!isSalePayment(input.payment)) return { ok: false, reason: "payment_invalid" };
  if (ctx.salesToday >= DAILY_SALES) return { ok: false, reason: "daily_limit" };
  if (input.lines.length === 0) return { ok: false, reason: "lines_required" };
  if (input.lines.length > MAX_SALE_LINES) return { ok: false, reason: "too_many_lines" };

  const byProduct = new Map(ctx.offers.map((o) => [o.productId, o]));
  const seen = new Set<string>();
  const lines: SaleLineValue[] = [];
  let currency: string | null = null;

  for (const raw of input.lines) {
    const offer = byProduct.get(raw.productId);
    // Продаётся только товар с живым предложением: у цены один автор (правило BC), а
    // предложение на паузе означает «сейчас не продаём».
    if (!offer) return { ok: false, reason: "offer_missing" };
    if (seen.has(offer.productId)) return { ok: false, reason: "duplicate_line" };
    seen.add(offer.productId);

    if (currency === null) currency = offer.currency;
    else if (currency !== offer.currency) return { ok: false, reason: "currency_mismatch" };

    const qty = parseQty(raw.qty);
    if (qty === null) return { ok: false, reason: "qty_invalid" };

    const typed = raw.price.trim();
    let price = offer.listPrice;
    if (typed) {
      const parsed = parseAmount(typed);
      if (parsed === null) return { ok: false, reason: "price_invalid" };
      if (parsed > offer.listPrice) return { ok: false, reason: "price_above_list" };
      price = parsed;
    }

    const sum = round2(price * qty);
    const rate = offer.cashbackPercent;
    const rateOk = rate !== null && rate >= CASHBACK_MIN && rate <= CASHBACK_MAX;
    lines.push({
      productId: offer.productId,
      name: offer.name,
      unit: offer.unit,
      qty,
      listPrice: offer.listPrice,
      price,
      cashbackPercent: rateOk ? rate : null,
      cashbackAmount: rateOk ? round2((sum * rate!) / 100) : 0,
      stocked: !isService(offer.unit),
    });
  }

  // Валюта пришла из нашей же строки предложения, но чек её печатает и форматирует:
  // незнакомая валюта — своя беда со своими словами, а не «строки не сошлись».
  if (!currency) return { ok: false, reason: "currency_mismatch" };
  if (!(OFFER_CURRENCIES as readonly string[]).includes(currency)) {
    return { ok: false, reason: "currency_unknown" };
  }
  // Товарная строка без полки не знает, откуда ушёл товар; чек только из услуг полки не
  // требует вовсе.
  if (lines.some((l) => l.stocked) && !input.hasShelf) return { ok: false, reason: "shelf_required" };

  let payCoin: string | null = null;
  let payRate: number | null = null;
  let payCoinAmount: number | null = null;
  let payAddress: string | null = null;
  let payTxHash: string | null = null;
  if (input.payment === "CRYPTO") {
    const coin = (input.payCoin ?? "").trim().toUpperCase();
    // Монета обязательна: «оплачено криптой» без имени монеты не говорит ничего, а ТЗ
    // § 5.2 требует в чеке обе суммы.
    if (!/^[A-Z0-9]{2,12}$/.test(coin)) return { ok: false, reason: "coin_required" };
    payCoin = coin;
    payRate = parsePayNumber(input.payRate);
    payCoinAmount = parsePayNumber(input.payCoinAmount);
    if ((input.payRate ?? "").trim() && payRate === null) return { ok: false, reason: "rate_invalid" };
    if ((input.payCoinAmount ?? "").trim() && payCoinAmount === null) return { ok: false, reason: "rate_invalid" };

    // Слайс CR: адрес и хеш — необязательные факты, но набранные обязаны быть похожи на
    // себя. Опечатка в адресе делает запись книги бессмысленной, а сверку с санкционным
    // списком — пустой: несуществующий адрес в списке не найдётся никогда.
    const addressText = (input.payAddress ?? "").trim();
    if (addressText) {
      const checked = checkAddress(addressText, coin);
      if (!checked.ok) return { ok: false, reason: "pay_address_invalid" };
      payAddress = checked.address;
    }
    const hash = checkTxHash(input.payTxHash ?? "");
    if (!hash.ok) return { ok: false, reason: "pay_tx_invalid" };
    payTxHash = hash.value || null;
  }

  return {
    ok: true,
    value: {
      lines,
      totals: saleTotals(currency, lines),
      payment: input.payment,
      payCoin,
      payRate,
      payCoinAmount,
      payAddress,
      payTxHash,
    },
  };
}

export function saleTotals(currency: string, lines: readonly SaleLineValue[]): SaleTotals {
  let listTotal = 0;
  let total = 0;
  let cashbackTotal = 0;
  for (const l of lines) {
    listTotal = round2(listTotal + round2(l.listPrice * l.qty));
    total = round2(total + round2(l.price * l.qty));
    cashbackTotal = round2(cashbackTotal + l.cashbackAmount);
  }
  return { currency, listTotal, total, discount: round2(listTotal - total), cashbackTotal };
}

/** Что уходит с полки: только товарные строки, по одному движению на строку. */
export function stockDeltas(lines: readonly SaleLineValue[]): { productId: string; qty: number }[] {
  return lines.filter((l) => l.stocked).map((l) => ({ productId: l.productId, qty: l.qty }));
}

export type SaleGateCompany = {
  suspendedAt: Date | null;
  deletedAt: Date | null;
  permissions: Readonly<Record<string, string | undefined>>;
};

export type SaleRights = { see: boolean; sell: boolean };

/**
 * Листинга касса не требует (приём BF): это внутренняя работа — уход товара и своя
 * книга. Наружу смотрит только копия покупателю, и её привязку листинг требует
 * (`canClaimReceipt`). Снятое надзором или удалённое предприятие — только чтение.
 */
export function saleRightsFor(company: SaleGateCompany | null | undefined): SaleRights {
  if (!company) return { see: false, sell: false };
  const level = company.permissions?.sales;
  const active = !company.suspendedAt && !company.deletedAt;
  return { see: level === "VIEW" || level === "EDIT", sell: active && level === "EDIT" };
}

/**
 * Можно ли привязать чек к кабинету покупателя. Страница по ссылке — дело того, кто её
 * держит, а строка в чужом кабинете — наше: её ставит только залистованное и не снятое
 * надзором предприятие.
 */
export function canClaimReceipt(input: {
  status: "PENDING" | "APPROVED" | "REJECTED";
  suspendedAt: Date | null;
  deletedAt: Date | null;
  expiresAt: Date | null;
  now: Date;
}): { ok: true } | { ok: false; reason: "company_not_listed" | "link_expired" } {
  if (input.status !== "APPROVED" || input.suspendedAt || input.deletedAt) {
    return { ok: false, reason: "company_not_listed" };
  }
  if (input.expiresAt && input.expiresAt.getTime() < input.now.getTime()) {
    return { ok: false, reason: "link_expired" };
  }
  return { ok: true };
}

export function cancelAllowed(input: { status: "COMPLETED" | "CANCELLED"; reason: string }):
  | { ok: true }
  | { ok: false; reason: "already_cancelled" | "reason_required" } {
  if (input.status !== "COMPLETED") return { ok: false, reason: "already_cancelled" };
  if (input.reason.trim().length < REASON_CHARS) return { ok: false, reason: "reason_required" };
  return { ok: true };
}
