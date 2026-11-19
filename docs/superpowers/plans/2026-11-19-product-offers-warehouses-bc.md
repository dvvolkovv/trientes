# Предложение продавца, склады и «где взять» — план слайса BC

Спека: `docs/superpowers/specs/2026-11-19-product-offers-warehouses-design.md`.
Порядок — тот же, что в BB: чистые правила с тестами, схема, чтение, действия,
экраны, переводы, живой прогон.

## 1. Чистые правила (тесты впереди кода)

`src/lib/warehouse/rules.ts`

- `WAREHOUSE_KINDS`, `MAX_WAREHOUSES = 50`, `DAILY_MOVEMENTS = 500`.
- `validateWarehouse(input, ctx)` → `{ ok } | { reason }`:
  `name_required`, `shelf_needs_place`, `point_not_allowed`, `too_many`.
- `canArchive(balanceSum)` → `warehouse_not_empty`.
- `validateMovement(input)` → виды и обязательные склады, `same_warehouse`,
  `qty_zero`, `qty_negative` (только `ADJUST`), `reason_required`.
- `movementPlan(input)` → `{ deltas: [{warehouseId, delta}], status }` —
  транзит списывает с источника и ждёт приёма.
- `receivePlan(movement)` → зачисление приёмнику; повтор — `not_in_transit`.
- `cancelPlan(movement)` → встречная дельта источнику; `DONE` — `not_cancellable`.
- `checkStock(deltas, balances)` → `insufficient_stock`.
- `transitTotals(movements)`.

`src/lib/products/offers-rules.ts`

- `OFFER_UNITS`, `OFFER_CURRENCIES` (фиатная часть `CURRENCIES`),
  `CASHBACK_MIN/MAX`.
- `parseAmount(raw)` — точка и запятая, два знака, > 0.
- `validateOffer(input)` → `price_invalid`, `currency_invalid`, `unit_invalid`,
  `cashback_invalid`, `url_invalid`.
- `offerVisible(offer, company, product)`, `availabilityOf(balances)`.

Тест: `tests/stock-movements.test.ts`, `tests/product-offers.test.ts`.

## 2. Схема и миграция

`prisma/schema.prisma`: `Warehouse`, `StockBalance`, `StockMovement`,
`ProductOffer` + enum `WarehouseKind`, `StockMoveKind`, `StockMoveStatus`,
`OfferStatus`; обратные связи у `Company`, `CompanyPoint`, `Product`, `User`.
Миграция `20261119xxxxxx_product_offers_warehouses` — руками, применяется
`prisma migrate deploy` (чекаут — прод, `migrate dev` умеет предлагать сброс).

## 3. Чтение

`src/lib/products/offers-read.ts`

- `readProductOffers(productId)` — живые предложения + полки с остатком + область
  карты (`areaOf`, как в приёме монеты).
- `readCompanyOffers(companyId)` — витрина.
- `readOfferForCabinet(companyId, productId)`.
- `pointIdsWithProduct(slug)` — для фида карты.

`src/lib/warehouse/read.ts`

- `readWarehouses(companyId)` (с числом позиций и суммой остатка),
  `readWarehouse(companyId, id)`, `readWarehouseStock(warehouseId)`,
  `readTransit(companyId)`, `readMovements(companyId, opts)`,
  `readStockByProduct(companyId, productId)`.

## 4. Действия

`src/app/actions/warehouses.ts`: `createWarehouse`, `archiveWarehouse`,
`recordMovement`, `receiveMovement`, `cancelMovement` — всё в `$transaction`
(движение + апсерт балансов), права через тот же `editorCompany`, что в BB
(роль не VIEWER).

`src/app/actions/offers.ts`: `saveOffer`, `setOfferStatus`, `deleteOffer`.

## 5. Экраны

- `/{locale}/product/[slug]` — раздел «Где взять»
  (`src/components/product/where-to-buy.tsx`).
- `/{locale}/companies/[id]` — раздел «Товары»
  (`src/components/company/offers-block.tsx`).
- `/{locale}/crypto-map?product=<slug>` — фильтр фида и проброс через
  `CryptoMapSection` → `crypto-navigator`.
- Кабинет: `warehouses/page.tsx`, `warehouses/[wid]/page.tsx`, блок
  «Моё предложение» и остатки на странице товара в кабинете.

## 6. Переводы

Ключи в `messages/en.json` (`offers.*`, `warehouses.*`, `products.whereToBuy.*`,
`company.productsHeading`), затем `npm run i18n`.

## 7. Сборка и живой прогон

`npm test`, `npm run build`, `pm2 restart trientes-web` (воркер не трогаем —
новые модули им не импортируются). Живой прогон на временном предприятии:
склад-полка на одобренной точке, приход, перемещение с перевозчиком, приём,
отмена, попытка списать больше остатка, предложение с ценой и ставкой, раздел
«Где взять» на странице паспорта, карта с `?product=`, архив склада с остатком.
Всё убрать за собой; сверка `scripts/stock-audit.ts`.
