import { cacheGet, cacheSet } from "@/lib/exchange-cache";

/**
 * Пожертвования на главной.
 *
 * Деньги берёт не сайт, а экран обмена (`/exchange/#/donate`, отдельный
 * репозиторий `trientes-dex-ui`): он создаёт черновик счёта у службы оплаты
 * (`POST /donate/<магазин>`) и ведёт человека на страницу платежа счёта, как
 * любого покупателя. Автор денежной заявки один, и второго здесь не будет:
 * главная только зовёт и называет суммы.
 *
 * Зовёт она честно, поэтому условия всё-таки читаются (`GET /donate/<магазин>`):
 * сегодняшние пределы ходят за запасом монеты выплаты и её ценой (18 ноября это
 * было «от 10 до 75,84 $»), и предложить $100 значило бы отправить человека на
 * отказ. Если служба молчит, отвечает не своей формой или пожертвования закрыты
 * — раздел не показывается вовсе: приглашение, ведущее на «сейчас не
 * принимаем», хуже отсутствия приглашения.
 *
 * Читаем только те поля, которые показываем, и читаем строго — как их читает
 * сам экран обмена: поле не той формы делает ответ не ответом, а не поводом
 * догадаться.
 */

/** Служба оплаты (`pay` файла выкладки обмена) — источник условий. */
const PAY_API = (process.env.DONATE_PAY_API ?? "").trim().replace(/\/+$/, "");
/** Магазин пожертвований (`donate` того же файла). */
const MERCHANT = (process.env.DONATE_MERCHANT ?? "").trim();

/** Адрес службы: только https и только начало адреса — ни пути, ни запроса. */
const PAY_ORIGIN = /^https:\/\/[a-z0-9.-]+(:\d+)?$/;
/** Номер магазина, как его делает служба оплаты (`MERCHANT_ID` в DEX). */
const MERCHANT_ID = /^m_[0-9A-Za-z]{11}$/;
/** Сумма в $, как её пишет служба (`min_usd`, `max_usd`, наборы): центы, без знака. */
const USD = /^(0|[1-9][0-9]{0,12})(\.[0-9]{1,2})?$/;
/** Наборов сумм у магазина не больше шести — столько принимает команда оператора. */
const PRESETS_MAX = 6;

/** Ответ службы держится 6 с её собственной памятью; свой запас — минута. */
const TERMS_TTL_SECONDS = 60;
/**
 * Молчание службы запоминается тоже, и это важнее запаса удачного чтения: без
 * него каждый показ главной ждал бы таймаут заново.
 */
const TERMS_DOWN_TTL_SECONDS = 30;
/** Главная ждать не может: не ответили за это время — раздела нет. */
const TERMS_TIMEOUT_MS = 3_000;
const TERMS_CACHE_KEY = "donate:terms:v1";

