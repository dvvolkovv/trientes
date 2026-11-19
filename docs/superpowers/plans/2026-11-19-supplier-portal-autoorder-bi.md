# План: портал поставщика и автозаказ (слайс BI)

Спека: `docs/superpowers/specs/2026-11-19-supplier-portal-autoorder-design.md`.

## 1. Данные

- `prisma/schema.prisma`: enum `SupplyOrderStatus`; модели `Supplier`, `SupplyOrder`,
  `SupplyOrderLine`, `ReorderRule`; поле `StockMovement.supplyLineId`; связи у
  `Company` (свои поставщики, свои заказы, заказы нам), `Warehouse`, `Product`, `User`.
- Миграция руками `20261119220000_supplier_portal/migration.sql` + `migrate deploy`
  (чекаут — прод, `migrate dev` умеет предлагать сброс базы).

## 2. Чистые правила

- `src/lib/supply/rules.ts` — статусы и `canTransition`, потолки, разборы количества,
  `validateSupplier`, `validateOrderLine`, `validateReorderRule`, `orderTotals`,
  `isFullyReceived`, `supplyRights`.
- `src/lib/supply/reorder.ts` — чистая `reorderPlan(rows)`: что заказать, кому и
  сколько, с учётом остатка, пути и уже заказанного.
- `src/lib/warehouse/apply.ts` — вынесенная из экшена `applyDeltas` + `NegativeBalance`.

## 3. Чтение и связь

- `src/lib/supply/read.ts` — поставщики, заказы покупателя, «заказы нам», заказ
  целиком, правила, остатки для правил.
- `src/lib/supply/docs.ts` — корень, адрес, потолки; схема имени импортом из
  `@/lib/cases/attachments`.
- `src/lib/supply/notify.ts` — `notifySupplyEvent` на языке кабинета получателя.
- `src/lib/supply/reorder-sweep.ts` — `runReorderSweep()`; воркер `30 5 * * *`.

## 4. Действия

- `src/app/actions/supply.ts`: `saveSupplier`, `setSupplierArchived`, `createOrder`,
  `addOrderLine`, `removeOrderLine`, `sendOrder`, `confirmOrder`, `declineOrder`,
  `markOrderShipped`, `receiveOrderLine`, `closeOrder`, `cancelOrder`, `addOrderDoc`,
  `saveReorderRule`, `deleteReorderRule`.
- Маршруты: `POST /api/supply-doc/upload`, `GET /api/supply-doc/[orderId]/[name]`.

## 5. Экраны

- `/{locale}/cabinet/companies/[id]/supply` + `/[orderId]`.
- Компоненты `src/components/supply/*`: форма поставщика, форма заказа, строки,
  действия сторон, накладные, правило автозаказа.
- Ссылка «Поставки» в полосе разделов предприятия по праву `supply`.

## 6. Границы и слова

- `permissions.ts`: раздел `supply`, шаблоны ролей.
- `journal.ts`: 14 новых кодов; список в `tests/merchant-labels.test.ts`.
- `messages/en.json`: `supply.*`, `business.supplyLink`,
  `cabinetTeam.roles.sections.supply`, `cabinetJournal.actions.*`, `notify.supply.*`;
  затем `npm run i18n`.
- `tests/supply-rules.test.ts` — переходы, план автозаказа, потолки, права.

## 7. Прогон, выкладка, запись

- `SUPPLY_DOCS_ROOT` в `.env`, каталог `/var/www/trientes-private/supply`.
- Живой прогон: два временных предприятия (покупатель и поставщик-портал), внешний
  поставщик, товар, полка; цепочка заказ → отправка → подтверждение → отправлено →
  приём частями → закрытие; отказ без причины; заказ на склад вне участка; кладовщик с
  `VIEW`; правило автозаказа и прогон (черновик, повтор молчит); накладная снаружи
  (401 без сеанса, 400 на имя с выходом из каталога).
- `npm test`, `npm run build`, `pm2 restart trientes-web trientes-worker`, `pm2 save`,
  коммит, `git push origin main`, абзац в `CLAUDE.md`, голосовой отчёт.
