# План: маршрут A→B с остановками по интересам (слайс BK)

Спека: `docs/superpowers/specs/2026-11-20-route-interests-stops-design.md`.

## 1. Данные

- `prisma/schema.prisma`: enum `InterestVerdict`; модель `UserInterest`
  (@@unique userId+key); поля `User.routeCorridorMeters`, `User.routeAlertMeters`.
- Миграция руками `20261120060000_route_interests/migration.sql` + `migrate deploy`.

## 2. Чистые правила

- `src/lib/interests.ts` — `INTEREST_KEYS`, `interestOf(poi)`, `activeInterests(marks)`,
  пределы и умолчания коридора и подсказки (`parseCorridor`, `parseAlert`).
- `src/lib/route-corridor.ts` — `sampleLine`, `routeChunks`, `projectOnRoute`,
  `MAX_CHUNKS`, `MAX_STOPS`, `rankStops` (порядок по `alongMeters`).
- `src/lib/route-stop-cue.ts` — `stopCue({travelled, stops, alertMeters, speedMps, log})`
  и `StopVoiceLog`; порог `max(alertMeters, speedMps × 60)`.

## 3. Чтение

- `src/lib/route-stops-read.ts` — `findStopsAlongRoute({coords, interests,
  corridorMeters, productSlug})`: один запрос по прямоугольникам куска к `OsmCryptoPoi`,
  один к `CompanyPoint` (видимость как в фиде), один к финтеху; кэшбэк предприятий
  (`readCompanyRates` + `effectiveCashback`), цена — только при `productSlug`.
- `src/lib/interests-read.ts` — отметки и два числа для вошедшего; умолчания для гостя.

## 4. Границы наружу

- `POST /api/crypto-map/along-route` — тело `{coords, mode, product?}`; интересы и числа
  читаются из сеанса, гость получает умолчания; Redis 10 мин по ключу линии и интересов;
  `walk`/`car` только, маршрут короче 500 м → `{stops: []}`.
- `src/app/actions/interests.ts` — `setInterest`, `saveRouteRadii`.

## 5. Экраны

- `src/components/coin-detail/route-stops-panel.tsx` — список по пути, отметка флажком,
  кэшбэк и цена, строка «ещё N по пути», состояния «ничего» и «не узнали».
- `src/components/coin-detail/crypto-navigator.tsx` — запрос панели после `buildRoute`,
  отметки в `localStorage` (`cmap:stops:v1:<destKey>`), подсказка в `announce()`.
- `src/components/cabinet/interests-section.tsx` + раздел `#interests` в `/{locale}/cabinet`.

## 6. Слова

- `messages/en.json`: `cabinetInterests.*`, `cryptoMap.stops.*`, `cryptoMap.nav.stopCue`;
  затем `npm run i18n`.
- `tests/route-interests.test.ts` — ось интересов, `activeInterests`, геометрия коридора,
  порядок и потолок, фраза подсказки и её однократность.

## 7. Прогон, выкладка, запись

- Живой прогон: временная запись с отметками; маршрут по городу с крипто-точками
  (Прага), панель по пути, отметка, фраза подсказки на синтетическом отсчёте; гость
  без входа; транспорт без панели.
- `npm test`, `npm run build`, `env -u max_memory_restart pm2 restart` веб и воркер,
  коммит, push, запись в `CLAUDE.md`.
