# Слайс C — агрегатор рынков и ценовой индекс: план

**Спека:** `docs/superpowers/specs/2026-11-07-coin-card-market-index-c-design.md`

**Цель:** считать цену самостоятельно залистингованной монеты по публичным API
восьми CEX, подтверждать заявленные листинги и показывать это с методикой.

## Границы и отклонения

1. Только CEX. DEX-пулы — следующий шаг (RPC слайса B), в этом слайсе
   `kind = "DEX"` даёт `exchange_unsupported`.
2. Фиатные котировки кроме USD — `no_usd_route`, курсы ЦБ не тянем.
3. Капитализация не считается: нужен проверенный circulating supply (слайс E).
4. Индекс пишется только в `CoinCardPriceIndex`, таблица `Coin` не трогается.

## Файлы

| Файл | Что |
| ---- | --- |
| `src/lib/cex-registry.ts` | новый — реестр восьми бирж: адрес снимка, парсер, формат символа, нормализация имени биржи |
| `src/lib/cex-snapshot.ts` | новый — загрузка снимка тикеров поверх инъектируемого `fetch`, таймаут/ретрай, кеш в Redis |
| `src/lib/quote-usd.ts` | новый — стейблы, опорные монеты, маршрут котировки к доллару |
| `src/lib/price-index.ts` | новый — чистая математика: взвешенная медиана, фильтр выбросов, `confidence` |
| `src/lib/pair.ts` | новый — разбор свободной строки пары в base/quote |
| `src/lib/coin-card-markets.ts` | новый — прогон по базе: сверка рынков, запись цен, индекс, часовая точка, чистка истории |
| `prisma/schema.prisma` + миграция `20261107100000_coin_card_market_index` | поля `CoinCardMarket`, модели `CoinCardPriceIndex`, `CoinCardPricePoint` |
| `worker/index.ts` | `runCardMarketSync()` + `cron.schedule("*/10 * * * *")`, чистка истории в суточном прогоне |
| `src/app/actions/coin-card-markets.ts` | ручное обновление с гейтом `MARKETS` и окном 10 минут |
| `src/components/coin-card/sections/markets-section.tsx` | цена, объём, 24 ч, статусы сверки, пометка выброса |
| `src/components/coin-card/card-header.tsx` | блок индекса для карточек без `coinId` |
| `src/components/coin-card/index-methodology.tsx` | новый — раскрываемое описание методики |
| `src/components/coin-card-manage/markets-refresh.tsx` | новый — кнопка в кабинете |
| `src/lib/coin-card-public.ts`, `src/lib/coin-card-directory.ts` | подтянуть индекс в публичные выборки |
| `messages/*.json` (10) | `coinCard.index.*`, `coinCard.market.*` |
| `tests/cex-registry.test.ts`, `tests/pair.test.ts`, `tests/quote-usd.test.ts`, `tests/price-index.test.ts`, `tests/coin-card-markets.test.ts` | тесты чистых функций и прогона на `PrismaLike` |

## Задачи

1. **Схема и миграция** — `nativeSymbol`, `quote`, `change24h`, `isOutlier`,
   `checkedAt`, `checkError` у `CoinCardMarket`; модели `CoinCardPriceIndex`
   (1:1, `@unique cardId`) и `CoinCardPricePoint` (`@@unique([cardId, at])`).
   Аддитивно, без потери данных.
2. **`pair.ts` + тесты** — `parsePair("TAL/USDT")`, разделители `/ - _`,
   склеенная форма по словарю котировок, `pair_unparsable`.
3. **`cex-registry.ts` + тесты** — по фикстуре на биржу: парсер снимка в
   `Map<nativeSymbol, {price, quoteVolumeUsd?, changePct}>`, формат символа,
   альтнеймы Kraken, `normalizeExchange("BINANCE Spot") → "binance"`.
4. **`cex-snapshot.ts`** — `fetchSnapshot(id, {fetchImpl, timeoutMs})`: таймаут
   8 с, один ретрай, классификация в `exchange_unreachable`/`exchange_error`;
   `getSnapshots(ids, {redis})` — кеш 5 минут, частичный отвал не ломает прогон.
5. **`quote-usd.ts` + тесты** — стейблы = 1, опорные `BTC/ETH/BNB/SOL` через
   переданный `anchors`, `EUR` → `no_usd_route`.
6. **`price-index.ts` + тесты** — `weightedMedian`, `computeIndex(candidates)`:
   отсев пыли с возвратом при полном отсеве, предварительная медиана, выбросы
   > 20 %, итоговая медиана, `spreadPct`, `change24h`, `confidence` на границах.
7. **`coin-card-markets.ts` + тесты** — `confirmMarket(claim, snapshot)` →
   факт или `checkError`; `syncCardMarkets({prisma, redis, fetchImpl, now})`:
   опорные монеты первым проходом, затем карточки `APPROVED` с рынками на
   известных биржах; запись рынков, upsert индекса, часовая точка (округление
   `at` до часа), провенанс `price`/`markets`; `pruneCardPricePoints` — 90 дней.
8. **Воркер** — `runCardMarketSync()` каждые 10 минут; чистка истории в суточном
   прогоне `05 4 * * *`.
9. **Серверное действие** — `refreshCardMarkets(cardId)`: `canEditSection(member,"MARKETS")`,
   `too_soon` при обновлении < 10 минут назад, `no_markets`, иначе прогон по одной карточке.
10. **Рендер** — шапка (только при `coinId = null`), секция рынков, методика,
    листинг самостоятельных карточек, кабинет с кнопкой.
11. **Переводы** — 10 локалей.
12. **Проверка и выкладка** — `npx tsc --noEmit`, `npm test`, `npm run build`,
    миграция, `pm2 restart trientes-web trientes-worker`, `pm2 save`, push.
    Воркер обязателен: новый код в `src/lib` импортируется воркером.
