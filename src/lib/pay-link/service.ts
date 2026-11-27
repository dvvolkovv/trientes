/**
 * Служба оплаты глазами сайта: единственный запрос `GET https://pay.trientes.com/link/<номер>`
 * (задание, § 2.2). Ни ключей, ни секретов, ни сессии кабинета у нас нет и не будет.
 *
 * Хост **постоянный** и не берётся ни из ввода, ни из окружения: адрес собирается уже
 * после того, как номер прошёл разбор (`parsePayLinkInput`), поэтому в путь не может
 * попасть ни косая черта, ни точка-точка.
 *
 * Ответ читается строго — как его читает сам экран оплаты: поле не той формы делает
 * ответ не ответом, а не поводом догадаться (правило `parseDonateTerms`). Непроверенное
 * не сохраняется, поэтому у чтения три разных исхода, и путать их нельзя: «ссылка
 * выключена», «такой ссылки нет» и «попробуйте позже».
 */
import { cleanDisplay, TITLE_MAX } from "@/lib/pay-link/text";
import { PAY_LINK_ID } from "@/lib/pay-link/parse";

/** Служба оплаты. Постоянная строка — не ключ окружения. */
export const PAY_LINK_API = "https://pay.trientes.com";
/** Запрос ждёт пять секунд: его делает человек, нажавший «Проверить». */
export const LINK_TIMEOUT_MS = 5_000;
/** Ответ не больше 64 КБ: это описание одной ссылки, а не выгрузка. */
export const LINK_MAX_BYTES = 64 * 1024;

/** Номер магазина, как его делает служба оплаты. */
export const MERCHANT_ID = /^m_[0-9A-Za-z]+$/;

export type PayUnit = "usd" | "coin";

export type PayLinkInfo = {
  merchantId: string;
  /** Имя магазина — слово владельца ссылки, уже очищенное. Защитой не является. */
  merchant: string;
  /** Название ссылки для показа (до 80); код ищется в `rawTitle`. */
  title: string;
  /** Название как его отдала служба, до 200 знаков и без очистки длины. */
  rawTitle: string;
  unit: PayUnit;
  coinSymbol: string | null;
  /** Сумма как строка; `null` — сумму выбирает покупатель. */
  amount: string | null;
};

export type LinkOutcome =
  /** Ссылка есть и принимает платежи. */
  | { kind: "ok"; info: PayLinkInfo }
  /** 200, но `accepting: false` — ссылка выключена в кабинете. */
  | { kind: "off" }
  /** 404 — такой ссылки нет. */
  | { kind: "missing" }
  /**
   * Нет ответа, ответ не той формы или в нём нет номера магазина. Номер служба
   * отдаёт, только когда открыто подключение магазинов, — то есть «позже» тут честнее
   * любого другого слова, и сохранять нечего.
   */
  | { kind: "later" };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Разбор тела ответа. `null` — ответ не той формы; `{accepting:false}` — выключена.
 * Строгость здесь и есть защита: на сохранение идёт только то, что служба подтвердила.
 */
export function parseLinkPayload(raw: unknown): { accepting: false } | { accepting: true; info: PayLinkInfo } | null {
  if (!isObj(raw)) return null;
  // Именно `true`, а не «похоже на правду»: `"true"`, `1` и `{}` приняты не будут.
  if (raw.accepting === false) return { accepting: false };
  if (raw.accepting !== true) return null;

  const merchantId = raw.merchant_id;
  if (typeof merchantId !== "string" || !MERCHANT_ID.test(merchantId)) return null;

  const unit = raw.unit;
  if (unit !== "usd" && unit !== "coin") return null;

  let coinSymbol: string | null = null;
  if (unit === "coin") {
    if (!isObj(raw.coin)) return null;
    const symbol = raw.coin.symbol;
    if (typeof symbol !== "string" || symbol === "") return null;
    // Символ монеты — тоже слово владельца ссылки (§ 2.8), поэтому чистится.
    coinSymbol = cleanDisplay(symbol, 16);
    if (coinSymbol === "") return null;
  }

  const amount = raw.amount;
  if (amount !== null && typeof amount !== "string") return null;

  const merchant = raw.merchant;
  const title = raw.title;
  if (typeof merchant !== "string" || typeof title !== "string") return null;
  if (title.length > TITLE_MAX) return null;

  return {
    accepting: true,
    info: {
      merchantId,
      merchant: cleanDisplay(merchant),
      title: cleanDisplay(title),
      rawTitle: title,
      unit,
      coinSymbol,
      amount: amount === null ? null : cleanDisplay(amount, 32),
    },
  };
}

/**
 * Тело ответа с потолком. Читаем потоком, а не `text()`: заявленная длина бывает
 * пустой, а обещание «не больше 64 КБ» должно держаться и тогда.
 */
async function readCapped(res: Response, max: number): Promise<string | null> {
  const declared = res.headers.get("content-length");
  if (declared !== null && Number(declared) > max) return null;
  const body = res.body;
  if (!body) {
    const text = await res.text();
    return text.length > max ? null : text;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/**
 * Спросить службу о ссылке. По редиректам **не идём** (`redirect: "manual"`): 30x с
 * нашего постоянного хоста означал бы, что отвечает не та служба, с которой мы
 * договаривались, — и это «позже», а не «нет ссылки».
 */
export async function fetchPayLink(
  linkId: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<LinkOutcome> {
  if (!PAY_LINK_ID.test(linkId)) return { kind: "later" };
  const call = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await call(`${PAY_LINK_API}/link/${linkId}`, {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(LINK_TIMEOUT_MS),
    });
  } catch {
    return { kind: "later" };
  }
  if (res.status === 404) return { kind: "missing" };
  if (!res.ok) return { kind: "later" };
  const text = await readCapped(res, LINK_MAX_BYTES).catch(() => null);
  if (text === null) return { kind: "later" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { kind: "later" };
  }
  const parsed = parseLinkPayload(raw);
  if (parsed === null) return { kind: "later" };
  if (!parsed.accepting) return { kind: "off" };
  return { kind: "ok", info: parsed.info };
}