export type DonateTerms = {
  /** Имя магазина, как его называет служба. */
  merchant: string;
  /** Принимают ли сейчас; `false` — раздел молчит. */
  accepting: boolean;
  /** Сегодняшние пределы, как их написала служба; у закрытых могут быть пусты. */
  minUsd: string | null;
  maxUsd: string | null;
  /** Наборы сумм магазина, по возрастанию. */
  presetsUsd: string[];
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
/** Управляющие знаки в строке службы — не текст для показа. */
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Сумма службы → центы; null — другая форма. */
export function usdCents(s: string): number | null {
  const m = USD.exec(s);
  return m ? Number(m[1]) * 100 + Number((m[2] ?? ".").slice(1).padEnd(2, "0")) : null;
}

/**
 * Центы → $ для человека: целые доллары как есть («10»), иначе два знака
 * («75.84»). Точка во всех языках — так же, как любая сумма экрана обмена.
 */
export function usdText(cents: number): string {
  const whole = Math.floor(cents / 100);
  return cents % 100 === 0 ? String(whole) : `${whole}.${String(cents % 100).padStart(2, "0")}`;
}

/** Сумма ответа: null — её нет; undefined — другая форма. */
const sumOf = (v: unknown): string | null | undefined =>
  v === null ? null : typeof v === "string" && USD.test(v) ? v : undefined;

/** Чтение `GET /donate/<магазин>`; null — ответ не той формы. */
export function parseDonateTerms(raw: unknown): DonateTerms | null {
  if (!isObj(raw)) return null;
  const { merchant, accepting } = raw;
  if (typeof merchant !== "string" || merchant === "" || merchant.length > 64) return null;
  if (CONTROL.test(merchant)) return null;
  if (typeof accepting !== "boolean") return null;
  const minUsd = sumOf(raw.min_usd);
  const maxUsd = sumOf(raw.max_usd);
  if (minUsd === undefined || maxUsd === undefined) return null;
  // Принимают — пределы названы оба, и меньший не больше большего.
  if (accepting && (minUsd === null || maxUsd === null || usdCents(minUsd)! > usdCents(maxUsd)!)) {
    return null;
  }
  if (!Array.isArray(raw.presets_usd) || raw.presets_usd.length > PRESETS_MAX) return null;
  const cents = raw.presets_usd.map((p) => (typeof p === "string" ? usdCents(p) : null));
  if (cents.some((c, i) => c === null || c <= 0 || (i > 0 && c <= cents[i - 1]!))) return null;
  return {
    merchant,
    accepting,
    minUsd,
    maxUsd,
    presetsUsd: raw.presets_usd as string[],
  };
}

/**
 * Суммы, которые главная предлагает нажатием: наборы магазина внутри
 * сегодняшних пределов. Служба свои наборы за пределами тоже прячет, но
 * проверяем сами — ссылка ведёт к деньгам.
 */
export function donatePresets(terms: DonateTerms): string[] {
  const min = terms.minUsd === null ? null : usdCents(terms.minUsd);
  const max = terms.maxUsd === null ? null : usdCents(terms.maxUsd);
  if (min === null || max === null) return [];
  const out: string[] = [];
  for (const p of terms.presetsUsd) {
    const c = usdCents(p);
    if (c !== null && c >= min && c <= max) out.push(usdText(c));
  }
  return out;
}

/** «Сегодня от 10 до 75,84 $» условий; null — пределы не названы. */
export function donateLimits(terms: DonateTerms): { min: string; max: string } | null {
  const min = terms.minUsd === null ? null : usdCents(terms.minUsd);
  const max = terms.maxUsd === null ? null : usdCents(terms.maxUsd);
  return min === null || max === null ? null : { min: usdText(min), max: usdText(max) };
}

type Cached = { ok: true; terms: DonateTerms } | { ok: false };

/** Настроена ли служба вовсе: без адреса и магазина пожертвований у сайта нет. */
export const donationsConfigured = (): boolean =>
  PAY_ORIGIN.test(PAY_API) && MERCHANT_ID.test(MERCHANT);

/**
 * Условия пожертвований для показа; null — не настроено, не ответили, ответ не
 * той формы или сейчас не принимают-и-это-не-наше-дело (закрытость раздел решает
 * сам по `accepting`).
 */
export async function readDonateTerms(): Promise<DonateTerms | null> {
  if (!donationsConfigured()) return null;
  const cached = await cacheGet<Cached>(TERMS_CACHE_KEY);
  if (cached) return cached.ok ? cached.terms : null;
  try {
    const r = await fetch(`${PAY_API}/donate/${MERCHANT}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TERMS_TIMEOUT_MS),
    });
    const terms = r.ok ? parseDonateTerms(await r.json()) : null;
    if (!terms) {
      await cacheSet(TERMS_CACHE_KEY, { ok: false }, TERMS_DOWN_TTL_SECONDS);
      return null;
    }
    await cacheSet(TERMS_CACHE_KEY, { ok: true, terms }, TERMS_TTL_SECONDS);
    return terms;
  } catch {
    await cacheSet(TERMS_CACHE_KEY, { ok: false }, TERMS_DOWN_TTL_SECONDS);
    return null;
  }
}
