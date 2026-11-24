/**
 * Объекты, права на которые доказываются письмом с домена, и их домены.
 *
 * Домен берём МЫ, из своих же данных: у карточки — сайт, заявленный в ней, а
 * если его нет (так у всех 54 посеянных карточек), то официальный сайт монеты
 * из каталожной записи. Домен, названный заявителем, доказательством быть не
 * может по построению — он назовёт тот, которым владеет.
 */

/** Какие объекты умеют принимать такое доказательство. */
export type ClaimSubjectKind = "COIN_CARD" | "FINTECH";

export type SubjectSource =
  | {
      kind: "COIN_CARD";
      /** `CoinCard.links` как есть: сайт проекта там под ключом `website`. */
      links: unknown;
      /** `Coin.websiteUrl` каталожной записи; у карточки без монеты — null. */
      coinWebsiteUrl: string | null;
    }
  | {
      kind: "FINTECH";
      website: string;
    };

/** Как домен письма сошёлся с доменом объекта. */
export type DomainMatch = "EXACT" | "PARENT" | "SUBDOMAIN";

/**
 * Публичные суффиксы второго уровня, которые встречаются у наших объектов.
 * Полного списка (PSL) в проекте нет и тащить его ради одной проверки незачем:
 * список нужен ровно для того, чтобы `co.uk` не считался «родительским
 * доменом» чужого магазина. Чего в списке нет, тот суффикс родителем не станет
 * по другому правилу — у него не бывает писем с `pass`.
 */
const PUBLIC_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.au",
  "net.au",
  "org.au",
  "com.br",
  "com.mx",
  "com.ar",
  "com.tr",
  "com.cn",
  "com.hk",
  "com.sg",
  "com.tw",
  "co.jp",
  "or.jp",
  "ne.jp",
  "co.kr",
  "co.in",
  "co.za",
  "co.nz",
  "com.ua",
  "co.il",
  "com.pl",
]);

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Домен из адреса сайта: хост в нижнем регистре без `www.`; null — не адрес. */
export function siteDomain(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text === "") return null;
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  let host: string;
  try {
    host = new URL(withScheme).hostname.toLowerCase();
  } catch {
    return null;
  }
  const bare = host.replace(/^www\./, "");
  if (!DOMAIN.test(bare) || !/\.[a-z]{2,}$/.test(bare)) return null;
  return bare;
}

/** Домен объекта: что именно считается его сайтом, решает вид объекта. */
export function subjectDomain(source: SubjectSource): string | null {
  if (source.kind === "FINTECH") return siteDomain(source.website);
  const declared = siteDomain((source.links as { website?: unknown } | null)?.website);
  return declared ?? siteDomain(source.coinWebsiteUrl);
}

/** Домен — публичный суффикс (`co.uk`) или вовсе один уровень (`com`)? */
function isPublicSuffix(domain: string): boolean {
  return PUBLIC_SUFFIXES.has(domain) || !domain.includes(".");
}

/**
 * Сошлись ли домен письма и домен объекта.
 *
 * Родитель доказывает больше, чем нужно (владелец зоны владеет и поддоменом),
 * поэтому принимается. Поддомен принимается тоже, но называется своим именем:
 * поддомен бывает делегирован третьей стороне, и модератор должен это видеть.
 */
export function domainMatches(emailDomain: string, subject: string): DomainMatch | null {
  const a = (emailDomain ?? "").trim().toLowerCase();
  const b = (subject ?? "").trim().toLowerCase();
  if (a === "" || b === "") return null;
  if (isPublicSuffix(a) || isPublicSuffix(b)) return null;
  if (a === b) return "EXACT";
  if (b.endsWith(`.${a}`)) return "PARENT";
  if (a.endsWith(`.${b}`)) return "SUBDOMAIN";
  return null;
}
