# План: лояльность наполовину — ставки и уровни (слайс BD)

Спека: `docs/superpowers/specs/2026-11-19-loyalty-rates-levels-design.md`.

## Шаги

1. **Схема и миграция** `20261119140000_loyalty_rates`: `Company.cashbackBasePercent
   Decimal?(5,2)`, модель `CashbackRule (companyId × category, percent)` с
   `@@unique([companyId, category])` и каскадом от предприятия. Миграция руками +
   `migrate deploy` (чекаут — прод, `migrate dev` умеет предлагать сброс базы).
2. **Чистые правила** `src/lib/loyalty/rates.ts`: `parseRate`, `effectiveCashback`
   (ближайшая побеждает, возвращает источник), `cashbackSummary` (база и максимум по
   категориям для витрины). Пределы — импортом из `offers-rules.ts`.
3. **Лестница** `src/lib/loyalty/levels.ts`: `LOYALTY_LEVELS`, `levelFor(number | null)`
   с `measured`.
4. **Тесты** `tests/loyalty-rates.test.ts` — до кода шагов 2–3 по существу (TDD) или
   сразу следом, но до UI.
5. **Чтение** `src/lib/loyalty/read.ts`: `readCompanyRates`, `readRatesForCompanies`
   (один запрос на все предприятия раздела «Где взять»), `readCashbackSummary`.
   Встроить в `offers-read.ts` так, чтобы и паспорт, и витрина отдавали **действующую**
   ставку вместе с источником.
6. **Экшены** `src/app/actions/loyalty.ts`: `saveBaseRate`, `saveCategoryRate`
   (пустая строка снимает) — калитка `canWrite(editorCompany(...))`.
7. **Экраны**: страница кабинета `/cabinet/companies/[id]/loyalty` + клиентская форма;
   ссылка в полосе кабинета предприятия; строка лояльности на витрине
   `/companies/[id]`; раздел «Кэшбэк и уровни» в `/cabinet`.
8. **i18n**: `loyalty.*` и `cabinetLoyalty.*` в `messages/en.json`, затем `npm run i18n`.
9. **Проверка**: `npm test`, `npm run build`, живой прогон по разделу 7 спеки,
   `pm2 restart trientes-web` (воркер лояльность не импортирует — проверить),
   коммит и `git push origin main`.
