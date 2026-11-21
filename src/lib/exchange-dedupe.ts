/**
 * Одна биржа — одна строка каталога.
 *
 * Каталог наполняют два источника: CoinGecko (`source = "cg"`) и CoinPaprika
 * (`"cp"`), и ключи у них свои. Там, где они разошлись, в базе оказались **две
 * строки на одну биржу**: `gate` и `gateio`, `mxc` и `mexc`, `okex` и `okx`,
 * `huobi` и `htx` — всего 41 пара на 581 строку (живой счёт 21 ноября 2026).
 * Видно это глазом в каталоге, а молча ломалось в трёх местах: объём и пары
 * делились между двойниками, опознание Coinlore отказывалось от неоднозначного
 * имени (а значит `ExchangeMarket` этой биржи никто не наполнял), и закладка
 * ставилась на ту строку, которую человек открыл.
 *
 * Механизм против этого был с самого начала — `CP_TO_CG_ALIAS` в
 * `coinpaprika.ts` («CG list is the canonical id space») — и остался с одной
 * записью: расхождения никто не искал. Здесь лежит правило поиска, по которому
 * карта и заполнена, а разовое слияние делает `scripts/merge-exchange-dupes.ts`.
 *
 * Почему главной остаётся строка CoinGecko, хотя её ключ часто некрасивее
 * (`mxc` против `mexc`): по этому ключу её каждый час находит основной прогон
 * каталога (`syncExchanges` упсертит по своему id, и псевдонимов в эту сторону
 * нет). Сделай главной строку CoinPaprika — и прогон CoinGecko заведёт свою
 * заново тем же вечером.
 */

/** Ключ сравнения: имя без регистра и без знаков. «Nami.Exchange» = «Nami Exchange». */
export function exchangeDedupeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export type DedupeRow = { id: string; name: string; source: string | null };

export type DedupeGroup = {
  key: string;
  /** Строка, которая останется. */
  canonical: DedupeRow;
  /** Строки, которые вливаются в неё. */
  merged: DedupeRow[];
};

/** Почему группа не слита: решение принимает человек, а не «первая попавшаяся». */
export type DedupeRefusal = { key: string; rows: DedupeRow[]; reason: "no_cg_row" | "many_cg_rows" };

/**
 * Группы двойников по имени.
 *
 * Одно имя — ещё не одна биржа, поэтому слить можно только ту группу, где
 * главная определена однозначно: ровно одна строка CoinGecko. Ни одной или
 * больше одной — это **отказ со причиной**, а не выбор по объёму: у CoinGecko
 * в каталоге сорок строк `Uniswap` по сетям и версиям, и там, где имя
 * действительно неоднозначно, догадка слила бы разные биржи в одну.
 */
export function findExchangeDupes(rows: DedupeRow[]): { groups: DedupeGroup[]; refused: DedupeRefusal[] } {
  const byKey = new Map<string, DedupeRow[]>();
  for (const r of rows) {
    const k = exchangeDedupeKey(r.name);
    if (!k) continue;
    const bucket = byKey.get(k);
    if (bucket) bucket.push(r);
    else byKey.set(k, [r]);
  }

  const groups: DedupeGroup[] = [];
  const refused: DedupeRefusal[] = [];
  for (const [key, bucket] of [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (bucket.length < 2) continue;
    const cg = bucket.filter((r) => r.source === "cg");
    if (cg.length === 0) {
      refused.push({ key, rows: bucket, reason: "no_cg_row" });
      continue;
    }
    if (cg.length > 1) {
      refused.push({ key, rows: bucket, reason: "many_cg_rows" });
      continue;
    }
    groups.push({ key, canonical: cg[0], merged: bucket.filter((r) => r.id !== cg[0].id) });
  }
  return { groups, refused };
}

/**
 * Новый ключ строки рынка при переносе на главную биржу.
 *
 * Ключ `ExchangeMarket` — «{exchangeId}:{base}:{quote}:{category}», то есть при
 * переносе его надо переписать, а не только поле `exchangeId`. Приставка
 * меняется ровно одна, в начале: тикер или категория могут содержать имя
 * биржи, и слепая замена по всей строке испортила бы пару.
 */
export function remapMarketId(marketId: string, fromExchangeId: string, toExchangeId: string): string | null {
  const prefix = `${fromExchangeId}:`;
  if (!marketId.startsWith(prefix)) return null;
  return `${toExchangeId}:${marketId.slice(prefix.length)}`;
}
