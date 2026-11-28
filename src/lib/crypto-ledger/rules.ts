/**
 * Правила книги криптоучёта — чистые, без Prisma (слайс CR, раздел 5 спеки
 * `docs/superpowers/specs/2026-11-28-merchant-crypto-accounting-design.md`).
 *
 * Главное, что здесь закреплено: фиатная сторона операции — **заявление продавца**, а не
 * наш расчёт. Курс может быть ему неизвестен (перевод между своими кошельками), и тогда
 * операция в курсовую разницу не идёт вовсе — ноль заявлял бы измерение, которого не
 * было (прецедент `levelFor(null)` в BD).
 */
import { OFFER_CURRENCIES } from "@/lib/products/offers-rules";
import { checkAddress, checkTxHash, type AddressFamily } from "@/lib/crypto-ledger/address";

export const CRYPTO_OP_KINDS = ["RECEIPT", "CONVERSION", "WITHDRAWAL"] as const;
export type CryptoOpKind = (typeof CRYPTO_OP_KINDS)[number];

/** Адресов на предприятие: столько, сколько человек проверит глазами в списке. */
export const MAX_CRYPTO_ADDRESSES = 50;
/** Операций в сутки: счёт до работы, тот же приём, что `DAILY_MOVEMENTS` в BC. */
export const DAILY_CRYPTO_OPS = 300;
/** Метка адреса и примечание операции — строки для человека, а не документы. */
export const LABEL_MAX = 80;
export const NOTE_MAX = 500;
/** Тикер монеты: тот же вид, что в кассе (`coin_required` в CK). */
const COIN_RE = /^[A-Z0-9]{2,12}$/;

export type CryptoAddressInput = { coin: string; address: string; label: string };
export type CryptoAddressValue = {
  coin: string;
  address: string;
  addressKey: string;
  /** `null` — семью сети по тикеру мы не знаем, и формат **не проверен**. */
  family: AddressFamily | null;
  label: string | null;
};

export type CryptoAddressReason =
  | "coin_invalid"
  | "label_too_long"
  | "too_many_addresses"
  | "address_empty"
  | "address_too_short"
  | "address_too_long"
  | "address_invalid"
  | "address_wrong_network";

export function validateCryptoAddress(
  input: CryptoAddressInput,
  ctx: { addressCount: number },
): { ok: true; value: CryptoAddressValue } | { ok: false; reason: CryptoAddressReason } {
  const coin = input.coin.trim().toUpperCase();
  if (!COIN_RE.test(coin)) return { ok: false, reason: "coin_invalid" };
  const label = input.label.trim();
  if (label.length > LABEL_MAX) return { ok: false, reason: "label_too_long" };
  if (ctx.addressCount >= MAX_CRYPTO_ADDRESSES) return { ok: false, reason: "too_many_addresses" };

  const checked = checkAddress(input.address, coin);
  if (!checked.ok) return { ok: false, reason: checked.reason };

  return {
    ok: true,
    value: {
      coin,
      address: checked.address,
      addressKey: checked.key,
      family: checked.family,
      label: label || null,
    },
  };
}

export type CryptoOpInput = {
  kind: string;
  coin: string;
  amount: string;
  rate: string;
  currency: string;
  happenedAt: string;
  address: string;
  txHash: string;
  note: string;
};

export type CryptoOpValue = {
  kind: CryptoOpKind;
  coin: string;
  amount: number;
  rate: number | null;
  currency: string;
  /** Фиатная сумма **выводится** из курса, а не набирается рядом: два числа, которые
   * обязаны сходиться, расходятся в первый же день. Нет курса — нет и фиатной суммы. */
  fiatAmount: number | null;
  happenedAt: Date;
  address: string | null;
  txHash: string | null;
  note: string | null;
};

