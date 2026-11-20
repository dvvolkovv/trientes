# План: кабинет предприятия — карточка, плитки, лестница товара (BM)

Спека: `docs/superpowers/specs/2026-11-20-merchant-cabinet-card-tiles-design.md`.

## Шаг 1. Правила правки профиля (чистый модуль)

`src/lib/company-edit.ts`: `COMPANY_FREE_FIELDS`, `COMPANY_MODERATED_FIELDS`,
`COMPANY_DOCUMENT_FIELDS`, `splitCompanyEdit(before, after)` → `{ free, moderated,
documentary, needsDocuments }`. Тест: пустая правка даёт пустые наборы; правка описания
свободна; правка адреса модерируема; правка юридического имени требует документов.

## Шаг 2. Данные

- `CompanyRevision`: `companyId`, `authorUserId?`, `payload Json`, `documents Json`,
  `status RequestStatus`, `decisionReason?`, `decidedAt?`, индекс по `(companyId, status)`.
- `CaseSubjectType += COMPANY_REVISION`.
- Миграция `20261120090000_company_revision` руками + `migrate deploy`.

## Шаг 3. Дело комплайнса

- `queues.ts`: `companies` принимает `["COMPANY", "COMPANY_REVISION"]`.
- `sla.ts`: `COMPANY_REVISION: 5`.
- `checklists.ts`: лист из четырёх пунктов.
- `subject.ts`: загрузчик правки — заголовок «правка: <имя>», поля было → стало.
- `decide.ts` + `src/app/actions/admin-company-revision.ts`:
  `approveCompanyRevision` / `rejectCompanyRevision`.
- Подписи решения `admin.case.decision.companyRevision.*`.

## Шаг 4. Экшен профиля

`saveCompanyProfile`: свободные поля — сразу; у одобренного предприятия модерируемые и
документальные уходят в `CompanyRevision` (гася прежнюю ждущую) + `ensureCase`; у
неодобренного — всё сразу, как раньше. Документальная правка без документов —
`documents_required`.

## Шаг 5. Карточка в кабинете

- `src/components/business/company-card.tsx` — список «поле → значение», строка
  верификации, строка ждущей правки с было → стало.
- Форма только при `?edit=1`, с подписью, что уходит на проверку.
- `KybSection` переезжает под карточку и показывается только при `kybStatus !== APPROVED`.

## Шаг 6. Плитки

- `src/lib/cabinet/company-nav.ts` — карта групп и плиток (ключ, раздел прав, href, знак).
- `src/components/cabinet/company-tiles.tsx` — сетка плиток на `ADMIN_TILE`.
- Страницы групп: `showcase`, `household`, `order` под
  `/cabinet/companies/[id]/g/[group]` — одна страница на все три группы.
- Полоса ссылок со страницы предприятия удаляется.
- Расширить `tests/merchant-labels.test.ts`.

## Шаг 7. Тип точки плитками

`point-form.tsx`: сетка плиток с подписью и пояснением (`business.typeHint.*`).

## Шаг 8. Лестница товара

`src/lib/products/ladder.ts` + тест; рендер на странице товара в кабинете.

## Шаг 9. Телефон и переводы

- `overflow-x: clip` на колонке; `tests/e2e/cabinet-no-hscroll.spec.ts` (320 и 390).
- `npm run i18n` по всем локалям.

## Шаг 10. Выкладка и живой прогон

`npm run build`, `env -u max_memory_restart pm2 restart trientes-web`, перезапуск воркера
не нужен (новые модули воркер не импортирует — проверить), живой прогон на временном
предприятии, скриншоты 390 px.
