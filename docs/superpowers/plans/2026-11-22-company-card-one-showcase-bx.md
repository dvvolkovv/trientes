# План: карточка предприятия — одна витрина, одни выключатели, один стиль (BX)

Спека: `docs/superpowers/specs/2026-11-22-company-card-one-showcase-design.md`.

Живой подопытный — предприятие **Arcon** (`cmwm2jtfr0009d7fcink72rv7`), одна точка
`cmwm2rjpr000jd7fcrb072gio`, часы у предприятия, у точки пусто.

## Шаг 1. Выключатели модулей — чистый модуль и тест

`src/lib/company-public-fields.ts`: `PUBLIC_FIELD_KEYS` дополняется ключами
`photos`, `coins`, `socials`, `website`, `products`, `promos`. Умолчание у всех —
`true` (в `defaultPublicFields`), то есть у нынешних записей не меняется ничего.

Тест `tests/company-public-fields.test.ts` (новый): запись без новых ключей читается
как «показывать»; `{ coins: false }` гасит только монеты; негодная запись (строка,
массив, `null`) даёт умолчания; `toPublicFieldsJson` пишет **все** ключи.

Проверка: `npx vitest run tests/company-public-fields.test.ts`.

Коммит: `feat(BX): модули карточки в наборе публичных полей`.

## Шаг 2. Наследование часов и монет — чистый модуль и тест

Новый `src/lib/company-inherit.ts`:

```ts
export function inheritedHours(point: unknown, company: unknown): WeekHours | null
export function inheritedTimezone(point: string | null, company: string | null): string | null
export function inheritedCoins(point: string[], company: string[]): string[]
```

Правила: непустое у точки сильнее; пустое — берём у предприятия; пустое у обоих —
`null`/`[]`. Часы разбираются `parseWeekHours`, пустая неделя (`isEmptyWeek`)
считается отсутствием. Пояс наследуется **вместе с часами**: часы без пояса состояние
не считают (правило BN) — если часы взяты у предприятия, пояс берётся у него же.

Тест `tests/company-inherit.test.ts`: свои часы точки сильнее; пустые часы точки дают
часы предприятия **с её поясом**; неделя из семи «закрыто» считается пустой; монеты
точки сильнее; пустой список точки даёт список предприятия; пусто у обоих — пусто.

Коммит: `feat(BX): наследование часов и монет от предприятия к точке`.

## Шаг 3. Данные

- `Company.acceptedCoinIds String[] @default([])`, `Company.acceptedCardIds String[] @default([])`.
- Миграция `20261122200000_company_accepted_coins` руками + `npx prisma migrate deploy`.

```sql
ALTER TABLE "Company" ADD COLUMN "acceptedCoinIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Company" ADD COLUMN "acceptedCardIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
```

Коммит: `feat(BX): набор монет у предприятия`.

## Шаг 4. Монеты предприятия — модерируемое поле

`src/lib/company-edit.ts`: ключи `acceptedCoinIds` и `acceptedCardIds` в класс
**модерируемых** (не документальных: бумага подтверждает лицо, а не монеты).
Сравнение списков — без учёта порядка (приём `sameList` из `src/lib/point-edit.ts`;
вынести общую `sameIdList` в `src/lib/id-list.ts` и читать обоими модулями, второй
копии правила не заводим).

Тест `tests/company-edit.test.ts` (расширить): смена набора монет у залистованного
предприятия требует модерации; перестановка того же набора — нет; у `PENDING`
предприятия правка идёт сразу.

Коммит: `feat(BX): монеты предприятия идут через модератора`.

## Шаг 5. Форма карточки предприятия — выбор монет

`src/components/business/company-profile-form.tsx`: блок «Принимаемые монеты» —
поле поиска + чипы **44 px** (правило AN), выбранные первыми. Выделить чип в
`src/components/business/coin-picker.tsx` и переиспользовать **и** в
`src/components/business/point-form.tsx` (там сегодня чипы 11 px без поиска).

`src/app/actions/company.ts` (`saveCompanyProfile`): принимает оба списка, сверяет
карточки собственного листинга (`status: "APPROVED"`) тем же запросом, что уже есть
в действиях точки, и кладёт правку в `CompanyRevision`, когда предприятие
залистовано.

`src/app/[locale]/cabinet/companies/[id]/page.tsx` и `.../edit`: передают `coins`
(`readTop100()`) и `cards` (`listSelfListedCards(200)`) — как страница точек.

Коммит: `feat(BX): выбор монет в карточке предприятия`.

## Шаг 6. Гейт выключателей — право, а не владение

`src/app/[locale]/cabinet/companies/[id]/page.tsx:211`: `canManage={isOwner}` →
`canManage={canEditSection(permissions, "card")}`.
`src/app/actions/company-public-fields.ts` (или где живёт действие): та же калитка
`canWrite(gate, "card")` вместо проверки владельца — экран без действия не защита.

Тест: расширить `tests/merchant-labels.test.ts` либо завести
`tests/company-public-fields-gate.test.ts` — `card: EDIT` пускает, `card: VIEW` нет.

Коммит: `feat(BX): выключателями витрины управляет право на карточку`.

## Шаг 7. Фид навигатора читает выключатели и наследование

`src/lib/company-points.ts` (`companyPointToPoi`, `fetchApprovedPointsInBbox`):

- читать `company.publicFields`, `company.hours`, `company.timezone`,
  `company.acceptedCoinIds`, `company.acceptedCardIds`, `company.returnPolicy`,
  `company.returnDays`, `company.registrationNumber`, `company.taxNumber`;
