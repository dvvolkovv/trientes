# Паспорт товара и каталог — план слайса BB

Спека: `docs/superpowers/specs/2026-11-18-product-passport-catalog-design.md`.
Порядок задач — снизу вверх: чистые правила с тестами → схема → действия → экраны →
очередь → переводы → живой прогон. Коммит после каждой задачи.

**Цель:** паспорт товара мира, который правит любое залистованное предприятие, забирает
заявкой производитель, и который виден в публичном каталоге. Цен и остатков нет.

## 1. Чистые правила (юнит-тесты впереди кода)

- Create: `src/lib/slugify.ts` — общая `slugify()` + `slugCandidates(base)`;
  `src/lib/coin-card-slug.ts` переписать поверх неё (DRY, поведение не меняется —
  существующие тесты карточек монет должны остаться зелёными).
- Create: `src/lib/products/gtin.ts` — `parseGtin(raw): string | null` (EAN-13, UPC-12 →
  EAN-13 добавлением ведущего нуля, EAN-8; контрольная цифра обязательна).
- Create: `src/lib/products/categories.ts` — реестр категорий (ключи, без прозы).
- Create: `src/lib/products/rules.ts` — `canEditProduct()`, `editKind()`
  (`direct` | `revision` | `forbidden`), `tokenizationReadiness()`, `isMp4()`,
  `revertPatch()`, пределы (`MAX_PHOTOS` 8, `MAX_ATTRS` 50, `MAX_DOCS` 10,
  `DAILY_PRODUCTS` 50, `DAILY_EDITS` 200).
- Test: `tests/products-gtin.test.ts`, `tests/products-rules.test.ts`,
  `tests/slugify.test.ts`.

## 2. Схема и миграция

- Modify: `prisma/schema.prisma` — `Product`, `ProductEdit`, `ProductClaim`,
  `ProductRevision`, `ProductReport`; `CaseSubjectType` += `PRODUCT_CLAIM`,
  `PRODUCT_REPORT`; связи у `Company` и `User`.
- Create: `prisma/migrations/20261118210000_product_passport/migration.sql` — писать
  руками, применять `npx prisma migrate deploy` (чекаут — прод, `migrate dev` умеет
  предлагать сброс базы).
- Проверка: `npx prisma validate && npx prisma migrate deploy && npx prisma generate`.

## 3. Чтение паспортов

- Create: `src/lib/products/read.ts` — `readProductBySlug()`, `readCatalog()`
  (поиск по названию и штрихкоду, фильтр категории, пагинация), `readCompanyProducts()`,
  `visibleProductWhere()` (не снят, не удалён, не слит).

## 4. Действия предприятия

- Create: `src/app/actions/products.ts` — `createProduct`, `updateProduct`,
  `revertProductEdit`, `submitProductClaim`, `proposeRevision`, `decideRevision`
  (хозяин), `withdrawRevision`. Каждое: калитка `getViewerCompanyById` +
  `canEditProduct`, пределы, запись `ProductEdit`, `ensureCase` для claim.
- Create: `src/app/api/products/media/upload/route.ts` — фото/видео/документы,
  корень `PRODUCT_MEDIA_ROOT`, образец `src/app/api/business/point/upload/route.ts`.
- Modify: `.env` — `PRODUCT_MEDIA_ROOT=/var/www/trientes-uploads/products`.
- Modify: nginx — `location ~ ^/uploads/(coin-cards|points|products)/`.

## 5. Жалоба

- Create: `src/app/api/product-report/route.ts` — капча (как `/api/point-report`),
  1 жалоба в сутки с адреса на паспорт, `ensureCase` → `PRODUCT_REPORT`.

## 6. Очередь в админке

- Modify: `src/lib/cases/queues.ts` (+`products`, 📦), `src/lib/cases/types.ts`,
  `src/lib/authz/map.ts` (`SUBJECT_QUEUES`, `productDecision`),
  `src/lib/cases/sla.ts` (claim 5 дней, жалоба 3), `src/lib/cases/checklists.ts`
  (два листа), `src/lib/cases/subject.ts` (чтение объекта дела),
  `src/lib/cases/decide.ts` (`applyDecision` для двух типов).
- Create: `src/app/actions/product-supervision.ts` — `suspendProduct`,
  `unsuspendProduct`, `mergeProduct` (коды аудита из спеки).
- Create: `src/components/admin/product-case.tsx` — раздел дела (паспорт, заявка/жалоба).

## 7. Публичные экраны

- Create: `src/app/[locale]/products/page.tsx` — каталог (+`generateMetadata`).
- Create: `src/app/[locale]/product/[slug]/page.tsx` — страница паспорта (308 у слитого,
  404 у снятого/удалённого).
- Create: `src/components/product/gallery.tsx`, `speak-button.tsx` (браузерный синтез,
  кнопки нет без голоса под `Product.language`), `attributes.tsx`,
  `readiness.tsx`, `report-button.tsx`, `claim-button.tsx`.
- Modify: `src/app/sitemap.ts` — паспорта; меню (бургер + десктоп) — ссылка «Товары».

## 8. Кабинет предприятия

- Create: `src/components/cabinet/products-section.tsx` — список, «Завести паспорт»
  (сначала поле штрихкода), форма правки, история с откатом, входящие предложения.
- Create: `src/app/[locale]/cabinet/companies/[id]/products/page.tsx` и
  `.../products/[productId]/page.tsx`.
- Modify: `src/app/[locale]/cabinet/companies/[id]/page.tsx` — ссылка на раздел.

## 9. Переводы

- Modify: `messages/en.json` — `products.*`, `cabinet.products.*`, `admin.products.*`,
  `common.products`; затем `npm run i18n` (все `SUPPORTED_LOCALES`).
- Проверка: `npx vitest run tests/messages-parity.test.ts`.

## 10. Сборка, выкладка, живой прогон

- `npx vitest run` (весь набор), `npm run build`, `pm2 restart trientes-web`
  (воркер не трогаем: ничего из его импортов не менялось), `pm2 save`.
- Живой прогон по разделу 12 спеки; временные записи убрать за собой.
- `git push origin main`.
