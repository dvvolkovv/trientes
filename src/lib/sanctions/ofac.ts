/**
 * Санкционный список криптоадресов OFAC SDN (слайс CR, раздел 5.4 спеки).
 *
 * Почему именно он. ТЗ § 6.8 просит «проверку входящих адресов на связь с отмыванием
 * денег и санкциями (KYT)». Поведенческий скоринг адресов продают за деньги, а платных
 * тарифов мы не берём (решение BL). Зато официальный список специально назначенных лиц
 * публикуется открыто, без ключа и без запаса запросов, и несёт **настоящие**
 * криптоадреса: живая выборка 28 ноября 2026 — 1082 адреса в девятнадцати активах
 * (`XBT` 534, `TRX` 273, `ETH` 124, `USDT` 94…). Поэтому на экране это названо
 * «санкционный список OFAC», а не «KYT»: мы делаем ровно то, что делаем.
 *
 * Два решения, которые нельзя трогать:
 * - **пустой разбор список не затирает** (прецедент табло в BO): ноль адресов означает
 *   смену формата ответа, а не отмену санкций;
 * - **совпадение помечает, а не блокирует.** Мы не следственный орган: продавец видит
 *   громкую строку с именем из списка и программой — это его повод остановиться.
 */
import { prisma } from "@/lib/prisma";
import { addressKey } from "@/lib/crypto-ledger/address";

export const SANCTIONS_SOURCE = "OFAC_SDN";

/**
 * Точка выдачи списка. Отвечает 302 на S3 правительства США — редиректы `fetch`
 * проходит сам. Живой замер 28 ноября: 29,6 МБ за 4,3 с.
 */
export const SDN_URL = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML";

/** Срок: тридцать мегабайт по чужой сети — это не секунда, но и не вечность. */
const TIMEOUT_MS = 60_000;

export type SanctionRow = {
  asset: string;
  address: string;
  addressKey: string;
  listedName: string | null;
  programs: string | null;
};

export type SdnParse = { publishedAt: Date | null; rows: SanctionRow[] };

function textOf(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block);
  if (!m) return null;
  const value = m[1]
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
  return value || null;
}

/**
 * Разбор SDN.XML. Своего разборщика XML в проекте нет и ради одного списка мы его не
 * заводим: нужны три поля из одного вида узла, и регулярное выражение по блоку записи
 * читается глазом. Чужую форму при этом не угадываем — берём только те `<id>`, чей тип
 * прямо назван «Digital Currency Address».
 */
export function parseSdnXml(xml: string): SdnParse {
  const published = /<Publish_Date>(\d{2})\/(\d{2})\/(\d{4})<\/Publish_Date>/.exec(xml);
  const publishedAt = published
    ? new Date(Date.UTC(Number(published[3]), Number(published[1]) - 1, Number(published[2])))
    : null;

  const rows: SanctionRow[] = [];
  const seen = new Set<string>();
  // Записи разделены `<sdnEntry>`; имя и программы берутся из той же записи, что адрес.
  for (const entry of xml.split("<sdnEntry>").slice(1)) {
    if (!entry.includes("Digital Currency Address")) continue;

    const last = textOf(entry, "lastName");
    const first = textOf(entry, "firstName");
    const listedName = [first, last].filter(Boolean).join(" ") || null;
    const programs = [...entry.matchAll(/<program>([\s\S]*?)<\/program>/g)]
      .map((m) => m[1].trim())
      .filter(Boolean)
      .join(", ");

    for (const idBlock of entry.split("<id>").slice(1)) {
      const type = textOf(idBlock, "idType");
      if (!type || !type.startsWith("Digital Currency Address")) continue;
      const asset = type.split("-").pop()?.trim().toUpperCase() ?? "";
      const address = textOf(idBlock, "idNumber");
      if (!address || !asset) continue;
      const key = addressKey(address);
      // Один адрес бывает назван у двух лиц: в списке держим одну строку — сверке
      // важно «есть или нет», а не сколько раз.
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ asset, address, addressKey: key, listedName, programs: programs || null });
    }
  }

  return { publishedAt, rows };
}

export type SanctionsSyncResult =
  | { ok: true; written: number; publishedAt: Date | null; ms: number }
  | { ok: false; reason: "http_error" | "fetch_failed" | "empty_parse"; detail?: string };

export type SanctionsDeps = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

/**
 * Суточный прогон. Список забирается целиком и записывается целиком: он и есть истина
 * на дату публикации, поэтому исчезнувший из списка адрес снимается — но **только**
 * при непустом разборе.
 */
export async function syncSanctions(deps: SanctionsDeps = {}): Promise<SanctionsSyncResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const started = Date.now();

  let xml: string;
  try {
    const res = await fetchImpl(SDN_URL, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "trientes.org/1.0 (+https://trientes.org)" },
    });
    if (!res.ok) return { ok: false, reason: "http_error", detail: `http ${res.status}` };
    xml = await res.text();
  } catch (err) {
    return { ok: false, reason: "fetch_failed", detail: err instanceof Error ? err.message : String(err) };
  }

  const parsed = parseSdnXml(xml);
  if (parsed.rows.length === 0) return { ok: false, reason: "empty_parse" };

  const fetchedAt = deps.now?.() ?? new Date();
  await prisma.$transaction([
    prisma.sanctionedCryptoAddress.deleteMany({ where: { source: SANCTIONS_SOURCE } }),
    prisma.sanctionedCryptoAddress.createMany({
      data: parsed.rows.map((r) => ({
        source: SANCTIONS_SOURCE,
        asset: r.asset,
        address: r.address,
        addressKey: r.addressKey,
        listedName: r.listedName,
        programs: r.programs,
        publishedAt: parsed.publishedAt,
        fetchedAt,
      })),
    }),
  ]);

  return { ok: true, written: parsed.rows.length, publishedAt: parsed.publishedAt, ms: Date.now() - started };
}

/** Состояние списка для ночного отчёта: сколько адресов и когда снято. */
export async function sanctionsState(): Promise<{ count: number; fetchedAt: Date | null; publishedAt: Date | null }> {
  const [count, newest] = await Promise.all([
    prisma.sanctionedCryptoAddress.count({ where: { source: SANCTIONS_SOURCE } }),
    prisma.sanctionedCryptoAddress.findFirst({
      where: { source: SANCTIONS_SOURCE },
      orderBy: { fetchedAt: "desc" },
      select: { fetchedAt: true, publishedAt: true },
    }),
  ]);
  return { count, fetchedAt: newest?.fetchedAt ?? null, publishedAt: newest?.publishedAt ?? null };
}