- `hours`/`timezone` — через `inheritedHours`/`inheritedTimezone`;
- монеты — через `inheritedCoins` перед `acceptedCoinsFor`;
- выключенный модуль **вырезается из ответа**: `phone`, `email`, `website`,
  `socials`, `photos`, `description`, `acceptedCoins`, `promo`, `hours`;
- `Poi` дополняется `returnPolicy?`, `returnDays?`, `requisites?`,
  `companyId`, `offers?`.

Тест `tests/company-points-public-fields.test.ts`: выключенный `phone` не приходит;
выключенный `coins` даёт пустой `acceptedCoins` и `coinSpecific: false`; выключенный
`hours` гасит и унаследованные часы; наследование часов работает при `hours: true`.

Коммит: `feat(BX): фид карты читает выключатели и наследование`.

## Шаг 8. Товары в карточке

`src/lib/products/offers-read.ts`: функция `readPointOffers(pointIds, limit = 3)` —
предложения предприятий этих точек с ценой, валютой и слагом паспорта, видимость
через существующий `offerVisible`. Читается **одним запросом на кадр** (приём
`readPointPromos`), сбой чтения оставляет карточку без товаров, но не без точки.

Коммит: `feat(BX): товары предприятия в карточке точки`.

## Шаг 9. Карточка показывает новое

`src/components/coin-detail/poi-pane-card.tsx` и `poi-pane-showcase.tsx`:

- часы уже рисует `PoiHours` — после шага 7 они появятся сами;
- строка «Открыть карточку предприятия» → `/{locale}/companies/{companyId}`;
- политика возврата (`returnPolicy`, `returnDays`) строкой;
- реквизиты на «Витрине» рядом со связью;
- до трёх товаров с ценой и ссылкой на паспорт;
- описание — `localizedProse` + `TranslatedBadge`, как на витрине;
- **удалить** блок «О компании» (`poi.category` дублирует имя).

Ключи перевода: `cryptoMap.poi.openCompany`, `.returns`, `.requisites`, `.products`.
После правки `messages/en.json` — `npm run i18n`.

Коммит: `feat(BX): карточка с карты показывает часы, возврат, реквизиты и товары`.

## Шаг 10. Подписки — плитка и стиль

`src/components/cabinet/subscriptions-section.tsx`: читает логотип, форму логотипа,
юридическое имя и состояние предприятия; убрать свой `<h2>`.

`src/components/cabinet/subscriptions-controls.tsx`: плитки в `TILE_GRID` +
`ADMIN_TILE_CENTERED` + `logoBoxClass`/`logoImageClass` (тот же вид, что
`companies-section.tsx`); действия — кнопки `ADMIN_BUTTON` под плиткой; общий
выключатель — та же кнопка-переключатель, что в разделе рассылок, а не голый
`input[type=checkbox]`.

Коммит: `feat(BX): подписки — тот же баннер предприятия, что у владельца`.

## Шаг 11. Один заголовок на раздел

Убрать дублирующий `<h2>` в `src/components/cabinet/`: `alerts-section`,
`cases-section`, `coins-section`, `exchanges-section`, `interests-section`,
`loyalty-section`, `store-messages-section`, `subscriptions-section`. Подзаголовок
(`subtitle`) остаётся.

Не трогать: `profile-header` (имя человека), `settings-section` и `security-section`
(живут внутри профиля по BT), `product-ladder`.

Тест `tests/cabinet-single-heading.test.ts` (исходниками, приём
`tests/cabinet-back-button.test.ts`): для каждой страницы под `src/app/[locale]/cabinet`,
использующей `CabinetSectionShell`, её секция не должна печатать `<h2>` с тем же
ключом перевода, что передан в `title=`.

Коммит: `fix(BX): заголовок раздела кабинета печатается один раз`.

## Шаг 12. Узкий экран до 280 px

- Подвал (`src/components/footer.tsx`): колонки `col-span-12 md:col-span-5` ломают
  280 px — `min-w-0` и перенос длинной ссылки (`break-words`).
- Знак в шапке (`a.flex items-center gap-2 shrink-0 whitespace-nowrap`): убрать
  `whitespace-nowrap` у подписи `.ORG` на узком экране.
- `tests/e2e/cabinet-no-hscroll.spec.ts`: ширины `[280, 320, 390]`, добавить
  публичную витрину предприятия в список адресов.

Проверка: `npx playwright test tests/e2e/cabinet-no-hscroll.spec.ts`.

Коммит: `fix(BX): ни одной горизонтальной прокрутки до 280 px`.

## Шаг 13. Живой прогон и выкладка

1. `npm run lint && npx vitest run && npm run build`.
2. `env -u max_memory_restart pm2 restart trientes-web` (воркер — только если тронут
   импортируемый им `src/lib`: `company-points.ts` импортируется? проверить
   `grep -rn "company-points" worker/`).
3. Живой прогон на Arcon ширинами 280/390 по-русски:
   - в карточке с карты есть часы (Пн–Пт 09:00–18:00) и «Открыто/Закрыто»;
   - выключение `coins` в кабинете убирает монеты из фида (проверить `curl` по
     `/api/crypto-map/poi`), включение возвращает;
   - сотрудник с `card: EDIT` видит выключатели, с `card: VIEW` — нет;
   - смена монет у залистованного предприятия легла в `CompanyRevision`, витрина
     прежняя;
   - раздел «Подписки» — один заголовок, плитка с логотипом, нажатие ведёт на
     витрину;
   - горизонтальной прокрутки нет ни на одной из трёх ширин.
4. Убрать временную запись `bxprobe` и её подписку.
5. `git push origin main`.
