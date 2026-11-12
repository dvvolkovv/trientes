/**
 * Биржа рынка карточки — в строке каталога бирж (слайс AD).
 *
 * У рынка в карточке хранится id коннектора и имя биржи, а логотип и адрес
 * карточки биржи лежат в таблице `Exchange`. Связь между ними пришпилена в
 * реестре коннекторов (`directoryId`), потому что id там и там расходятся:
 * каталог заведён по id CoinGecko, коннекторы — по именам бирж.
 */

import { prisma } from "@/lib/prisma";
import { getConnector, normalizeExchange } from "@/lib/cex-registry";

export type DirectoryEntry = { id: string; name: string; logoUrl: string | null };

export type MarketExchangeRef = { exchangeId?: string | null; exchangeName: string };

/**
 * id коннектора для рынка: сперва записанный, затем имя биржи свободным вводом
 * (так рынок заводит проект). Неизвестная биржа — null, и строка останется
 * текстом без логотипа.
 */
export function connectorIdOfMarket(m: MarketExchangeRef): string | null {
  const byId = m.exchangeId ? getConnector(m.exchangeId)?.id ?? null : null;
  return byId ?? normalizeExchange(m.exchangeName);
}

/**
 * Строки каталога для рынков карточки — одним запросом на всю таблицу.
 * Ключ результата — id коннектора, как его вернёт `connectorIdOfMarket`.
 */
export async function exchangeDirectoryForMarkets(
  markets: readonly MarketExchangeRef[],
): Promise<Map<string, DirectoryEntry>> {
  const byDirectory = new Map<string, string>(); // directoryId → connectorId
  for (const m of markets) {
    const connectorId = connectorIdOfMarket(m);
    if (!connectorId) continue;
    const directoryId = getConnector(connectorId)?.directoryId;
    if (directoryId) byDirectory.set(directoryId, connectorId);
  }
  if (byDirectory.size === 0) return new Map();

  const rows = await prisma.exchange.findMany({
    where: { id: { in: [...byDirectory.keys()] } },
    select: { id: true, name: true, logoUrl: true },
  });

  const out = new Map<string, DirectoryEntry>();
  for (const row of rows) {
    const connectorId = byDirectory.get(row.id);
    if (connectorId) out.set(connectorId, row);
  }
  return out;
}

/**
 * Строки каталога по именам бирж — для таблиц, где биржа названа словом, а не
 * id (тикеры рыночного фида, рынки карточки). Имя фида совпадает с именем
 * каталога: и то и другое пришло из CoinGecko. Чего там нет, ищем по реестру
 * коннекторов — так находится и наш собственный обмен чужого написания.
 *
 * Ключ результата — имя в нижнем регистре.
 */
export async function exchangeDirectoryByName(
  names: readonly string[],
): Promise<Map<string, DirectoryEntry>> {
  const wanted = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (wanted.length === 0) return new Map();

  // Имя и id каталога: по имени находится любая биржа фида, по id — те восемь,
  // что мы читаем коннекторами (у них имя может быть написано иначе).
  const byConnector = new Map<string, string>(); // directoryId → имя из запроса
  for (const name of wanted) {
    const connectorId = normalizeExchange(name);
    const directoryId = connectorId ? getConnector(connectorId)?.directoryId : null;
    if (directoryId) byConnector.set(directoryId, name);
  }

  const rows = await prisma.exchange.findMany({
    where: { OR: [{ name: { in: wanted } }, { id: { in: [...byConnector.keys()] } }] },
    select: { id: true, name: true, logoUrl: true },
    // Строк на биржу бывает две (источники cg и cp): берём ту, что с логотипом
    // и с рангом, то есть запись CoinGecko.
    orderBy: [{ source: "asc" }, { trustScoreRank: "asc" }],
  });

  const out = new Map<string, DirectoryEntry>();
  for (const row of rows) {
    const keys = [row.name.toLowerCase()];
    const viaConnector = byConnector.get(row.id);
    if (viaConnector) keys.push(viaConnector.toLowerCase());
    for (const key of keys) if (!out.has(key)) out.set(key, row);
  }
  return out;
}