export type CryptoOpReason =
  | "kind_invalid"
  | "coin_invalid"
  | "amount_invalid"
  | "rate_invalid"
  | "currency_unknown"
  | "date_invalid"
  | "date_future"
  | "note_too_long"
  | "tx_invalid"
  | "daily_limit"
  | "address_empty"
  | "address_too_short"
  | "address_too_long"
  | "address_invalid"
  | "address_wrong_network";

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Числа с клавиатуры телефона: запятая и точка значат одно. Восемь знаков — предел
 * колонки монеты (`Decimal(28,8)`), дальше это не сумма, а опечатка. */
export function parseCoinAmount(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (!/^\d{1,18}(\.\d{1,8})?$/.test(text)) return null;
  const value = Number(text);
  return value > 0 ? value : null;
}

export function validateCryptoOp(
  input: CryptoOpInput,
  ctx: { opsToday: number; now: Date },
): { ok: true; value: CryptoOpValue } | { ok: false; reason: CryptoOpReason } {
  if (!(CRYPTO_OP_KINDS as readonly string[]).includes(input.kind)) {
    return { ok: false, reason: "kind_invalid" };
  }
  if (ctx.opsToday >= DAILY_CRYPTO_OPS) return { ok: false, reason: "daily_limit" };

  const coin = input.coin.trim().toUpperCase();
  if (!COIN_RE.test(coin)) return { ok: false, reason: "coin_invalid" };

  const amount = parseCoinAmount(input.amount);
  if (amount === null) return { ok: false, reason: "amount_invalid" };

  const currency = input.currency.trim().toUpperCase();
  if (!(OFFER_CURRENCIES as readonly string[]).includes(currency)) {
    return { ok: false, reason: "currency_unknown" };
  }

  let rate: number | null = null;
  const rateText = input.rate.trim();
  if (rateText) {
    rate = parseCoinAmount(rateText);
    if (rate === null) return { ok: false, reason: "rate_invalid" };
  }

  // Дата — день, а не час: часового пояса у операции нет, и «в 18:00» означало бы
  // неизвестно чей вечер (разбор BF про срок задачи и BN про часы магазина).
  const dayText = input.happenedAt.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayText)) return { ok: false, reason: "date_invalid" };
  const happenedAt = new Date(`${dayText}T12:00:00.000Z`);
  if (Number.isNaN(happenedAt.getTime())) return { ok: false, reason: "date_invalid" };
  // Полдня запаса: день по местному времени может начаться раньше нашей полуночи.
  if (happenedAt.getTime() > ctx.now.getTime() + 36 * 3600_000) {
    return { ok: false, reason: "date_future" };
  }

  const note = input.note.trim();
  if (note.length > NOTE_MAX) return { ok: false, reason: "note_too_long" };

  const hash = checkTxHash(input.txHash);
  if (!hash.ok) return { ok: false, reason: "tx_invalid" };

  let address: string | null = null;
  if (input.address.trim()) {
    const checked = checkAddress(input.address, coin);
    if (!checked.ok) return { ok: false, reason: checked.reason };
    address = checked.address;
  }

  return {
    ok: true,
    value: {
      kind: input.kind as CryptoOpKind,
      coin,
      amount,
      rate,
      currency,
      fiatAmount: rate === null ? null : round2(amount * rate),
      happenedAt,
      address,
      txHash: hash.value || null,
      note: note || null,
    },
  };
}

export type CryptoGateCompany = {
  suspendedAt: Date | null;
  deletedAt: Date | null;
  permissions: Readonly<Record<string, string | undefined>>;
};

export type CryptoRights = { see: boolean; write: boolean };

/**
 * Права. Своего раздела у криптоучёта нет — работает `reports` (CL): книга монет это
 * бухгалтерия, и ведёт её тот же человек, который видит чеки и выгружает их для
 * консультанта. Почему не «только владельцу», как приём платежей в CP: там правится
 * получатель денег, а здесь — запись о том, что уже произошло.
 */
export function cryptoRightsFor(company: CryptoGateCompany | null | undefined): CryptoRights {
  if (!company) return { see: false, write: false };
  const level = company.permissions?.reports;
  const active = !company.suspendedAt && !company.deletedAt;
  return { see: level === "VIEW" || level === "EDIT", write: active && level === "EDIT" };
}
