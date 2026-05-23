# Markets: индексы, фьючерсы CME и драгметаллы (Stooq) — Слайс 2

**Дата:** 2026-05-23
**Раздел:** новый `/{locale}/markets` («Рынки»)

## Задача

Подключить традиционные рынки и драгметаллы рядом с криптой: фондовые индексы
(Dow, Nasdaq, S&P 500), фьючерсы CME (E-mini S&P, нефть, газ) и спот драгметаллов
(золото, серебро, платина, палладий).

## Источник — Stooq (key-less, в духе проекта)

`https://stooq.com/q/l/?s=<symbol>&f=sd2t2ohlc&e=csv` → одна CSV-строка
`Symbol,Date,Time,Open,High,Low,Close`. **Мульти-символьный запрос у Stooq глючит
(возвращает N/D), поэтому тянем по одному символу** с небольшой задержкой. Данные
**задержанные/индикативные** (не real-time) — это отражаем в подписи. Проверено
вживую (2026-05-23): все 10 символов отвечают.

| Группа | Символы |
|---|---|
| Индексы | `^dji` Dow Jones · `^ndq` Nasdaq Composite · `^spx` S&P 500 |
| Фьючерсы CME | `es.f` E-mini S&P 500 · `cl.f` Crude Oil WTI · `ng.f` Natural Gas |
| Драгметаллы | `xauusd` Gold · `xagusd` Silver · `xptusd` Platinum · `xpdusd` Palladium |

Изменение за сессию = `(close − open) / open`. Единицы: индексы/E-mini — пункты
(без `$`), металлы/энергоносители — USD.

## Изменения в коде

### `src/lib/markets.ts` (новый)
- Типы `MarketGroup` (`index|future|metal`), `MarketUnit` (`usd|pts`), `MarketQuote`.
- `MARKET_INSTRUMENTS` — конфиг (symbol, name, group, unit).
- `parseStooqQuote(csv): {date,time,open,high,low,close} | null` — чистая, режет
  последнюю непустую строку, `N/D`/нечисловые → null. **Юнит-тест.**
- `fetchMarketQuote(inst)` (Stooq, UA, таймаут) и `fetchMarkets()` —
  последовательно по символам с задержкой; сбойные пропускаются.

### `src/lib/sync/keys.ts`
- `KEYS.markets = "snapshot:markets"`, `TTL.markets = 3600`.

### `src/lib/sync/orchestrator.ts`
- `syncMarkets({ fetchMarkets, redis })` — пишет `KEYS.markets`. **Юнит-тест.**

### `worker/index.ts`
- `runMarketsSync()` в boot-последовательности + cron `*/20 * * * *` (key-less,
  не трогает бюджет CoinGecko).

### `src/lib/snapshot.ts`
- `readMarkets(): Promise<MarketQuote[]>` — чтение `KEYS.markets`.

### `src/app/[locale]/markets/page.tsx` (новый) + `src/components/markets-board.tsx`
- Серверная страница: три секции (индексы / фьючерсы / металлы), сетка карточек:
  название, последняя цена (mono), изменение за сессию (зелёный/красный), диапазон
  дня low–high, время котировки. Подпись о задержке данных и источнике Stooq.

### `src/components/navbar.tsx`
- Ссылка «Рынки» (`/{locale}/markets`) в десктоп- и мобильном меню.

### `messages/*.json` (10 локалей)
- `common.markets` + namespace `markets`: `title, subtitle, indices, futures,
  metals, change, range, asOf, dataNote, empty` + переводимые названия
  инструментов (`gold, silver, platinum, palladium, crude, natgas`). Индексы и
  E-mini — имена собственные, заданы в конфиге.

## Краёвые случаи / деградация
- Символ недоступен/Stooq не ответил → инструмент пропускается, страница не падает.
- Пустой список → состояние «нет данных».
- Данные задержанные → явная подпись.

## Тестирование
- Юнит: `parseStooqQuote` (валидная строка, `N/D`, мусор), `syncMarkets` (пишет
  Redis). Сборка + typecheck. Ручная проверка страницы.

## Деплой
Прод — этот checkout. `npm run build` → `pm2 restart trientes-web` **и**
`trientes-worker` (менялся `src/lib` + worker) → `pm2 save` → `git push`.
