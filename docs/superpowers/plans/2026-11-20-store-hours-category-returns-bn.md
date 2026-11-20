# План: режим работы, вид заведения, политика возврата (BN)

Спека: `docs/superpowers/specs/2026-11-20-store-hours-category-returns-design.md`.

## Шаг 1. Часы работы — чистый модуль и тест

`src/lib/opening-hours.ts`: типы `DayHours`/`WeekHours`, `parseWeekHours(raw)`,
`normalizeWeekHours`, `openStateAt(hours, tz, now)`, `weekOrder`, `formatSpan`.
Тест `tests/opening-hours.test.ts`: будний день внутри промежутка открыт; обед закрыт
и «откроется в 14:00»; круглосуточно открыт всегда; закрытый день даёт следующий
открытый; промежуток через полночь открыт в 01:00 следующего дня; без пояса состояние
не считается; негодный JSONB даёт пустую неделю; закрытая всю неделю точка даёт
«закрыто» без даты.

## Шаг 2. Часовые пояса

`src/lib/timezones.ts`: `TIMEZONES` (из `Intl.supportedValuesOf`), `isKnownTimezone`,
`timezoneForCountry(code)` — карта однопоясных стран. Тест: Чехия → `Europe/Prague`,
US → `null`, негодный код → `null`, подставленный пояс обязан быть в списке платформы.

## Шаг 3. Вид заведения

`src/lib/merchant-categories.ts`: `MERCHANT_CATEGORIES` (ключ, знак, интерес),
`isMerchantCategory`, `effectiveCategory(point, company)`, `categoryInterest`.
Тест: уточнение точки сильнее предприятия; пусто у обоих → `null`; у каждой записи
есть интерес из `INTEREST_KEYS` и ключ перевода (расширить `tests/merchant-labels.test.ts`).

## Шаг 4. Данные

- `CompanyPoint.hours Json?`, `CompanyPoint.timezone String?`, `CompanyPoint.category String?`
- `Company.category String?`, `Company.returnPolicy String? @db.Text`, `Company.returnDays Int?`
- Миграция `20261120140000_store_hours_category_returns` руками + `migrate deploy`.

## Шаг 5. Фид и правила карты

- `Poi.categoryKey?`, `Poi.hours?`, `Poi.timezone?`; `companyPointToPoi` их заполняет
  (`effectiveCategory`, ярлык вида вместо названия предприятия в `category`).
- `interestOf` предпочитает `categoryKey` (через `categoryInterest`), падающий остаток
  «магазин» остаётся для точки без вида.
- `poiPulseColor` — ключ сильнее текста (заправка и зарядка синим).
- Тесты: `tests/interests.test.ts` и `tests/poi-brand.test.ts` расширить.

## Шаг 6. Экшены и валидация

- `validateCompanyPoint`: `hours`, `timezone`, `category` — проверка формы, пояс из списка,
  вид из реестра; часы без пояса принимаются, но состояние не считается.
- `COMPANY_FREE_FIELDS += category, returnPolicy, returnDays` (BM), `COMPANY_CARD_FIELDS`
  пополняется; `returnDays` — число, поэтому в `CompanyEditState` приводится строкой.
- Журнал предприятия: часы и вид пишутся существующим `POINT_UPDATED`/`PROFILE_UPDATED`.

## Шаг 7. Кабинет

- `src/components/business/hours-editor.tsx` — семь строк, три плитки состояния, до двух
  промежутков, кнопка «как в понедельник», выбор пояса (подставлен по стране).
- Форма точки: редактор часов и вид заведения (плитки), скрыты у типа `ONLINE`.
- Карточка предприятия (BM): вид, политика возврата, срок возврата в списке полей и в форме.

## Шаг 8. Витрина и навигатор

- `/{locale}/companies/[id]`: строка типа магазина (`companyMode`), вид, политика возврата,
  у точек — состояние и расписание (`src/components/business/hours-view.tsx`).
- `poi-pane-card.tsx`: состояние строкой, расписание недели под ним; текст зеркала как было.
- `/{locale}/product/[slug]`: политика возврата продавца в разделе «Где взять».

## Шаг 9. Переводы и телефон

`npm run i18n`; `tests/e2e/cabinet-no-hscroll.spec.ts` прогнать на 320 и 390.

## Шаг 10. Выкладка и живой прогон

`npm run build`, `env -u max_memory_restart pm2 restart trientes-web`; воркер трогаем
только если новые модули попали в его импорт (проверить `src/lib/crypto-map.ts`).
Живой прогон на временном предприятии: часы, состояние, вид, булавка, маршрут по интересу
«топливо», политика возврата на витрине и на паспорте товара; скриншоты 390 px.
