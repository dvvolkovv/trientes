/**
 * Акция магазина — чистые правила. Спека
 * `docs/superpowers/specs/2026-11-19-merchant-promos-antispam-design.md`, разделы 2, 5, 8.
 *
 * Без Prisma: правило проверяется тестом, а не живым нажатием в кабинете.
 */

/** Заголовок читают строкой в списке; длиннее — он там не поместится. */
export const PROMO_TITLE_MAX = 80;
/** Телеграм режет длинное сообщение, а длинную рекламу никто не читает. */
export const PROMO_TEXT_MAX = 600;
/**
 * Акция длиной в год — это не акция, а цена; для цены есть предложение продавца (BC).
 * Потолок заодно страхует от описки в годе, которая повесила бы акцию навсегда.
 */
export const PROMO_WINDOW_MAX_DAYS = 90;

const DAY = 24 * 60 * 60 * 1000;

export type PromoInput = {
  title: string;
  body: string;
  /** `YYYY-MM-DD` из поля даты — часа у срока нет, см. ниже. */
  startsAt: string;
  endsAt: string;
};

export type PromoValues = {
  title: string;
  body: string;
  startsAt: Date;
  endsAt: Date;
};

export type ParseResult =
  | { ok: true; value: PromoValues }
  | { ok: false; reason: string };

const fail = (reason: string): ParseResult => ({ ok: false, reason });

/**
 * Домены верхнего уровня, которые мессенджер и почтовый клиент делают ссылкой сами.
 * Список нарочно короткий и не претендует на полноту: он ловит то, что станет
 * нажимаемым у получателя, а остальное ловят ветки со схемой, `www.` и косой чертой.
 */
const LINKY_TLDS = new Set([
  "com", "net", "org", "info", "biz", "shop", "store", "app", "dev", "io", "me", "co",
  "xyz", "top", "site", "online", "link", "cc", "tv", "cloud", "ai", "eu", "ru", "ua",
  "by", "kz", "de", "at", "ch", "cz", "sk", "pl", "fr", "it", "es", "nl", "uk", "tr",
  "pt", "ro", "hu", "hr", "si", "bg", "gr", "se", "no", "fi", "dk", "ie", "be",
]);

/**
 * Есть ли в тексте то, что у получателя станет ссылкой. Ссылка в сообщении от
 * незнакомого магазина — дверь для фишинга, а придёт оно из нашего бота и с нашего
 * домена, то есть отвечать за неё будем мы. Переход у акции один, и ставим его мы.
 */
export function hasLink(text: string): boolean {
  const lower = text.toLowerCase();
  if (lower.includes("://")) return true;
  if (/(^|[^a-z0-9])www\./.test(lower)) return true;
  // Почта: буква с обеих сторон собачки.
  if (/[a-z0-9][a-z0-9._%+-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}/.test(lower)) return true;
  // Домен с путём — косая черта после точки делает ссылкой любое написание.
  if (/[a-z0-9][a-z0-9-]*\.[a-z]{2,24}\//.test(lower)) return true;
  // Голый домен: ссылкой станет только знакомый TLD.
  for (const match of lower.matchAll(/[a-z0-9][a-z0-9-]*\.([a-z]{2,24})(?![a-z0-9-])/g)) {
    if (LINKY_TLDS.has(match[1])) return true;
  }
  return false;
}

/**
 * Срок — дата, а не час: часового пояса у предприятия в данных нет, и «до 18:00»
 * означало бы неизвестно чей вечер (решение BF). Начало — полночь дня, конец —
 * последняя миллисекунда дня: названный день входит в срок.
 */
function parseDay(raw: string, end: boolean): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return null;
  const ms = Date.parse(`${raw.trim()}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(end ? ms + DAY - 1 : ms);
}

export function parsePromoInput(input: PromoInput, now: Date): ParseResult {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title) return fail("title_required");
  if (title.length > PROMO_TITLE_MAX) return fail("title_too_long");
  if (!body) return fail("body_required");
  if (body.length > PROMO_TEXT_MAX) return fail("body_too_long");
  if (hasLink(title) || hasLink(body)) return fail("text_has_link");

  const startsAt = parseDay(input.startsAt, false);
  const endsAt = parseDay(input.endsAt, true);
  if (!startsAt || !endsAt) return fail("window_invalid");
  if (endsAt.getTime() <= startsAt.getTime()) return fail("window_backwards");
  // Уже закончившуюся акцию заводить незачем: она не покажется ни секунды.
  if (endsAt.getTime() < now.getTime()) return fail("window_past");
  if (endsAt.getTime() - startsAt.getTime() > PROMO_WINDOW_MAX_DAYS * DAY) return fail("window_too_long");

  return { ok: true, value: { title, body, startsAt, endsAt } };
}

export type PromoWindowState = "upcoming" | "running" | "finished";

export function promoWindow(promo: { startsAt: Date; endsAt: Date }, now: Date): PromoWindowState {
  if (now.getTime() < promo.startsAt.getTime()) return "upcoming";
  if (now.getTime() > promo.endsAt.getTime()) return "finished";
  return "running";
}

/**
 * Видна ли акция снаружи. Своей модерации и своего надзора у акции нет — её снимают те
 * надзоры, что в проекте уже есть (то же решение, что `offerVisible` в BC): предприятие
 * залистовано и не снято, акция не в архиве и идёт сейчас.
 */
export function promoVisible(
  input: {
    company: { status: string; suspendedAt: Date | null; deletedAt: Date | null };
    promo: { startsAt: Date; endsAt: Date; archivedAt: Date | null };
  },
  now: Date,
): boolean {
  const { company, promo } = input;
  if (company.status !== "APPROVED") return false;
  if (company.suspendedAt || company.deletedAt) return false;
  if (promo.archivedAt) return false;
  return promoWindow(promo, now) === "running";
}
