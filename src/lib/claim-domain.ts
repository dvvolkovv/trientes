/**
 * Доказательства через домен проекта: TXT-запись и файл `.well-known`.
 *
 * DNS читается через DNS-over-HTTPS, потому что обычный резолвер сервера
 * кеширует отрицательный ответ и проект, только что добавивший запись, видел бы
 * отказ ещё час. Основной резолвер — Cloudflare, резерв — Google; ключей не
 * нужно ни тому, ни другому.
 */

export type DomainFetch = (
  input: string,
  init?: { method: string; headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export type DnsError = "dns_no_record" | "dns_unreachable";
export type WellKnownError = "well_known_missing" | "well_known_unreachable";

/** Имя записи и путь файла — часть публичной инструкции, менять нельзя молча. */
export const TXT_PREFIX = "trientes-verification=";
export const WELL_KNOWN_PATH = "/.well-known/trientes-verification.txt";

const DOH = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/resolve",
];

const TIMEOUT_MS = 8_000;
/** Тело файла читаем с запасом, но не весь интернет. */
const MAX_BODY = 1_024;

/**
 * Домен из `links.website` карточки: хост в нижнем регистре без `www.`.
 * Доказательство на чужом домене — не доказательство, поэтому домен берётся
 * из карточки, а не из ввода заявителя.
 */
export function websiteDomain(links: unknown): string | null {
  const raw = (links as { website?: unknown } | null)?.website;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const text = raw.trim();
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  let host: string;
  try {
    host = new URL(withScheme).hostname.toLowerCase();
  } catch {
    return null;
  }
  const bare = host.replace(/^www\./, "");
  // Домен без точки (localhost, intranet-имя) доказательством быть не может.
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(bare)) return null;
  return bare;
}

/** Склейка TXT-ответа DoH в список строк без кавычек. */
export function parseTxtAnswer(body: unknown): string[] {
  const answer = (body as { Answer?: unknown } | null)?.Answer;
  if (!Array.isArray(answer)) return [];
  const out: string[] = [];
  for (const row of answer) {
    const r = row as { type?: unknown; data?: unknown };
    if (r.type !== 16) continue; // 16 = TXT
    if (typeof r.data !== "string") continue;
    // Длинные TXT приходят как несколько строк в кавычках: "часть1" "часть2".
    const parts = r.data.match(/"([^"]*)"/g);
    const value = parts ? parts.map((p) => p.slice(1, -1)).join("") : r.data;
    out.push(value.trim());
  }
  return out;
}

async function getJson(
  url: string,
  fetchImpl: DomainFetch,
  timeoutMs: number,
): Promise<unknown> {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.json();
}

/** TXT-записи домена. Резервный резолвер спрашивается, только если упал первый. */
export async function fetchTxtRecords(
  domain: string,
  opts: { fetchImpl?: DomainFetch; timeoutMs?: number } = {},
): Promise<{ records: string[]; error: null } | { records: null; error: DnsError }> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as DomainFetch);
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;

  let reachable = false;
  const all: string[] = [];
  for (const base of DOH) {
    try {
      const body = await getJson(
        `${base}?name=${encodeURIComponent(domain)}&type=TXT`,
        fetchImpl,
        timeoutMs,
      );
      reachable = true;
      all.push(...parseTxtAnswer(body));
      if (all.length > 0) break;
    } catch {
      // Молча идём к резервному: отказ одного резолвера — не отказ домена.
    }
  }
  if (!reachable) return { records: null, error: "dns_unreachable" };
  if (all.length === 0) return { records: null, error: "dns_no_record" };
  return { records: all, error: null };
}

/** Содержимое файла `.well-known` (первый килобайт). */
export async function fetchWellKnown(
  domain: string,
  opts: { fetchImpl?: DomainFetch; timeoutMs?: number } = {},
): Promise<{ body: string; error: null } | { body: null; error: WellKnownError }> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as DomainFetch);
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  try {
    const res = await fetchImpl(`https://${domain}${WELL_KNOWN_PATH}`, {
      method: "GET",
      headers: { accept: "text/plain" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 404 || res.status === 403) return { body: null, error: "well_known_missing" };
    if (!res.ok) return { body: null, error: "well_known_unreachable" };
    const text = await res.text();
    return { body: text.slice(0, MAX_BODY), error: null };
  } catch {
    return { body: null, error: "well_known_unreachable" };
  }
}

/** Токен найден, если он встречается целиком — в TXT-значении или в теле файла. */
export const containsToken = (haystack: string, token: string): boolean =>
  haystack.toLowerCase().includes(token.toLowerCase());
