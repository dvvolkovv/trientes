# Trading chart with TA indicators — design

**Date:** 2026-05-22
**Status:** Approved
**Branch:** `feat/trading-chart-indicators`

## Goal

A crypto.com-style trading chart on the coin detail page with configurable
visualization granularity from **one second (real time) up to one year**, plus
technical-analysis indicators. Non-destructive: the existing area chart stays as
the default ("Simple"); the trading chart is a "Pro" toggle.

## Timeframe selector (1s → 1Y)

A row of interval buttons. Each maps to a Binance kline interval + lookback:

| Button | Binance interval | Window         | Live source        |
|--------|------------------|----------------|--------------------|
| 1S     | `1s`             | ~16 min (1000) | WS `@kline_1s`     |
| 1m     | `1m`             | proportional   | WS `@kline_1m`     |
| 5m     | `5m`             | proportional   | WS `@kline_5m`     |
| 15m    | `15m`            | proportional   | WS `@kline_15m`    |
| 1H     | `1h`             | proportional   | WS `@kline_1h`     |
| 4H     | `4h`             | proportional   | WS `@kline_4h`     |
| 1D     | `1d`             | proportional   | WS `@kline_1d`     |
| 1W     | `1w`             | proportional   | WS `@kline_1w`     |
| 1M     | `1M`             | ~3 yrs         | WS `@kline_1M`     |
| 1Y     | `1d` × 365d      | 1 year (range) | WS `@kline_1d`     |

`limit` is capped at 1000 (Binance per-request max).

## Data layer

- **`src/lib/binance-klines.ts`** — `fetchKlines(symbol, interval, limit)` →
  normalized `OHLCV[]` (`{ time, open, high, low, close, volume }`, `time` in
  seconds). Public REST `https://api.binance.com/api/v3/klines`, no API key.
  Coin→symbol via the existing `CG_TO_BINANCE` map
  (`src/lib/live/binance-mapping.ts`).
- **`/api/coins/[id]/klines?interval=&limit=`** — server route. Validates
  interval against an allowlist. Short Redis cache for coarse intervals
  (≥ `1h`); no cache for `1s`/`1m`/`5m`/`15m` (too volatile, defeats realtime).
  If the coin is **not** in `CG_TO_BINANCE`, fall back to CoinGecko
  `/coins/{id}/ohlc?vs_currency=usd&days=N` (coarser candles, no volume) and
  return `{ source: "coingecko", candles }` so the UI can show a "reduced
  granularity" note. Binance path returns `{ source: "binance", candles }`.
- **Live updates** — the client opens a direct browser WebSocket to Binance
  (`wss://stream.binance.com:9443/ws/<sym>@kline_<interval>`) only while the Pro
  chart is mounted, calling `series.update()` per tick (open candle updates in
  place; closed candle appends). Socket closes on interval change / unmount.
  Non-Binance coins reuse the existing SSE price stream to nudge the last
  candle's close. **No new server-side WS process.**

## Indicators — `src/lib/indicators.ts`

Pure, unit-tested functions over OHLCV arrays:

- **Overlays (price pane):** SMA(n), EMA(n), Bollinger Bands(n, k)
- **Separate panes:** Volume (histogram, colored by candle direction),
  RSI(14), MACD(12,26,9)

Defaults: SMA 20, EMA 50, Bollinger (20, 2), RSI 14, MACD (12/26/9). A toggle
menu enables/disables each. Recomputed client-side on data load and on each live
candle update.

## UI components

- **`src/components/coin-detail/trading-chart.tsx`** (client) — candlestick
  chart with candle/line toggle, the timeframe row, an indicator menu, and
  volume + RSI + MACD panes via lightweight-charts v5 multi-pane
  (`addSeries(..., {}, paneIndex)`). Styled in the Trientes Ledger palette:
  up `#30B658`, down `#E55C5C`, orange `#F7931A` accents, `#161616` / `#1E1D24`
  surfaces, `.num` mono for axis/legend numerics. Shows a small badge when the
  data source is CoinGecko fallback.
- **`ChartPanel`** gains a **Simple / Pro** segmented toggle: Simple renders the
  existing `PriceChart` (area, unchanged); Pro renders `TradingChart`. Default
  is Simple so existing smoke tests stay green.

## i18n

New keys under `detail` (e.g. `simple`, `pro`, `volume`, indicator names,
`reducedGranularity`) added to all 10 locale files: de, en, es, fr, ja, ko,
pt-BR, ru, tr, zh-CN.

## Testing

- **Unit (vitest):** each indicator function (SMA, EMA, Bollinger, RSI, MACD)
  against hand-computed fixtures; `fetchKlines` normalization mapping (parse a
  sample Binance kline array → OHLCV).
- **e2e (Playwright):** existing coin-detail smoke unchanged (Simple is
  default). Add one spec: navigate to a Binance-listed coin, click **Pro**,
  assert the candlestick canvas renders and the timeframe buttons (1S … 1Y) are
  present.

## Out of scope (YAGNI)

Drawing tools, saved layouts/templates, comparison overlays, editable indicator
parameters beyond defaults, order-book/depth view. Deferred.

## Key risks / notes

- Binance only covers the 20 coins in `CG_TO_BINANCE`; everything else gets the
  coarser CoinGecko fallback (no true 1s, no volume). This is the honest
  tradeoff accepted in design.
- Browser→Binance WS is allowed (no CORS gate on WS) and offloads the server,
  but depends on the client reaching `stream.binance.com`. If blocked, the chart
  still renders static candles; only live updates are lost.
- lightweight-charts v5 API: `chart.addSeries(CandlestickSeries, opts, pane)` —
  not the deprecated `addCandlestickSeries()`.
